# Path 4 Sprint 1 WS1 — DB schema + 中台路由 + Agent wechat-rpa handler + OpenRouter + rog 部署

**Brain task**: `140c8d7b-fbbd-4a5c-9ac7-dd18e6514a80`
**Branch**: `cp-0513220500-path4-sprint-1-ws1`
**Worktree**: `/Users/administrator/worktrees/zenithjoy/path4-sprint-1-ws1-2`
**Sprint**: Path 4 Sprint 1 (sprint-d-path4-private-ai-thin)
**WS**: 1 of 6 (L size, depends_on: 无)
**Thickness**: thin
**日期**: 2026-05-13

> **本 spec 不重写 sprint contract**, 只做 thin pointer + WS1 范围 + 测试策略 + 关键决策记录。完整 DoD 见:
> - `sprints/sprint-d-path4-private-ai-thin/contract-dod-ws1.md` (在 `cp-05082012-path4-sprint-1-prd` 分支)
> - `sprints/sprint-d-path4-private-ai-thin/task-plan.json` (同分支, WS1 章节)
> - `sprints/sprint-d-path4-private-ai-thin/sprint-contract.md` (同分支)
> 整个 sprint contract 已 **APPROVED round 2** (commit a3fb88c)。

---

## 1. WS1 范围

WS1 = Path 4 Sprint 1 的"基础设施层", 后续 5 个 WS 都依赖它。这一刀必须把骨架立起来不能错。

6 个 ARTIFACT + 8 个 BEHAVIOR DoD 摘要 (完整见 contract-dod-ws1.md):

| # | Artifact | 真测什么 |
|---|---|---|
| 1 | `apps/api/db/migrations/<TS>_create_wechat_publish_task.sql` | 真跑 cecelia DB, INSERT approval_source='system' → CHECK 23514 violation |
| 2 | `apps/api/db/migrations/<TS>_create_llm_audit.sql` | INSERT/SELECT cost/model/tokens/request_purpose |
| 3 | `apps/api/src/llm/openrouter.ts` | OPENROUTER_FORCE_5XX=1 + NODE_ENV=test → throw 含 "simulated 5xx"; CI=true → max_tokens ≤ 20 |
| 4 | `apps/api/src/routes/wechat.ts` (3 endpoint) | POST qr-bind {} → 400 含 platform/agent_id zod 错; draft-review-poll bogus UUID → 404 |
| 5 | `services/agent/src/handlers/wechat-rpa.ts` (NodeJS spawn Python) | dispatch wechat_qr_bind dryrun → 子进程 exit 0 + receipt 含 wechat_id |
| 6 | `scripts/deploy-agent-to-rog.sh` | bash -n + executable |

附带 `apps/api/src/index.ts` (route mount) + `services/agent/src/index.ts` (handler register) 修改。

## 2. 架构 (1 张图)

```
┌─ apps/api ─────────────────────────────────────┐
│                                                │
│ db/migrations/                                 │
│   ├ <TS>_create_wechat_publish_task.sql       │
│   │   (approval_source CHECK enforce A 护栏)   │
│   └ <TS>_create_llm_audit.sql                 │
│                                                │
│ src/llm/openrouter.ts                          │
│   callOpenRouter({prompt, purpose, max_tokens})│
│     ├─ if OPENROUTER_FORCE_5XX & NODE_ENV in   │
│     │  ('test'|'development') → throw simulated│
│     ├─ if CI=true → clamp max_tokens ≤ 20      │
│     ├─ POST openrouter/api/v1/chat/completions │
│     └─ INSERT llm_audit row                    │
│                                                │
│ src/routes/wechat.ts                           │
│   POST /api/wechat/qr-bind                     │
│   GET  /api/wechat/draft-review-poll?task_id=  │
│   POST /api/wechat/scheduler-tick              │
│   (全部 zod schema, 缺字段 400 含字段名)         │
│                                                │
└────────────────────────────────────────────────┘
                       ↑ task_dispatch SSE
┌─ services/agent ───────────────────────────────┐
│                                                │
│ src/handlers/wechat-rpa.ts                     │
│   handle(task) {                               │
│     const py = spawn('python', [               │
│       resolveScript(task.action),              │
│       JSON.stringify(task.payload)             │
│     ])                                         │
│     return parseReceipt(py.stdout)             │
│   }                                            │
│                                                │
└────────────────────────────────────────────────┘

scripts/deploy-agent-to-rog.sh
  rsync services/agent → asus@100.98.253.95:~/zenithjoy-agent
```

