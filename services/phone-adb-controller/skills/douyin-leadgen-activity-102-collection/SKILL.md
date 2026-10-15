---
name: douyin-leadgen-activity-102-collection
description: 交出持久化且身份可验证的评论。用于从合格视频采集评论并读回或接手同一评论采集 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_video_processing.collection
  activity_version: 2.3.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出持久化且身份可验证的评论

仅执行 `douyin_video_processing.collection`。业务合同版本为 `2.3.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `collection` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `CommentSampleRequest`：`run_tag`、`source_run`、`profile`、`serial`、`line`、`comment_limit`、`collection_budget_s`。
- 输入 `Video`：`line_key`、`video_id`、`video_url`、`judgment_status`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输入 `Account`：`sender_id`、`nickname`。
- 输入 `Run`：`run_tag`。
- 输入 `HistoricalComment`：`id`、`line_key`、`run_tag`、`source_run`、`video_id`、`video_url`、`schema_version`、`status`、`douyin_id`、`body`、`history_sha256`、`coverage`。
- 输出 `Comment`：`line_key`、`dedup_key`、`nickname`、`douyin_id`、`profile_url`、`body`、`video_id`、`harvest_batch`、`recipient_evidence`。
- 输出 `Video`：`process_status`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 只处理本轮已领且资格合格的视频；核对本任务冻结的comment_limit、策略和截止；配额取当前任务授权值，接手不能扩大。本次验收授权每合格视频5条，不把这个样本数写成所有任务的固定上限。
2. 逐屏读取评论，保留正文、原显示时间地区、评论人稳定身份、主页/视频链接和原生关联证据；相关搜索词、仅昵称或缺身份的测速结果不当完整评论。
3. 优先真实评论ID幂等；没有ID按原正式组合键去重并说明局限。每小批走原事务提交，之后独立读回完整UID、正文、URL、公司与来源。
4. 原生头像/主页核验失败保持未决，不用相似账号或模型猜测补身份。别名URL只有同真实VID且正式读回接口验证时才可复用。
5. 分别累计新增、历史核实、重复、实际覆盖；提交失败不计成功。达到本任务comment_limit是采样达标，不代表评论已采尽；保留部分成果和最后成功批次。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
