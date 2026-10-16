---
name: douyin-leadgen-activity-103-mark-leads
description: 交出原生身份核实的线索与配送状态。用于按评分保留线索、独立资格核对并配送或接手同一标记 Activity；不执行整个工作流。
metadata:
  version: 0.1.2
  activity_ref: douyin_comment_scoring.mark_leads
  activity_version: 3.1.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出原生身份核实的线索与配送状态

仅执行 `douyin_comment_scoring.mark_leads`。业务合同版本为 `3.1.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-103/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_comment_scoring.yaml)的 `mark_leads` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Comment`：`dedup_key`、`body`、`nickname`、`douyin_id`、`profile_url`、`process_status`、`recipient_evidence`。
- 输入 `Video`：`title`、`transcript`。
- 输出 `Comment`：`process_status`、`relevance`、`intent_grade`、`promoted`。
- 输出 `Lead`：`line_key`、`douyin_id`、`nickname`、`profile_url`、`intent_grade`、`repeat_hits`、`status`。
- 输出 `RecipientQualification`：`line_key`、`comment_id`、`status`、`company_id`、`company_version`、`native_profile_sha256`、`reason`、`tenant_id`、`policy_id`。
- 输出 `OutreachBridgeIntent`：`line_key`、`comment_id`、`lead_id`、`run_tag`、`source_run`、`qualification_status`、`state`、`payload_sha256`、`fields_sha256`、`feishu_record_id`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 消费已持久评分，按原公司规则保留线索与重复出现次数；不修改评分标准或把所有评分行直接变成104ready。
2. 独立核对评论人的原生主页/稳定身份和冻结公司受众条件；证据不足或模型未验证保持unknown，昵称/相似账号不能放行。
3. 复用原事务保存comment→lead关联和durable outbox，线索落实后再推进评论状态；异常回滚/未决须保留。
4. 按原桥接协议先持久动作身份再单次外部创建。响应未知先按原marker/UID/完整字段读回，不重复POST、不修改受保护或已发送的历史行。
5. 分别交出PG线索创建、资格passed/excluded/unknown、配送confirmed/held/unknown。仅同公司版本、资格passed且交付confirmed的订单可供104消费。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-103/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。

## 本轮冻结账号来源

带company_binding的评论，按原102 harvest_batch只读原PG冻结来源及选定设备，不能从评论自报profile或当前账号表补授权；来源公司/租户须同当前冻结评分公司，原评分规则保持。103标人、配送与读回沿此来源；云profile的104触达仍未授权，不因103配送成功自动放行。
