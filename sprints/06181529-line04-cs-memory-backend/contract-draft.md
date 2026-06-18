# Sprint Contract Draft (Round 1) — Line04 对话记忆三层后端

## 已知约束（来自回归测试）

- [services/wechat/__tests__/contact-memory.test.ts] appendMessage 发一条 INSERT 到 `zenithjoy.wechat_messages`（旧 contact_key-only 引擎，本刀不动它）
- [services/wechat/__tests__/contact-memory.test.ts] getShortTerm 默认 limit=12，DESC 查询翻转成 ASC（最旧→最新）
- [services/wechat/__tests__/contact-memory.test.ts] consolidate LLM 抛错 / 非法 JSON → 静默跳过不抛、不破坏库（容错纪律，新三层服务沿用此降级精神）
- [services/wechat/__tests__/context-assembler.test.ts] 空 memory / 空 shortTerm 不报错，只输出最新消息段
- [中间件] `middleware/tenant-context.ts`：缺 session 也无 X-Feishu-User-Id → 401；用户无 tenant → 403 NO_TENANT（租户解析机制复用，不新建）
- [集成基线] `tests/integration/p4-wechat-cs-engine/*.integration.test.ts`：真 Postgres `zenithjoy_test` + 自动迁移，仅 mock 外部 SaaS（OpenRouter `global.fetch` / 飞书 axios）—— 本刀 E2E 沿用同款真链路

> **与既有 `contact-memory.ts` 的关系**：旧引擎按 `contact_key` 单键、阈值触发固化，**无 tenant 隔离、无按天 summary**，且处于 listen_chat 回复主链路（本刀范围外）。本刀**新建** tenant 隔离的三层记忆（per `tenant_id × contact` + 按天 summary），物理独立于旧表，互不影响。

---

## Response Schema（推导来源: NEW_PATTERN + api_registry 推导）

> registry 为空，按 `routes/wechat.ts` 现有 plain-JSON 风格推导（成功 plain 对象；错误 `{error:<string>, message:<string>}`，见 wechat.ts:373）。租户来源：`X-Tenant-Id` 头 或 `body.tenant_id`（复用 `tenantContextOptional` 风格），缺则拒绝。

### Endpoint: POST /api/wechat/memory/message （Golden Path Step 1 — 写消息进短期）
**Request**: `{contact: string, role: "in"|"out", text: string}`；租户经 `X-Tenant-Id` 头或 `body.tenant_id`
**Success (HTTP 200)**:
```json
{"ok": true, "message_id": 123, "tenant_id": "tenantA", "contact": "wxid_c"}
```
- `ok` (boolean, 必填): NEW_PATTERN（沿用 wechat.ts `{ok:true}` 风格，禁用同义 `success`）
- `message_id` (number, 必填): 新插入短期行 id（禁用同义 `id`/`msgId`）
- `tenant_id` (string, 必填): 回显当前租户（隔离可观察）
- `contact` (string, 必填): 回显联系人
**禁用字段名**: `success`, `id`, `msgId`, `data`
**Error (HTTP 400)**:
```json
{"error": "MISSING_TENANT", "message": "缺 tenant_id，拒绝写入，不回退全量"}
```
另：缺 contact/role/text → `{"error":"MISSING_FIELDS","message":...}`；`role` 非 in/out → 400。

### Endpoint: POST /api/wechat/memory/consolidate （Golden Path Step 2/3 — 触发日收尾）
**Request**: `{contact: string, day?: "YYYY-MM-DD"}`（day 省略=今天）
**Success (HTTP 200)**:
```json
{"ok": true, "tenant_id": "tenantA", "contact": "wxid_c", "day": "2026-06-18", "daily_generated": true, "folded": false}
```
- `daily_generated` (boolean, 必填): 当天有短期消息→生成/更新中期 summary=true；当天无消息→false（不生成空中期）
- `folded` (boolean, 必填): 是否把早于 `day` 的中期 summary 并入长期=true
**禁用字段名**: `success`, `summarized`, `merged`
**Error (HTTP 400)**: `{"error":"MISSING_TENANT","message":...}`

