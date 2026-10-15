---
name: douyin-leadgen-activity-102-preflight
description: 取得采集设备与账号执行上下文。用于采集预检、确认手机账号或接手同一预检 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_video_processing.preflight
  activity_version: 2.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 取得采集设备与账号执行上下文

仅执行 `douyin_video_processing.preflight`。业务合同版本为 `2.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `preflight` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Device`：`serial`、`host`。
- 输入 `Account`：`platform`、`profile`、`sender_id`。
- 输出 `Device`：`online`、`call_state`、`lock_holder`。
- 输出 `Account`：`logged_in`。
- 输出 `Run`：`run_tag`、`profile`、`serial`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 从本任务冻结配置读取公司、profile、serial、目标账号；核对实际已部署 release、源码和运行 ACK。注册表在线状态不能替代实际设备预检。
2. 核对中央租约与本地锁 owner；只使用本任务合法持有或明确交接的执行权。其他 owner 持锁、通话未空闲或设备离线均停止，不重启共享 ADB 或抢锁。
3. 用当前原生账号证据核对实际登录账号与该公司绑定；记录设备、账号、通话、锁四项实际结果，缺证据不能填 true。
4. 本 Activity 只交出预检上下文，不搜索、不领取视频，也不进入102评论采集。101引用此方法时同样只做预检。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
