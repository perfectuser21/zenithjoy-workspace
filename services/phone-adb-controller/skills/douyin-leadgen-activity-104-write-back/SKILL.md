---
name: douyin-leadgen-activity-104-write-back
description: 交出原订单状态的独立读回。用于写回真实发送结果或接手已发未回写 Activity；不执行整个工作流。
metadata:
  version: 0.1.0
  activity_ref: douyin_lead_outreach.write_back
  activity_version: 3.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出原订单状态的独立读回

仅执行 `douyin_lead_outreach.write_back`。业务合同版本为 `3.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-104/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_lead_outreach.yaml)的 `write_back` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Lead`：`douyin_id`、`profile_url`、`intent_grade`、`repeat_hits`、`status`。
- 输入 `Account`：`profile`、`sender_id`、`dm_paused`、`daily_cap`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输入 `OutreachOrder`：`lead_record_id`、`result`。
- 输出 `OutreachOrder`：`lead_record_id`、`douyin_id`、`sender_id`、`script_id`、`message`、`result`。
- 输出 `Lead`：`status`、`send_status`、`script_id`、`sender_id`、`reached_at`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 读取本轮原发送receipt及持久动作身份，核对原prepared marker、稳定目标、发送账号、批准正文哈希和原订单。没有真实发送证据不写成功。
2. 只调用原写回/读回协议更新同一原行。sent、受限、失败和unknown分别保存，不把进程exit0当发送成功。
3. 写入回复丢失先读回同一原行，已有完全匹配结果可恢复回执；字段不符或结果未知保持未决，不另开写入通路。
4. 本活动不操作手机发送、不重复领单或重发。保留原发送失败证据，交出实际写回字段、原行ID、核验状态和后续条件。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-104/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