### Endpoint: GET /api/wechat/memory/context?contact=X （Golden Path Step 4 — 取回复上下文）
**Success (HTTP 200)**:
```json
{"ok": true, "tenant_id": "tenantA", "contact": "wxid_c",
 "context": {"longterm": "...", "mid": "...", "short": [{"role":"in","text":"你好"}]},
 "assembled": "[长期记忆]\n...\n\n[近期摘要]\n...\n\n[最近对话]\n客户: 你好"}
```
- `context.longterm` (string, 必填): 长期融合 summary（无→空串）
- `context.mid` (string, 必填): 中期 summary（未并入长期的近期日 summary 拼接；无→空串）
- `context.short` (array<{role:string,text:string}>, 必填): 最近 N 条原文滑窗（最旧→最新；无→`[]`）
- `assembled` (string, 必填): 三层拼接好的可直接喂模型上下文
**禁用字段名**: `long_term`, `medium`, `short_term`, `history`, `messages`, `summary`(顶层)
**Error (HTTP 400)**: 缺 tenant → `{"error":"MISSING_TENANT","message":...}`

### DB Schema（新建 migration，`zenithjoy` schema，per tenant_id × contact）
- `zenithjoy.cs_memory_messages`（短期原文）: `id BIGSERIAL PK, tenant_id TEXT NOT NULL, contact TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('in','out')), text TEXT NOT NULL, msg_day DATE NOT NULL DEFAULT (now()::date), created_at TIMESTAMPTZ NOT NULL DEFAULT now()`；index `(tenant_id, contact, created_at)`
- `zenithjoy.cs_memory_daily`（中期日 summary）: `id BIGSERIAL PK, tenant_id TEXT NOT NULL, contact TEXT NOT NULL, summary_day DATE NOT NULL, summary TEXT NOT NULL, folded BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`；UNIQUE `(tenant_id, contact, summary_day)`
- `zenithjoy.cs_memory_longterm`（长期融合 summary）: `tenant_id TEXT NOT NULL, contact TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', merged_through_day DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, contact)`
> 全部用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`（幂等，E2E smoke 可重入）。

### 服务降级策略（PRD「summarization 失败不破坏三层数据」倒推）
summarization 经 `callOpenRouter`（`apps/api/src/llm/openrouter`，无 key 即 throw）。**降级**：LLM 抛错/超时 → 捕获，回落到确定性本地 summary（当天原文按 `角色: 文本` 截断拼接，≤500 字），中期/长期层仍被写入且非空，三层数据不破坏。空天（当天无消息）→ 不写空中期（daily_generated=false）。

---

## Golden Path

[写消息] → [短期累积(tenant×contact)] → [日收尾→中期] → [跨天收尾→并入长期] → [取回复上下文=长期+中期+短期] →（隔离 A≠B）→（缺 tenant 拒绝）

### Step 1: 以某租户写入一条消息进短期
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条「写入一条消息（tenant_id+contact+role+text）→ 进短期」

**可观测行为**: POST /message（带 tenant A）→ 200 `{ok:true, message_id}`；DB `cs_memory_messages` 新增一行属于租户 A、5 分钟内。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "写消息进短期"
```
**硬阈值**: 测试内 `SELECT count(*) ... WHERE tenant_id='tenantA' AND contact=$c AND created_at > NOW() - interval '5 minutes'` ≥ 2 → exit 0

---

### Step 2: 触发当天收尾 → 生成今天中期 summary
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「触发当天收尾 → 把今天短期内容生成中期」

