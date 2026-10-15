---
name: douyin-leadgen-activity-102-cleanup
description: 归位采集现场并释放本人资源。用于采集流程收尾、失败后清理或接手同一收尾 Activity；不执行整个工作流。
metadata:
  version: 0.1.0
  activity_ref: douyin_video_processing.cleanup
  activity_version: 2.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 归位采集现场并释放本人资源

仅执行 `douyin_video_processing.cleanup`。业务合同版本为 `2.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `cleanup` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Device`：`serial`、`lock_holder`。
- 输入 `Run`：`run_tag`。
- 输出 `Device`：`lock_holder`。
- 输出 `Run`：`status`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 读取本次运行最后已确认状态，先保存已提交结果和失败原件；收尾不重跑搜索、判定或评论采集。
2. 停止本任务仍活跃的录制/采集子进程并核实归属；不操作别的任务或暂停中的录音。关闭本任务应用，回安全桌面，留原生证据。
3. 通过原协议释放本任务可释放的视频租约、本地设备锁和中央租约，逐项独立读回。owner不符、状态未知或释放失败如实保留，不删锁抢占。
4. 收尾成功不把业务partial/failed改成completed；输出实际清理项、未解决资源及恢复条件。101共享此收尾方法。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
