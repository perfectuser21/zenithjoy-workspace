---
name: douyin-leadgen-activity-104-preflight
description: 取得已授权触达上下文。用于触达前核对发送账号、批准政策与资源或接手同一预检 Activity；不执行整个工作流。
metadata:
  version: 0.1.0
  activity_ref: douyin_lead_outreach.preflight
  activity_version: 4.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 取得已授权触达上下文

仅执行 `douyin_lead_outreach.preflight`。业务合同版本为 `4.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-104/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_lead_outreach.yaml)的 `preflight` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Device`：`serial`、`host`、`lock_holder`。
- 输入 `Account`：`platform`、`profile`、`sender_id`、`dm_paused`、`daily_cap`。
- 输入 `Lead`：`douyin_id`、`profile_url`、`intent_grade`、`repeat_hits`、`status`。
- 输入 `RecipientQualification`：`line_key`、`comment_id`、`status`、`company_id`、`company_version`、`native_profile_sha256`、`reason`、`tenant_id`、`policy_id`。
- 输出 `Device`：`online`、`call_state`、`lock_holder`。
- 输出 `Account`：`logged_in`。
- 输出 `Run`：`run_tag`、`profile`、`serial`。
- 输出 `OutreachOrder`：`sender_id`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 本Activity独立于102预检。读取本公司已启用104配置、当前发送账号/profile/serial、批准话术、目标范围和当前限额，缺项不能从其他公司补。
2. 核对实际部署release、运行绑定、发送授权、真实登录账号、设备空闲及双层锁owner；已有本会话授权持续有效，不重复索要。
3. 核对现行暂停、冷却、风险与额度。Skill不绕过暂停或换账号绕风控；已授权迁移暂停也只能走精确hash/owner可回读恢复步骤。
4. 检查canonical合格订单、prepared/已发送/未知历史和独占执行权。原动作结果未知先读回；预检不点击发送、不自动清除prepared。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-104/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