**可观测行为**: POST /consolidate（tenant A, day=today）→ 200 `daily_generated:true`；`cs_memory_daily` 出现 (A, contact, today) 非空 summary 行，5 分钟内；当天无消息时 `daily_generated:false` 且**不写空中期**。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "日收尾"
```
**硬阈值**: 中期行存在且 `length(summary)>0`；空天 case `count(cs_memory_daily)=0` → exit 0

---

### Step 3: 跨天再次收尾 → 把昨天的中期并入长期（融合压缩）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条「跨天再次收尾 → 把昨天的中期 summary 并入长期」

**可观测行为**: 已有昨天中期 + 今天消息，POST /consolidate（day=today）→ `folded:true`；`cs_memory_longterm` 行 summary 非空且 `merged_through_day >= yesterday`；昨天那条 daily 标 `folded=true`。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "并入长期"
```
**硬阈值**: `cs_memory_longterm.summary` 非空且 5 分钟内 updated；昨天 daily.folded=true → exit 0

---

### Step 4: 取回复上下文 → 长期+中期+短期三层拼接
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条「查回复上下文 → 返回 长期 summary + 中期 summary + 短期原文 拼好的上下文」

**可观测行为**: GET /context?contact=X（tenant A）→ 200，`context` 含 `longterm/mid/short` 三键齐全，`assembled` 同时含三层内容；无任何记忆的 (tenant×contact) → 空上下文（不报错、不串别人）。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "三层拼接"
```
**硬阈值**: `jq -e '.context | keys == ["longterm","mid","short"]'` 成立；`assembled` 同含三层标识；禁用字段不出现 → exit 0

---

### Step 5（隔离）: 租户 A 查只见 A 的记忆，绝无 B
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条 + 边界「同一 contact 名在不同租户下各自独立，互不污染」

**可观测行为**: A、B 对同一 contact 各写不同内容并各自收尾；A 的 /context 含 A 独有串、绝不含 B 独有串；B 反之。DB 层 `cs_memory_messages WHERE tenant_id='B' AND text LIKE '%A独有串%'` = 0。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "隔离"
```
**硬阈值**: A 上下文不含 B 串、B 上下文不含 A 串（双向）；跨租户泄漏 count=0 → exit 0

---

### Step 6（异常）: 写/查缺 tenant_id → 拒绝，不回退、不串租户
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条 + 边界「缺 tenant_id → 拒绝，禁止 fallback」

**可观测行为**: 不带 `X-Tenant-Id` 且 body 无 `tenant_id` 的 POST /message、POST /consolidate、GET /context → 400 `{error:"MISSING_TENANT"}`；**绝不**返回全量/他人数据。

**验证命令**:
```bash
cd apps/api && DATABASE_NAME=zenithjoy_test npx vitest run --config vitest.integration.config.ts tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts -t "缺 tenant_id"
```
**硬阈值**: 三个端点缺 tenant 均返 400 + `error` 为字符串 "MISSING_TENANT"；响应体不含任何 contact 记忆 → exit 0

---

## E2E 验收（final-e2e — target_environment=local_api：boot apps/api + curl|jq + psql 时间窗）

**journey_type**: autonomous
**target_environment**: local_api

> 写入 `${SPRINT_DIR}/e2e/golden-path-smoke.sh`。在本地/CI 起真 apps/api 服务（zenithjoy_test 库），HTTP 层端到端验证 Golden Path 六步：写消息(A/B) → 收尾 → 取上下文三层拼接 → 隔离 → 缺 tenant 拒绝，并用 psql 带 5 分钟时间窗断言落库。consolidate 阶段无 OPENROUTER_API_KEY 时走确定性降级 summary（仍非空），脚本输出确定不依赖外网。

完整脚本见 `${SPRINT_DIR}/e2e/golden-path-smoke.sh`，PASS 标准 = 脚本 exit 0。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 服务契约（缺 tenant 拒绝 / 三层装配 / 隔离逻辑）| `${SPRINT_DIR}/tests/tenant-memory.test.ts`（unit, mock pool）| Step 1/4/5/6 | 模块 `tenant-memory` 不存在 → import 失败 → N failures |
| 端到端真链路（routes+service+真 DB，仅 mock OpenRouter）| `apps/api/tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts` | Step 1-6 全覆盖 | 服务/路由/迁移未实现 → 全红 |
| HTTP final-e2e | `${SPRINT_DIR}/e2e/golden-path-smoke.sh` | Golden Path 六步 HTTP+psql | 路由 404 → exit 1 |
