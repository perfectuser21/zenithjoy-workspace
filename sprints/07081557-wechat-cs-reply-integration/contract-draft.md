# Contract Draft — wechat-cs-reply 判断内核接入

## 元数据

| 字段 | 值 |
|------|-----|
| sprint_dir | sprints/07081557-wechat-cs-reply-integration |
| task_id | e74341f4-3c8a-4cce-80c2-4c52afaedb85 |
| journey | Line04 客户私域 AI 接管 |
| 本轮推进 | Step3 私聊 LLM 自动回复：自由生成 → wechat-cs-reply 规则内核约束 |
| contract 版本 | v2（GAN R1 revision） |

---

## E2E 验收

本 sprint 的 E2E 验收由以下两类测试覆盖：

### 1. 单元/集成测试（vitest）

目标文件：`apps/api/tests/services/wechat-draft.test.ts`（新增三类场景）

运行命令：
```bash
cd apps/api && npx vitest run tests/services/wechat-draft.test.ts
```

### 2. Smoke 脚本（curl + DB 验证）

目标文件：`.github/workflows/scripts/smoke/wechat-cs-reply-smoke.sh`

运行命令：
```bash
bash .github/workflows/scripts/smoke/wechat-cs-reply-smoke.sh
```

引用脚本骨架：`sprints/07081557-wechat-cs-reply-integration/tests/e2e-verify.sh`

### E2E 全通判定

以下全部为 ✅ 才算 sprint DONE：

| 检查项 | 验证方式 |
|--------|---------|
| wechat-draft 新三类场景 vitest | `vitest run tests/services/wechat-draft.test.ts` |
| wechat-cs-reply-smoke.sh 通过 | `bash scripts/smoke/wechat-cs-reply-smoke.sh` |
| 原有 4 场景不回归 | 同上 vitest（群/黑名单/正常/ai_failed） |
| DB migration 幂等执行 | `psql` 执行 migration SQL 两次无报错 |

---

## Test Contract 表

| # | [BEHAVIOR] 条目 | 测试文件 | `it()` 名称 |
|---|----------------|---------|-------------|
| B-1 | 正常对话：wechat-draft 调用 wechat-cs-reply 内核，callOpenRouter 返回含 JSON 的文本，reply 和 tags 解析成功，status=sent | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：正常对话 → JSON 解析成功，reply 非空，tags.stage/escalate 可读` |
| B-2 | JSON 缺失兜底：模型首次输出不含 JSON → 触发重试（追加提示）→ 第二次仍失败 → 正则兜底读安全默认值，不返回空 reply | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：JSON 缺失 → 重试一次 + 正则兜底，仍返回非空 reply` |
| B-3 | escalate=true：客户收到 reply（非空安抚文案）+ wechat_publish_task 新增 cs_escalate 行（approval_source='system'） | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：tags.escalate=true → 客户收到安抚 reply + DB 写入 cs_escalate 行` |
| B-4 | stage 回写：tags.stage 有值（A1-A4）→ PUT /api/crm/customers/status 被调用 + crm_customer_status_history 新增 changed_by='ai_inferred' 行 | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：tags.stage=A2 → crm_customers.status 更新 + history 行 changed_by=ai_inferred` |
| B-5 | 编造词命中（Invariant I-1）：sanitizeReply 命中 → status=ai_failed，不返回 reply，不写 DB | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：reply 含编造词 → ai_failed，不发，不写 DB`（继承原有场景加断言） |
| B-6 | escalate 入队失败（Invariant I-2）：DB 写 wechat_publish_task 报错 → console.warn 吞掉，客户仍收到 reply | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：escalate DB 写入失败 → console.warn + reply 正常返回` |
| B-7 | 群消息不回（Invariant I-6，回归）：is_group=true → skip_group，不调 LLM，不触发 cs-reply 内核 | `tests/services/wechat-draft.test.ts` | 复用原有 `群消息 is_group=true → status:skipped` |
| B-8 | 多租户 CRM 写入隔离（Invariant I-3）：stage 回写 PUT /api/crm/customers/status 必须带 tenant_id，通过 requireCsWriteAccess 闸；不同租户的 crm_customers 行不互相覆盖。注：多租户鉴权由 requireCsWriteAccess 中间件层统一保证，合同测试侧重验证 generateChatDraft 写 DB 时 tenant_id 字段正确传入（不为空、不错租），无需重复测试中间件本身。 | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：stage 回写携带正确 tenant_id，不写入其他租户行` |
| B-9 | reasoning_content 剥离（Invariant I-4）：callOpenRouter 返回含 reasoning_content 字段时，generateChatDraft 的 result.reply 不包含 reasoning_content 内容，最终 reply 只含用户可见回复文本 | `tests/services/wechat-draft.test.ts` | `cs-reply 内核接入：callOpenRouter 返回含 reasoning_content → result.reply 不含思考链内容` |

### Smoke 脚本覆盖（curl + DB 断言）

> **[ARTIFACT] smoke-script 说明**：smoke 覆盖 escalate + stage history 两类需真实链路验证的场景（S-1/S-2）。编造词拦截（原 S-3）属于纯逻辑断言，依赖 LLM 输出不确定，已明确归 vitest B-5 层覆盖，不在 smoke 脚本中重复。

| # | 场景 | smoke 断言 |
|---|------|-----------|
| S-1 | escalate=true 路径 | `SELECT COUNT(*) FROM zenithjoy.wechat_publish_task WHERE reason='cs_escalate'` ≥ 1 |
| S-2 | stage 回写路径 | `SELECT changed_by FROM zenithjoy.crm_customer_status_history ORDER BY id DESC LIMIT 1` = 'ai_inferred' |
| S-3 | migration 幂等 | migration SQL 执行两次，第二次无 ERROR |

---

## 不包含（本 contract 明确排除）

- 人格库 / AB 测试筛选（子项目3，另立 sprint）
- 语气不重复机制 / few-shot 轮换（子项目5，另立 sprint）
- generateMomentDraft 朋友圈（Path4 Step4-5，不动）
- zenithjoy-skills 仓库重命名（另起 PR）
