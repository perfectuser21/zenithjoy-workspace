# Contract DoD — wechat-cs-reply 判断内核接入

## 元数据

| 字段 | 值 |
|------|-----|
| sprint_dir | sprints/07081557-wechat-cs-reply-integration |
| task_id | e74341f4-3c8a-4cce-80c2-4c52afaedb85 |
| journey | Line04 客户私域 AI 接管（bfeed805-deed-46c3-8624-87f0028101d4） |

---

## [BEHAVIOR] 条目

[BEHAVIOR] B-1 正常对话解析：给定正常私聊消息，generateChatDraft 调用 wechat-cs-reply 内核后，callOpenRouter 返回的文本包含合法 JSON `{ reply, tags }`，reply 字段非空字符串，tags.stage/escalate 字段可读取，函数返回 `{ ok: true, status: 'sent', reply: <非空字符串> }`。

[BEHAVIOR] B-2 JSON 缺失兜底：callOpenRouter 首次返回不含 JSON 格式的纯文本时，generateChatDraft 追加"上次漏了 JSON，这次必须补上"后重试一次；若第二次仍无 JSON，正则兜底提取 reply（取首个非空行作为安全默认值）；最终函数不返回空 reply，不抛出异常，callOpenRouter 共被调用 2 次。

[BEHAVIOR] B-3 escalate=true 转人工：tags.escalate === true 时，generateChatDraft 仍向客户返回安抚 reply（status='sent'，reply 非空），同时向 zenithjoy.wechat_publish_task 插入一行（type='private_chat'，reason='cs_escalate'，approval_source='system'）；DB 写入失败时 console.warn 吞掉，客户仍收到 reply（不因 escalate 入队失败而阻塞对话）。

[BEHAVIOR] B-4 stage 标签 CRM 回写：tags.stage 含合法值（A1/A2/A3/A4）时，generateChatDraft 触发 PUT /api/crm/customers/status（changed_by='ai_inferred'），crm_customers.status 更新为新值，crm_customer_status_history 新增一行且 changed_by='ai_inferred'；changed_by 的 CHECK 约束只允许 'ai_inferred' 或 'manual'。

[BEHAVIOR] B-5 编造词拦截（Invariant I-1）：reply 过 sanitizeReply 命中编造词（价格/退款/保成交类）时，generateChatDraft 返回 `{ ok: true, status: 'ai_failed' }`，不含 reply 字段，不向 wechat_publish_task 写任何行，不把占位文案发给客户。

[BEHAVIOR] B-6 escalate 旁路不阻塞（Invariant I-2）：zenithjoy.wechat_publish_task INSERT 失败（DB 抛错）时，generateChatDraft 仅 console.warn 记录，客户仍收到 reply（status='sent'），不因 escalate 入队失败而返回 ai_failed。

[BEHAVIOR] B-7 群消息不回（Invariant I-6，回归）：is_group=true 时，generateChatDraft（或上游 decideAutoSendRoute）在调用 LLM 前直接返回 `{ ok: true, status: 'skipped', reason: 'skip_group' }`，callOpenRouter 不被调用，不触发 cs-reply 内核。

[BEHAVIOR] B-8 多租户 CRM 写入隔离（Invariant I-3）：tags.stage 回写时，generateChatDraft 向 DB 写入的 crm_customer_status_history 行必须携带正确的 tenant_id（与请求的 tenant_id 一致），不写入其他租户的行。注：requireCsWriteAccess 中间件层已在路由层保证鉴权，合同测试此处仅验证 generateChatDraft 正确传递 tenant_id 到 DB 写操作（字段非空、非错租）。

[BEHAVIOR] B-9 reasoning_content 剥离（Invariant I-4）：callOpenRouter 返回对象含 reasoning_content 字段时，generateChatDraft 最终返回的 result.reply 字符串不包含 reasoning_content 的任何内容；reply 只含用户可见的纯文本回复，思考链禁止泄露给客户。