## 3. 关键决策

### 3.1 wechat_publish_task 表结构

字段 (按 contract):
- id UUID PK
- agent_id UUID (FK agents)
- task_type ENUM('moments'|'private_chat')
- content TEXT
- target_friend_alias TEXT NULL  (private_chat 必填)
- scheduled_at TIMESTAMP
- status ENUM('draft'|'approved'|'rejected'|'sent'|'failed')
- **approval_source ENUM('feishu_user'|'feishu_api') NOT NULL** with `CHECK (approval_source IN ('feishu_user','feishu_api'))`
- approved_by TEXT NULL
- approved_at TIMESTAMP NULL
- created_at / updated_at

`approval_source` CHECK 强制 A 路线护栏: 任何 INSERT approval_source='system' 必须被 PG 拒绝 (23514)。这是 thin 阶段防 AI 自动发的硬约束。

### 3.2 llm_audit 表结构

- id UUID PK
- request_purpose TEXT ('moments_draft' / 'private_chat_reply' / ...)
- model TEXT (e.g. 'deepseek/deepseek-chat')
- prompt_tokens INT, completion_tokens INT, total_tokens INT
- cost_usd NUMERIC(10,6)
- duration_ms INT
- success BOOL
- error_message TEXT NULL
- created_at

### 3.3 OpenRouter 封装的 5xx 注入

```typescript
if (process.env.OPENROUTER_FORCE_5XX === '1'
    && ['test','development'].includes(process.env.NODE_ENV || '')) {
  throw new Error('OpenRouter simulated 5xx (force test)');
}
```

显式锁 `NODE_ENV in (test,development)` — 生产 NODE_ENV=production 时 5xx 注入 flag 被忽略, 防意外。

### 3.4 CI max_tokens 限流

```typescript
const finalMaxTokens = process.env.CI === 'true'
  ? Math.min(maxTokens ?? 1000, 20)
  : (maxTokens ?? 1000);
```

CI 跑测试时 OpenRouter 真调一次也烧不超 $0.001 (20 token cap)。

### 3.5 zod schema 字段名约束

POST /api/wechat/qr-bind body schema 必须用字段名 `platform` 和 `agent_id` (非 platformId / agentId), 因为 contract DoD 测 grep "platform" + "agent_id" 出现在 400 错误 body 里。

### 3.6 Agent wechat-rpa handler 的 spawn 设计

接 zenithjoy-agent 协议 (Path 1/Path 2 已成熟):
- task.type === 'wechat_qr_bind' / 'wechat_moments_send' / 'wechat_private_chat_send'
- handler spawn Python (`wechat_bot.py` / `wechat_rpa.py`, 后续 WS 真接, 本 WS1 只接 dryrun)
- 通过 stdin 传 JSON payload, stdout 读 JSON receipt
- dryrun task → 子进程 echo `{"wechat_id":"mock_wx_test_001"}` 即可

WS1 范围: handler 框架 + dryrun 路径打通; 真 wechat_bot.py / wechat_rpa.py 整入 repo 在 **WS3/WS4**。

### 3.7 migration 时间戳格式

仓库现有 migration 文件:
- `20260510_0c10fd_publish_tasks_burner_columns.sql`
- `20260511_102431_publish_tasks_status_enum_full.sql`

格式 `YYYYMMDD_HHMMSS_<name>.sql` (或 `YYYYMMDD_<6 hex>_<name>.sql`)。contract DoD 测 `2026*create_wechat_publish_task*.sql`, 用 `20260513_<HHMMSS>_create_wechat_publish_task.sql` (今天日期, 不是 0508)。

> **明确**: contract-dod-ws1.md 写的是 `20260508_<HHMMSS>_create_wechat_publish_task.sql`, 但 DoD 测命令是 `ls 2026*create_wechat_publish_task*.sql` 通配, 实际今天日期 20260513 满足通配。spec 用今天日期。

