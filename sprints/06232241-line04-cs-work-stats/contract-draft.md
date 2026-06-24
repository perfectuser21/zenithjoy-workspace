# Sprint Contract Draft (Round 2) — Line04 客服工作汇总统计页

> **本轮处理 Round1 REVISION 三问题**：
> 1. **ci_workflow_alignment** → 新增 `## CI Workflow 接线` 段：smoke 显式接进 ci-l4-e2e-smoke.yml（補 DATABASE_URL），Playwright 接进新建 e2e-line04-cs-work-stats.yml windows-latest job（仿 cs-config-permission 兄弟）。两条均加 DoD ARTIFACT 机检。
> 2. **verification_oracle_completeness** → 补 work_duration_minutes 精确分钟断言（30）、mode 真发/演练后端 oracle（seed live+dry config → jq .mode）、卡片 keys 完整性卡 + 10 个禁用字段全查。
> 3. **internal_consistency** → draft↔dod 同源：口径/mode 种子统一走 `fixtures/seed-stats.sql`，draft 本段断言数字与 contract-dod.md [BEHAVIOR] 字面一致；落库盖章指向真实 INSERT 路径（tenant-memory.ts），不再指错 wechat-draft.ts。

> **SSOT 约定**：evaluator 跑的是 **contract-dod.md**。本 draft 为同源镜像——同一份 `fixtures/seed-stats.sql` 种子 + 同样断言数字。改口径只改 fixture 一处。

## 已知约束（来自回归测试）