---

## manual:bash 可执行验收命令

### 单元/集成测试
```bash
manual:bash cd /workspace/apps/api && npx vitest run tests/services/wechat-draft.test.ts 2>&1 | tail -20
```

### Smoke 脚本（escalate DB 行）
```bash
manual:bash bash /workspace/.github/workflows/scripts/smoke/wechat-cs-reply-smoke.sh
```

### DB 直查：stage 回写验证
```bash
manual:bash psql "$DATABASE_URL" -c "SELECT contact, new_status, changed_by, changed_at FROM zenithjoy.crm_customer_status_history WHERE changed_by='ai_inferred' ORDER BY changed_at DESC LIMIT 5;"
```

### DB 直查：escalate 任务行验证
```bash
manual:bash psql "$DATABASE_URL" -c "SELECT task_id, type, reason, approval_source, created_at FROM zenithjoy.wechat_publish_task WHERE reason='cs_escalate' ORDER BY created_at DESC LIMIT 5;"
```

### Migration 幂等验证（执行两次无 ERROR）
```bash
manual:bash psql "$DATABASE_URL" -f /workspace/apps/api/db/migrations/20260708_130000_crm_status_history_changed_by.sql && psql "$DATABASE_URL" -f /workspace/apps/api/db/migrations/20260708_130000_crm_status_history_changed_by.sql && echo "migration 幂等 PASS"
```

### changed_by CHECK 约束验证（应报错）
```bash
manual:bash psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact, new_status, changed_by) VALUES ('00000000-0000-0000-0000-000000000000','test','test','A1','robot');" 2>&1 | grep -i "check\|error\|violat" || echo "WARN: CHECK 约束未生效"
```

---

## [ARTIFACT] 断言条目

[ARTIFACT] migration-sql：`apps/api/db/migrations/20260708_130000_crm_status_history_changed_by.sql` — 存在且包含 `ADD COLUMN IF NOT EXISTS changed_by`、`CHECK (changed_by IN ('ai_inferred','manual'))`、历史行回填 `UPDATE ... SET changed_by='manual'`。

[ARTIFACT] smoke-script：`.github/workflows/scripts/smoke/wechat-cs-reply-smoke.sh` — 存在且包含至少 5 行实质内容（不是 `exit 0` 占位），包含 `psql` 或 `curl` 真实链路调用，覆盖 escalate DB 行（S-1）和 stage history 行（S-2）两类场景；编造词拦截（Invariant I-1）属纯逻辑断言，已由 vitest B-5 层覆盖，smoke 不重复。

[ARTIFACT] wechat-draft-tests：`apps/api/tests/services/wechat-draft.test.ts` — 新增 B-1～B-4 四类 `it()` 块，原有 4 个场景（群/黑名单/正常/ai_failed）继续保留。

[ARTIFACT] context-assembler-update：`apps/api/src/services/wechat/context-assembler.ts` — `assembleChatContext` 函数签名接受可选 `csReplyRules` 参数，wechat-cs-reply 规则段在 system prompt 中可注入。

[ARTIFACT] crm-route-changed-by：`apps/api/src/routes/crm.ts` — `PUT /api/crm/customers/status` 端点接受可选 `changed_by` 字段（合法值：'ai_inferred'|'manual'，默认 'manual'），并写入 crm_customer_status_history。

---

## DoD 全通检查清单

- [ ] B-1 ~ B-9 全部有对应 `it()` 并通过 vitest
- [ ] wechat-cs-reply-smoke.sh 存在且 CI 通过（S-1 escalate + S-2 stage history）
- [ ] migration SQL 幂等（执行两次无 ERROR，S-3）
- [ ] changed_by CHECK 约束有效（非法值插入失败）
- [ ] 原有 4 场景（群/黑名单/正常/ai_failed）无回归
- [ ] Invariant I-1～I-6 在代码和测试中均有覆盖
