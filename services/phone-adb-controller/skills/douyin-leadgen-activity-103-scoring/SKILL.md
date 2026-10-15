---
name: douyin-leadgen-activity-103-scoring
description: 交出按公司原政策持久化的评论评分。用于独立消费已提交评论评分或接手同一评分 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_comment_scoring.scoring
  activity_version: 2.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出按公司原政策持久化的评论评分

仅执行 `douyin_comment_scoring.scoring`。业务合同版本为 `2.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-103/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_comment_scoring.yaml)的 `scoring` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Comment`：`dedup_key`、`body`、`nickname`、`douyin_id`、`profile_url`、`process_status`。
- 输入 `Video`：`title`、`transcript`。
- 输出 `Comment`：`process_status`、`relevance`、`intent_grade`、`promoted`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 在MMV执行，不取手机租约、不操作ADB，也不等待整批102结束。任务限定来源批次时严格保留该范围；无有效评论就empty，不拿历史bench凑验收。
2. 通过原队列事务领取本公司的已提交待评分评论，读取关联视频及冻结公司政策。产品/目标客户和等级规则来自本公司，不从旧技能固定分类复制。
3. 复用正式judge-comment与持久化评分入口；当前金诺保留原2.0.0政策。调用模型的真实provider/model/回执与失败按原件记录。
4. 模型异常或输出无法验证时留待重判，不猜分、不伪造合格或C级。独立读回评论ID、归属、等级、理由与政策版本。
5. 本活动交出评分结果，不直接发私信，也不把评分成功等同于线索已配送。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-103/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