## 4. 测试策略 (REQUIRED gate)

按 Cecelia 测试金字塔四档分类:

| 行为 | 测试类型 | 文件 |
|---|---|---|
| migration 跑 cecelia DB + CHECK enforce | **E2E** (跨进程 + 持久化) | `tests/ws1/db-schema.test.ts` |
| llm_audit INSERT/SELECT | **E2E** (持久化) | 同上 |
| openrouter 真调 OpenRouter (CI max_tokens=20 真烧) | **integration** (跨多模块 + 外部 HTTP) | `tests/ws1/openrouter-llm.test.ts` |
| OPENROUTER_FORCE_5XX 注入抛错 | **unit** (单函数纯分支) | 同上 |
| NODE_ENV=production 时 force 5xx 被忽略 | **unit** | 同上 |
| CI=true clamp max_tokens | **unit** | 同上 |
| zod schema 缺字段 400 | **integration** (route + zod 跨模块) | `tests/ws1/wechat-routes.test.ts` (新增) |
| handler spawn Python dryrun + receipt | **E2E** (跨进程) | `tests/ws1/wechat-rpa-handler.test.ts` |
| deploy script bash -n | **trivial** (1 行 lint 检查) | smoke.sh |

新增 **golden-path-4-smoke.sh** 一条覆盖整链路 (符合 ZenithJoy CLAUDE.md walking-skeleton 铁律 1):
- migration 真跑 → curl wechat 3 endpoint zod fail/pass → handler spawn dryrun → receipt 出现 → smoke PASS

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| OpenRouter 5xx (真) | throw + 记 llm_audit row success=false |
| handler spawn 失败 (Python 不在) | log + receipt error + Agent 上报 status=failed |
| zod 校验失败 | 400 + 字段错误 JSON |
| migration 已跑过 | 幂等 (`CREATE TABLE IF NOT EXISTS`) |

## 6. CI lint 兼容

WS1 改动 `apps/api/src/` + `services/agent/src/`, 触发所有 lint:
- `lint-feature-has-smoke`: 必须新增 `golden-path-4-smoke.sh`
- `lint-test-pairing`: 3 .ts 改动必须配 .test.ts → tests/ws1/ 配齐
- `lint-tdd-commit-order`: commit-1=tests / commit-2=impl 顺序
- `lint-no-fake-test`: tests/ws1/*.test.ts 必须真 import + 真调用

## 7. Out of Scope (本 WS1 不做)

- 真 wechat_bot.py / wechat_rpa.py 整入 repo (WS3/WS4)
- 飞书 Bitable 自动建表 (WS2)
- AI 草稿生成业务逻辑 (WS3 私聊 / WS4 朋友圈)
- 飞书审批流 (WS5)
- 真发 / 回执回写 (WS6)
- rog 真部署+验证 (Lead 自验阶段, 不在本 WS PR)

## 8. 部署前置

无新 secret (复用 `~/.credentials/openrouter.env` 的 OPENROUTER_API_KEY)。
本地: `apps/api/.env` 已有 OPENROUTER_API_KEY (从凭据同步)。
CI: secrets.OPENROUTER_API_KEY 已配 (Path 2 用过)。

## 9. 上线后验证

PR merge 后:
1. `psql cecelia -c '\d wechat_publish_task'` → 看 approval_source CHECK 约束存在
2. `bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh` → 跑通 step 1 部分 (Agent 不在本机就 SKIP)
3. Lead 自验 (rog) 暂不做 — 等 WS6 完才能 rog 上跑全链路

## 10. 风险与缓解

| 风险 | 缓解 |
|---|---|
| OpenRouter HTTP 真调耗 token 钱 | CI=true clamp max_tokens=20, 单 PR <$0.01 |
| spawn Python 在 mac CI 没 wechat 库 | dryrun 路径不真调 wechat_bot.py, echo mock receipt |
| migration 顺序冲突 (别的 PR 先合) | migration 文件名时间戳, PG 跑顺序按字典序自然定序 |
| zod schema 写错字段名导致 contract grep 不到 | spec §3.5 显式约束, plan 里 inline 完整 schema |
