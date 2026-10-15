---
name: douyin-leadgen-activity-104-cleanup
description: 归位触达现场并保留未决发送。用于触达收尾、失败后保护订单或接手同一收尾 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_lead_outreach.cleanup
  activity_version: 3.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 归位触达现场并保留未决发送

仅执行 `douyin_lead_outreach.cleanup`。业务合同版本为 `3.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-104/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_lead_outreach.yaml)的 `cleanup` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Device`：`serial`、`lock_holder`。
- 输入 `Run`：`run_tag`。
- 输出 `Device`：`lock_holder`。
- 输出 `Run`：`status`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 本Activity独立于102收尾。先核对订单claimed/prepared/sent/unknown及原发送回执；收尾不再次发消息。
2. 仅通过原状态机释放本run尚未prepared且可安全回队列的claim。prepared、已发或结果未知保持原保护，不按TTL或退出码回成待发送。
3. 关闭应用、回安全桌面，精确释放本人设备锁与中央租约，并独立读回；不清除其他owner资源、不恢复/移除不属于自己的暂停标志。
4. 输出真实订单保留情况、设备清理和锁读回。清理完成不能替代发送/写回验收，未决必须进入最终报告。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-104/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