- [apps/api/src/services/wechat/__tests__/tenant-memory.test.ts] → 正常写入：INSERT 进 zenithjoy.cs_memory_messages 且参数含 tenant_id，返回 message_id（隔离纪律：缺 tenant_id 抛 MISSING_TENANT）
- [apps/api/src/services/wechat/tenant-memory.ts appendTenantMessage] → **cs_memory_messages 的真实 INSERT 路径**（列 tenant_id/contact/role/text）；本 sprint 在此 INSERT 补 cs_wechat_id 身份章列。调用方 routes/wechat-memory.ts POST /memory/message 解析租户后写入。
- [apps/api/src/services/wechat/cs-account-config-store.ts] → `auto_agent_enabled` 真发总开关（默认 false=dryrun，绝不在没人配过时真发）；本 sprint `mode` 字段直接由它推导：true→`live`、false/无配置→`dryrun`
- [现有 /api/wechat/cs/* 路由约定] → handler 成功返 `{ ok: true, ... }`，失败返 `{ error: 'CODE', message }`（见 wechat.ts /cs/outbound、/cs/alert）

## Response Schema（推导来源: 4 个统计数字字段 [FROM_PRD] 口径定义字面；信封 ok:true 由 api_registry /cs/outbound 推导；mode 值 [NEW_PATTERN] 直接映射 auto_agent_enabled）

### Endpoint: GET /api/wechat/cs/stats?date=today|yesterday

**Success (HTTP 200)**:
```json
{
  "ok": true,
  "date": "today",
  "timezone": "Asia/Shanghai",
  "agents": [
    {
      "cs_wechat_id": "wxid_demo_a",
      "cs_name": "客服小美",
      "online": true,
      "mode": "live",
      "received_count": 10,
      "reply_count": 8,
      "served_customers": 3,
      "work_duration_minutes": 45
    }
  ]
}
```

顶层 keys = `["agents","date","ok","timezone"]`；每个 agent 卡 keys **完整等于** 8 个（jq keys 排序后）：
`["cs_name","cs_wechat_id","mode","online","received_count","reply_count","served_customers","work_duration_minutes"]`

- `ok` (boolean, 必填): api_registry /cs/outbound `{ok:true,...}` 约定
- `date` (string "today"|"yesterday", 必填): 回显请求 date（PRD Golden Path Step4 切换）
- `timezone` (string, 必填): 固定 `"Asia/Shanghai"`（PRD NFR 北京时区日界）
- `agents` (array, 必填): 每台客服机一项；无任何客服时 `[]`
- `agents[].cs_wechat_id` (string, 必填): 该客服微信号身份章 = 分组主键
- `agents[].cs_name` (string, 必填): 客服名；无配置名时回落 cs_wechat_id
- `agents[].online` (boolean, 必填): 在线状态（5 分钟内有心跳）
- `agents[].mode` (string "live"|"dryrun", 必填): 真发/演练标；`live`=auto_agent_enabled 为 true，`dryrun`=false/无配置 [NEW_PATTERN]
- `agents[].received_count` (number, 必填): 接收=count(role='in')
- `agents[].reply_count` (number, 必填): 回复=count(role='out')
- `agents[].served_customers` (number, 必填): 接待=distinct 客户(contact)数
- `agents[].work_duration_minutes` (number, 必填): 工作时长=当天末条−首条 created_at（分钟，按北京时区当天范围）

**禁用字段名**（drift 防御，contract 任何正向断言严禁出现，卡 keys 反向全查 10 个）: `in_count`、`out_count`、`messages_received`、`reply`、`replies`、`customer_count`、`duration`、`duration_minutes`、`minutes`、`wxid`

**Error (HTTP 4xx)**:
```json
{"error": "INVALID_DATE", "message": "date 必须是 today 或 yesterday"}
```
- 非法 `date`（非 today/yesterday）→ HTTP 400 + `error` (string)

---

## Golden Path

[名单内客户私聊某客服微信 → 客服机自动回复 → in/out 落库盖 cs_wechat_id 身份章]
→ [管理员打开 dashboard「客服工作汇总」页]
→ [看到每台客服机一张卡的 4 个数 + 真发/演练标]
→ [顶部切「昨天」→ 4 个数变为昨天（按北京时区算日界）]

---

### Step 1: 对话落库时盖客服微信号身份章
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条 + 范围「cs_memory_messages 加 cs_wechat_id（nullable）+ 索引 (cs_wechat_id, created_at)」+「appendMessage in/out 两处盖当前客服身份章」

**可观测行为**: `zenithjoy.cs_memory_messages` 有可空列 `cs_wechat_id` + 索引 `(cs_wechat_id, created_at)`。写入 in/out 消息时盖上当前客服微信号身份章。
**真实 INSERT 路径（修问题3 — PRD 预期受影响文件指 wechat-draft.ts 有误）**：cs_memory_messages 的实际 INSERT 在 `apps/api/src/services/wechat/tenant-memory.ts` 的 `appendTenantMessage`（列 tenant_id/contact/role/text），由 `apps/api/src/routes/wechat-memory.ts` POST `/memory/message` 调用——**身份章必须加在这里**，而非 wechat-draft.ts（后者 appendMessage 写的是旧表 `wechat_messages`，统计不读它）。身份来源经调用方解析（接缝 #3）。老数据/解析失败 → cs_wechat_id 为 NULL，不回填。

**验证命令**（schema 断言铁律：node 读 migration 文件，严禁 psql 查 information_schema）:
```bash
# 列 + 索引存在性 — 读 migration 文件断言
MIG=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql 2>/dev/null | head -1)
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r)){console.error("FAIL: 缺 ADD COLUMN cs_wechat_id");process.exit(1)}
if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r)){console.error("FAIL: 缺索引");process.exit(1)}
console.log("OK")' "$MIG"
# 落库盖章 — 读真实 INSERT 路径 tenant-memory.ts + 调用方路由
node -e 'const fs=require("fs");const t=fs.readFileSync("apps/api/src/services/wechat/tenant-memory.ts","utf8");
if(!/INSERT INTO zenithjoy\.cs_memory_messages[\s\S]{0,400}cs_wechat_id/.test(t)){console.error("FAIL: cs_memory_messages INSERT 未盖 cs_wechat_id");process.exit(1)}
const r=fs.readFileSync("apps/api/src/routes/wechat-memory.ts","utf8");
if(!/cs_wechat_id/.test(r)){console.error("FAIL: 路由未解析/传入 cs_wechat_id");process.exit(1)}
console.log("OK")'
```

**硬阈值**: migration 含 cs_wechat_id 列（IF NOT EXISTS 幂等）+ 索引 (cs_wechat_id, created_at)；tenant-memory.ts INSERT 写 cs_wechat_id；列 nullable 不回填历史

---

### Step 2: 管理员打开「客服工作汇总」页（挂 Line04 私域客服区下）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条 + 范围「dashboard『客服工作汇总』页 + Line04 区路由挂载」

**可观测行为**: dashboard 新增 `CsWorkSummaryPage`，路由 `/wechat/cs-stats` 注册进 navigation.config.ts，挂 Line04 私域客服区下。页面打开后可见标题 + 今天/昨天切换控件。

**验证命令**:
```bash
node -e 'require("fs").accessSync("apps/dashboard/src/pages/CsWorkSummaryPage.tsx")' || { echo "FAIL: 缺 CsWorkSummaryPage"; exit 1; }
node -e 'const fs=require("fs");const r=fs.readFileSync("apps/dashboard/src/config/navigation.config.ts","utf8");
if(!/CsWorkSummaryPage/.test(r)){console.error("FAIL: navigation.config 未注册");process.exit(1)}
console.log("OK")'
```

**硬阈值**: `CsWorkSummaryPage.tsx` 存在 + navigation.config.ts 注册路由

---

### Step 3: 每台客服机一张卡 4 个数 + 真发/演练标（GET /cs/stats?date=today）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 口径定义「接收=count(in)；回复=count(out)；接待=distinct 客户；工作时长=末条−首条（分钟）」+ Step3「真发/演练标」

**可观测行为**: `GET /api/wechat/cs/stats?date=today` 按北京时区聚合，每台客服一项，含四数（口径精确）+ cs_name/online/`mode`（live 真发 / dryrun 演练）。当天还没消息 → 4 个 0（不报错、不消失）。

**验证命令**（统一走 fixtures/seed-stats.sql；断言数字与 contract-dod.md [BEHAVIOR] 口径精确 / mode 字面一致）:
```bash
API="${API_BASE:-http://localhost:5200}"
SD="sprints/06232241-line04-cs-work-stats/fixtures"
RUN="draft-stats-$$-$RANDOM"
# seed：5 in(c1×3+c2×2) + 3 out(c1×3)，首条 09:00 末条 09:30（北京今天）；config live+dry
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/seed-stats.sql" >/dev/null
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
CARD=$(echo "$RESP" | jq -c --arg w "$RUN" '.agents[]|select(.cs_wechat_id==$w)')
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/cleanup.sql" >/dev/null
echo "$RESP" | jq -e '.ok==true and .timezone=="Asia/Shanghai" and .date=="today"' >/dev/null || { echo FAIL 信封; exit 1; }
echo "$CARD" | jq -e '.received_count==5 and .reply_count==3 and .served_customers==2 and .work_duration_minutes==30' >/dev/null || { echo "FAIL 口径: $CARD"; exit 1; }
echo "$CARD" | jq -e 'keys==["cs_name","cs_wechat_id","mode","online","received_count","reply_count","served_customers","work_duration_minutes"]' >/dev/null || { echo "FAIL keys 完整性"; exit 1; }
echo "$CARD" | jq -e '.mode=="live"' >/dev/null || { echo "FAIL: live 卡 mode!=live"; exit 1; }
echo "$RESP" | jq -e --arg w "$RUN-dry" '.agents[]|select(.cs_wechat_id==$w)|.mode=="dryrun"' >/dev/null || { echo "FAIL: dry 卡 mode!=dryrun"; exit 1; }
echo OK
```

**硬阈值**: received_count=5 / reply_count=3 / served_customers=2 / **work_duration_minutes=30** 精确相等；keys 完整等于 8 字段；mode live/dryrun 准确

---

### Step 4: 切「昨天」→ 4 个数变为昨天的数（北京时区日界）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 边界「北京 00:30 的消息（中台美区当时为昨天）→ 仍归『今天』（防 #832）」

**可观测行为**: `GET /cs/stats?date=yesterday` 按北京时区返回昨天的数；北京今天 00:30 的消息归「今天」（即便中台美区算成昨天）。

**验证命令**（与 contract-dod.md [BEHAVIOR] 北京时区日界 同源）:
```bash
# 见 contract-dod.md [BEHAVIOR] 北京时区日界：灌昨天 2 条 + 北京今天 00:30 一条 →
# date=yesterday 卡 received_count=2；date=today 卡 received_count=1
```

**硬阈值**: 昨天卡 received_count=2；北京 00:30 消息归今天 received_count=1（北京时区日界，非美区）

---

### Step 5: 数据隔离 — A 的数绝不出现在 B 的卡片
**来源**: `[FROM_PRD]` — PRD 边界「数据隔离」+ NFR「按 cs_wechat_id 过滤，绝不跨客服串台」

**可观测行为**: 灌两个不同 cs_wechat_id（A 多、B 少）→ A 卡只含 A 的数，B 卡只含 B 的数。

**验证命令**: 见 contract-dod.md [BEHAVIOR] 数据隔离（A.received_count=4 且 B.received_count=1）

**硬阈值**: A.received_count=4 且 B.received_count=1（A 的 4 条绝不串到 B）

---

### Step 6: 老数据兼容 — cs_wechat_id=NULL 不计入任何客服、接口不报错
**来源**: `[FROM_PRD]` — PRD 边界「cs_wechat_id 为 NULL（老数据/解析失败）→ 不计入任何客服统计、接口不报错」

**可观测行为**: 灌一批 NULL 身份消息 + 一个正常客服 → 接口 HTTP 200；NULL 消息不出现在任何卡片。

**验证命令**: 见 contract-dod.md [BEHAVIOR] 老数据兼容

**硬阈值**: NULL 数据下接口 HTTP 200；无 cs_wechat_id=null 的卡片；正常客服计数不受 NULL 干扰

---

### Step 7: error path — 非法 date 返 400
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 限定 date∈{today,yesterday}，需明确非法输入的可观测错误契约，防 generator 静默吞错当成功

**可观测行为**: `GET /cs/stats?date=garbage` → HTTP 400 + `error` 字段为 string。

**验证命令**: 见 contract-dod.md [BEHAVIOR] error path

**硬阈值**: HTTP 400 + error 为 string

---

## CI Workflow 接线（generator 必须实现 — 修问题1 ci_workflow_alignment）

> **1:1 映射审计（已 cat 读 ci-l4-e2e-smoke.yml / e2e-line04-cs-config-permission.yml 实际内容）**：

| 用户可观察步骤 | CI 验证落点 | 状态 |
|---|---|---|
| 后端 4 数 + mode + 北京时区 + 隔离 + NULL + error | `ci-l4-e2e-smoke.yml` → smoke-api-contract job（已含 postgres service + 跑全部 migrations + 起 apps/api:5200）新增 step 跑 `cs-work-stats-smoke.sh` | 接线①（下方 YAML） |
| 前台每客服卡 4 数 + mode 标 + 今天/昨天切换 | `e2e-line04-cs-work-stats.yml` windows-latest job 跑 `cs-work-summary.spec.ts`（经 e2e-ui-verify.ps1） | 接线②（下方 YAML） |
| 落库盖 cs_wechat_id 身份章（真实 listen_chat 回路）| 接缝 #3，真机生产回路验，非 CI（CI 无真实微信）；CI 内由 ARTIFACT 静态查 + NULL 兼容路径兜底 | 非 CI_GAP（接缝标注） |

**ci-l4 现状缺口（必须補）**：smoke-api-contract job 的 env 只有 PG 拆分变量（DATABASE_HOST/USER/...）+ 各 step 的 PGPASSWORD，**无 DATABASE_URL**；而 smoke 用 `psql "$DATABASE_URL"`。故新 step 必须在 env 注入 DATABASE_URL。

### 接线①：在 `.github/workflows/ci-l4-e2e-smoke.yml` 的 `smoke-api-contract` job 内（参照 line04-cs-memory 那个 step，约 444 行后）新增：

```yaml
      # ─── Line04 客服工作汇总统计 — 每客服 4 数 + mode + 北京时区/隔离/NULL/error ───
      - name: Smoke — Line04 CS Work Stats
        env:
          API_BASE: http://localhost:5200
          DATABASE_URL: postgresql://cecelia:cecelia@localhost:5432/cecelia   # ci-l4 原无此变量，smoke 用 psql "$DATABASE_URL" 故補
          PGPASSWORD: cecelia
        run: |
          chmod +x .github/workflows/scripts/smoke/cs-work-stats-smoke.sh
          bash .github/workflows/scripts/smoke/cs-work-stats-smoke.sh
```

### 接线②：新建 `.github/workflows/e2e-line04-cs-work-stats.yml`（仿 e2e-line04-cs-config-permission.yml 兄弟，单 windows job；后端已由 ci-l4 覆盖）：

```yaml
name: E2E Line04 CS Work Stats
on:
  workflow_dispatch:
  pull_request:
    branches: [main]
    paths:
      - 'apps/dashboard/**'
      - 'sprints/06232241-line04-cs-work-stats/**'
      - '.github/workflows/e2e-line04-cs-work-stats.yml'

concurrency:
  group: e2e-line04-cs-work-stats-${{ github.ref }}
  cancel-in-progress: true

jobs:
  dashboard-ui:                            # 前台客服工作汇总 Playwright UI（windows，page.route 拦后端，无 DB）
    name: 客服工作汇总页 Playwright UI（windows）
    runs-on: windows-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Dashboard UI E2E（Playwright，page.route 拦后端）
        shell: pwsh
        run: ./sprints/06232241-line04-cs-work-stats/e2e-ui-verify.ps1
```

---

## 接缝清单（接缝 vs 逻辑断言区分）

| # | 断言 | 类型 | 验证位置 | done 判定 |
|---|---|---|---|---|
| 1 | 4 数口径 / work_duration=30 / 北京时区日界 / NULL 过滤 / 数据隔离 / mode 映射 | **逻辑** | ci-l4 ubuntu+postgres：seed-stats.sql→curl/jq + vitest 纯函数 | 绿 = 真 done |
| 2 | dashboard 卡片渲染 + 4 数 + mode 标 + 今天/昨天切换 | **逻辑**（Playwright page.route stub 后端，纯前端渲染）| e2e-line04-cs-work-stats.yml windows-latest | 绿 = 真 done |
| 3 | 落库盖 cs_wechat_id 身份章（依赖真实身份解析链 UUID→agents→env-id→machine→config 在 listen_chat 回路取到当前客服微信号）| **接缝**（真实身份解析链 + 真实微信回路是生产集成点）| 本 sprint 仅验逻辑层「INSERT 写入了 cs_wechat_id 列 + 路由传入」（tenant-memory.ts/wechat-memory.ts 静态查 + seed 直灌验聚合）；真实链路端到端在生产客户机真发回路验，标 `logic-done-pending` | 逻辑层绿可标 done；真实解析链贯通需生产真验 |

接缝 #3：身份解析链本身（[ASSUMPTION] 已由 Issue defe1a42/dd320e56 修过）不在本 sprint 重验。真实链路若在生产回路 cs_wechat_id 解析失败 → 走 NULL 兼容路径（Step 6），不报错、不串台，逻辑层已兜住。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: windows_cloud

> (a) 后端口径 = ci-l4 ubuntu+postgres 跑 `cs-work-stats-smoke.sh`；(b) dashboard 汇总页 = e2e-line04-cs-work-stats.yml windows-latest 跑 Playwright spec（经 e2e-ui-verify.ps1）。两者均为 4 铁律强制（lint-feature-has-smoke + lint-tdd-commit-order）。

### (a) 后端口径 smoke（写入 `.github/workflows/scripts/smoke/cs-work-stats-smoke.sh`）

```bash
#!/usr/bin/env bash
# cs-work-stats-smoke.sh — Line04 客服工作汇总：schema + /cs/stats 口径/duration/mode/keys/隔离/NULL/error
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="${API_BASE:-http://localhost:5200}"
SD="$ROOT/sprints/06232241-line04-cs-work-stats/fixtures"

echo "── ① schema：migration 含 cs_wechat_id 列 + 索引（node 读文件，不查 information_schema）──"
MIG=$(ls "$ROOT"/apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql | head -1)
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r))throw new Error("缺列 cs_wechat_id");
if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r))throw new Error("缺索引");
console.log("  PASS: cs_wechat_id 列 + (cs_wechat_id, created_at) 索引就位")' "$MIG"

echo "── ② 路由 + 落库盖章就位（真实 INSERT 路径 tenant-memory.ts）──"
node -e 'const fs=require("fs");if(!/cs\/stats/.test(fs.readFileSync(process.argv[1],"utf8")))throw new Error("缺 GET /cs/stats");console.log("  PASS: /cs/stats 路由就位")' "$ROOT/apps/api/src/routes/wechat.ts"
node -e 'const fs=require("fs");if(!/INSERT INTO zenithjoy\.cs_memory_messages[\s\S]{0,400}cs_wechat_id/.test(fs.readFileSync(process.argv[1],"utf8")))throw new Error("INSERT 未盖 cs_wechat_id");console.log("  PASS: cs_memory_messages INSERT 盖 cs_wechat_id")' "$ROOT/apps/api/src/services/wechat/tenant-memory.ts"

echo "── ③ 口径 + duration + mode + keys + 禁用字段（seed-stats.sql 唯一来源）──"
RUN="smoke-cs-$$-$RANDOM"
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/seed-stats.sql" >/dev/null
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/cleanup.sql" >/dev/null
echo "$RESP" | jq -e '.ok==true and .timezone=="Asia/Shanghai" and .date=="today"' >/dev/null || { echo "  FAIL: 信封不符"; exit 1; }
CARD=$(echo "$RESP" | jq -c --arg w "$RUN" '.agents[]|select(.cs_wechat_id==$w)')
echo "$CARD" | jq -e '.received_count==5 and .reply_count==3 and .served_customers==2 and .work_duration_minutes==30' >/dev/null \
  || { echo "  FAIL: 口径错 $CARD"; exit 1; }
echo "$CARD" | jq -e 'keys==["cs_name","cs_wechat_id","mode","online","received_count","reply_count","served_customers","work_duration_minutes"]' >/dev/null \
  || { echo "  FAIL: keys 完整性 $CARD"; exit 1; }
echo "$CARD" | jq -e '[to_entries[].key]|map(select(.=="in_count" or .=="out_count" or .=="messages_received" or .=="reply" or .=="replies" or .=="customer_count" or .=="duration" or .=="duration_minutes" or .=="minutes" or .=="wxid"))|length==0' >/dev/null \
  || { echo "  FAIL: 禁用字段漏网 $CARD"; exit 1; }
echo "$CARD" | jq -e '.mode=="live"' >/dev/null || { echo "  FAIL: live 卡 mode!=live"; exit 1; }
echo "$RESP" | jq -e --arg w "$RUN-dry" '.agents[]|select(.cs_wechat_id==$w)|.mode=="dryrun"' >/dev/null || { echo "  FAIL: dry 卡 mode!=dryrun"; exit 1; }
echo "  PASS: received=5 reply=3 served=2 duration=30 mode=live/dryrun keys 完整 禁用字段全无"

echo "── ④ 北京时区日界 + 隔离 + NULL + error path ──"
TZ="smoke-tz-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  SELECT 't-smk','cY','in','y'||g,'$TZ', ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1 + time '10:00') AT TIME ZONE 'Asia/Shanghai' FROM generate_series(1,2) g;"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  VALUES ('t-smk','cT','in','mid','$TZ', ((now() AT TIME ZONE 'Asia/Shanghai')::date + time '00:30') AT TIME ZONE 'Asia/Shanghai');"
ISO="smoke-iso-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  SELECT 't-smk','ca','in','x'||g,'$ISO',now() FROM generate_series(1,4) g
  UNION ALL SELECT 't-smk','cn','in','old',NULL,now();"
Y=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday"); T=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$Y" | jq -e --arg w "$TZ" '.agents[]|select(.cs_wechat_id==$w)|.received_count==2' >/dev/null || { echo "  FAIL: 昨天!=2"; exit 1; }
echo "$T" | jq -e --arg w "$TZ" '.agents[]|select(.cs_wechat_id==$w)|.received_count==1' >/dev/null || { echo "  FAIL: 北京00:30 未归今天"; exit 1; }
echo "$T" | jq -e --arg w "$ISO" '.agents[]|select(.cs_wechat_id==$w)|.received_count==4' >/dev/null || { echo "  FAIL: 隔离 A!=4"; exit 1; }
echo "$T" | jq -e '[.agents[]|select(.cs_wechat_id==null)]|length==0' >/dev/null || { echo "  FAIL: NULL 串成卡片"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/wechat/cs/stats?date=garbage")
[ "$CODE" = "400" ] || { echo "  FAIL: 非法 date 未返 400 (=$CODE)"; exit 1; }
echo "  PASS: 北京时区日界 + 隔离不串台 + NULL 不计入 + 非法 date 返 400"

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='t-smk';"
echo "✅ cs-work-stats smoke 全过"
```

### (b) Dashboard 汇总页 Playwright（windows_cloud，写入 `apps/dashboard/e2e/cs-work-summary.spec.ts`，由 e2e-ui-verify.ps1 跑）

```typescript
// cs-work-summary.spec.ts — 客服工作汇总页：每客服一卡 4 数 + mode 标 + 今天/昨天切换
// page.route stub /cs/stats（纯前端渲染逻辑，无 DB；后端口径由 ci-l4 smoke 验）
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT_DIR = '../../sprints/06232241-line04-cs-work-stats/screenshots'

const TODAY = {
  ok: true, date: 'today', timezone: 'Asia/Shanghai',
  agents: [{ cs_wechat_id: 'wxid_a', cs_name: '客服小美', online: true, mode: 'live',
    received_count: 10, reply_count: 8, served_customers: 3, work_duration_minutes: 45 }],
}
const YESTERDAY = {
  ok: true, date: 'yesterday', timezone: 'Asia/Shanghai',
  agents: [{ cs_wechat_id: 'wxid_a', cs_name: '客服小美', online: true, mode: 'live',
    received_count: 2, reply_count: 1, served_customers: 1, work_duration_minutes: 5 }],
}

async function stub(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/wechat/cs/stats**', (r) => {
    const url = new URL(r.request().url())
    const body = url.searchParams.get('date') === 'yesterday' ? YESTERDAY : TODAY
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('汇总页：每客服一卡 4 数 + 真发标 + 今天/昨天切换', async ({ page }) => {
  await stub(page)
  await page.goto(`${BASE_URL}/wechat/cs-stats`)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${SHOT_DIR}/01-initial.png`, fullPage: true })

  const card = page.getByTestId('cs-card-wxid_a')
  await expect(card).toBeVisible({ timeout: 10000 })
  await expect(card.getByTestId('received-count')).toHaveText('10')
  await expect(card.getByTestId('reply-count')).toHaveText('8')
  await expect(card.getByTestId('served-customers')).toHaveText('3')
  await expect(card.getByTestId('work-duration')).toContainText('45')
  await expect(card.getByTestId('cs-mode-badge')).toContainText('真发')
  await page.screenshot({ path: `${SHOT_DIR}/02-action.png`, fullPage: true })

  await page.getByTestId('date-toggle-yesterday').click()
  await expect(card.getByTestId('received-count')).toHaveText('2')
  await expect(card.getByTestId('reply-count')).toHaveText('1')
  await page.screenshot({ path: `${SHOT_DIR}/03-result.png`, fullPage: true })
})
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 口径/时区/NULL/隔离/时长 纯函数 | `tests/cs-work-stats.test.ts` | aggregateCsStats 4 数口径 + work_duration + 北京时区日界 + NULL 排除 + 隔离 | → import 失败 / 断言失败 N failures |
