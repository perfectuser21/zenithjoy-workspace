---
name: douyin-leadgen-activity-104-send-dm
description: 交出一次可核验的批准私信发送结果。用于执行已授权单次私信或接手同一触达 Activity；不执行整个工作流。
metadata:
  version: 0.1.0
  activity_ref: douyin_lead_outreach.send_dm
  activity_version: 3.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出一次可核验的批准私信发送结果

仅执行 `douyin_lead_outreach.send_dm`。业务合同版本为 `3.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-104/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_lead_outreach.yaml)的 `send_dm` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Lead`：`douyin_id`、`profile_url`、`intent_grade`、`repeat_hits`、`status`。
- 输入 `Account`：`profile`、`sender_id`、`dm_paused`、`daily_cap`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输出 `OutreachOrder`：`lead_record_id`、`douyin_id`、`sender_id`、`script_id`、`message`、`result`。
- 输出 `Lead`：`status`、`send_status`、`script_id`、`sender_id`、`reached_at`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 只使用本公司原canonical订单及批准正文。按当前来源领取唯一合格订单，核对稳定目标UID/主页、发送账号、模板与准确内容；没有合格订单记empty。
2. 沿订单原生主页链接进入并核对真实目标。深链降为搜索或返回相似账号时重新核对稳定身份，不能按昵称相似发送。
3. 发送前必须由正式状态机确认同一持久动作prepared及独占执行权；保存同一目标、账号、内容哈希和发送前会话证据。没有受控单Activity接口时保持blocked，不用裸controller替代业务prepare。
4. 执行一次真实发送，核对同一会话、准确正文、新气泡增量、前台与风险原件。已存在气泡不算新发，不重复点击。
5. 超时、崩溃、平台限制或写回缺失时先查原动作和原会话。已发只交写回；结果未知保留prepared，不再发送。只证明发出，不推断送达或已读。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-104/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
