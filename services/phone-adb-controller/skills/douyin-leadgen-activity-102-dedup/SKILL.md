---
name: douyin-leadgen-activity-102-dedup
description: 交出本轮可处理的视频集合。用于核验101来源、筛选与认领视频或接手同一判重 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_video_processing.dedup
  activity_version: 3.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出本轮可处理的视频集合

仅执行 `douyin_video_processing.dedup`。业务合同版本为 `3.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `dedup` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Video`：`video_id`、`author`、`comment_count`、`keyword`。
- 输出 `Video`：`video_id`、`author`、`comment_count`、`keyword`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 验证真实101来源运行、已冻结定义、对应VID与公司归属，不能拿最新目录名或未绑定旧批次替代来源。
2. 读取原正式队列，排除合法完成、确认不合格及被其他有效租约持有的视频。按真实video_id判断，不用标题或昵称当唯一身份。
3. 通过现有原子领取协议持有本轮视频集合；丢失回复先读回领取归属，不重复创建竞争领取。
4. 分别输出received、eligible、已完成跳过及其他排除原因，保留逐VID和租约证据；不在判重阶段录音或评分。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
