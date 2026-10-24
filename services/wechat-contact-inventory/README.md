# 微信个人与群聊首次登记（候选）

本服务是本机私有待分类收件箱，不直接连接微信、生产 CRM、Notion 或客服发送器。
手机采集由受控微信工具完成；它将同一次运行的原图、UI 树和观察交给本入口。
没有实际登录、账号核验或原始证据时，`ingest` 明确拒绝，不能用空名册报告成功。

对应开发任务：`f99a43d1-7e85-47cc-a72a-9de99fbaef4e`。
业务归属锚点：`cs_shared_binding`。整体 workflow 与技能由中心技能仓维护。

## 入口

仅依赖 Python 3 标准库。以下路径由当次私有运行绑定提供：

```text
python3 <runtime_root>/services/wechat-contact-inventory/cli.py ingest --db <private.sqlite> --input <observation.json> --out <ingest-receipt.json>
python3 <runtime_root>/services/wechat-contact-inventory/cli.py export-review --db <private.sqlite> --account-key <ingest回执中的account_key> --out <review.json或review.csv>
python3 <runtime_root>/services/wechat-contact-inventory/cli.py apply-review --db <private.sqlite> --input <review.json或review.csv> --actor <实际确认人> --out <review-receipt.json>
python3 <runtime_root>/services/wechat-contact-inventory/cli.py eligible --db <private.sqlite> --account-key <同一account_key> --out <eligibility.json>
```

结果与 SQLite 为 600 权限；目录首次创建为 700。stdout 只打印状态、数量与输出位置，失败为
脱敏原因和退出码 2。成功为退出码 0。拒绝不写成功输出，调用者保留 stdout 为失败回执。
输出不能覆盖数据库、输入或原始采集证据。

## 观察合同 1.0.0

```json
{
  "schema_version": "1.0.0",
  "run_id": "本次唯一运行标识",
  "observed_at": "2026-10-24T10:00:00+08:00",
  "account": {
    "tenant_id": "实际组织标识",
    "wechat_account_id": "已实屏核验的本机微信标识",
    "device_serial": "实际设备标识"
  },
  "preflight": {"status": "ready", "login_status": "verified", "call_state": "idle"},
  "account_verified": true,
  "account_evidence_ids": ["account-proof"],
  "coverage": {
    "scope": "visible_excerpt",
    "complete": false,
    "pages_observed": ["本轮实际读取页面"],
    "not_covered": ["未读取的页面或范围"]
  },
  "evidence": [{
    "evidence_id": "account-proof",
    "run_id": "与顶层相同",
    "kind": "screenshot",
    "path": "本执行节点原始PNG绝对路径",
    "sha256": "原文件SHA256"
  }],
  "observations": [{
    "observation_id": "本run内唯一观察标识",
    "kind": "person",
    "display_name": "实屏名称",
    "stable_id": null,
    "identity_verified": false,
    "identity_evidence_ids": [],
    "evidence_ids": ["account-proof"]
  }]
}
```

`kind` 为 `person` / `group`。稳定微信或群 ID 确实已核验时，填写 `stable_id`、
`identity_verified=true` 及同 run 的原始身份截图引用；不能从昵称、群名或成员推测身份。
证据类型为 `screenshot`（原始 PNG）或 `ui_tree`（非空 hierarchy XML），均须真实文件和
匹配 SHA256。每个观察及账号身份至少引用一份截图。程序检查文件身份、摘要和引用关系；
不会替执行者判读截图内容，内容真实性仍须独立验收。

当前候选仅接受部分可见盘点，拒绝 `complete=true` / 未验证的全量声明。空观察仅在实屏
明确空状态且 `empty_state_verified=true` 时接受。登录页、未知账号和空 UI 树不是空名册。

`account_key` 从组织与本机微信标识生成，调用者只能引用回执，不自行拼接。设备作为扫描
来源保留；同一已核验账号迁机保持原记录及人工决策。不同账号、组织隔离。
有稳定身份的同一渠道可跨扫描归并；缺身份的记录按 run 与 observation 暂存，跨 run 不按
昵称自动合并。相同 run 重放必须完全相同，改变原包或证据则拒绝。

## 人工审阅与后续门禁

`export-review` 生成 `kind=contact_inventory_review` 包：
`schema_version`、`snapshot_id`、`account_key`、`batch_run_id`、`account`、`coverage`、`records`。
每行包含 `record_id`、`revision`、`kind`、`display_name`、`stable_id`、`identity_verified`、
`requires_identity_confirmation`、`classification`、`customer_refs`、`project_refs`、
`collect_enabled`、`auto_reply_enabled=false`、`evidence_ids`。

人工只修改 `classification`、`customer_refs`、`project_refs`、`collect_enabled`：

- 分类为 `pending` / `customer` / `internal` / `private` / `excluded`，新项均为 pending。
- 标为 customer 须有客户主档引用；多客户群允许多个引用。群是沟通渠道，成员不自动建客户。
- collect_enabled 默认 false；改为 true 还必须是已确认 customer、有客户引用及已核验稳定身份。
- 自动回复始终 false，任何导入试图改为 true 都拒绝。该服务没有发送或回复入口。
- 身份、证据、账号、批次、snapshot 与记录修订均不可改。任一行过期或非法，整批回滚。
- 重复导入同一已消费快照与同一确认人、同一内容仅返回 replay；改动后必须重新导出。
- 重扫保留人工分类与关联。人工撤销采集同样记审计；旧快照不能恢复旧授权。

CSV 与 JSON 合同相同，引用数组使用 JSON 单元格，布尔仅 true/false。CSV 导出避免电子表格
公式执行；不要用姓名或群名作为主键。纯 CSV 不包含完整账号与覆盖说明，须连同 JSON
或原始运行包审阅。不能把该本地候选收件箱称为已经同步到生产 CRM/Notion 的工作面。

`eligible` 仅计算本地分类门槛，输出允许与阻塞条目，`collection_actions=0`、
`auto_reply_actions=0`、`production_crm_writes=0`。实际新增消息采集仍需同次运行的设备/账号
预检、收集入口与业务库回读；本候选不假装已实现这些外部行为。

## 验证

```text
python3 -m unittest discover -s services/wechat-contact-inventory/tests -v
```

测试使用隔离 SQLite、真实文件与并发 CLI，覆盖重放、账号隔离、迁机、同名未核验身份、
群多客户关联、人工审阅冲突、撤销、空/登录失败拒绝、输出路径保护和 CSV 公式安全。
夹具测试不证明真实云手机盘点成功；云手机运行证据由整体 workflow 单独保存。
