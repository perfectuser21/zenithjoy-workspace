# Sprint Contract Draft (Round 1) — Line04 客服工作汇总统计页

## 已知约束（来自回归测试）

- [apps/api/src/services/wechat/__tests__/tenant-memory.test.ts] → 正常写入：INSERT 进 zenithjoy.cs_memory_messages 且参数含 tenant_id，返回 message_id（隔离纪律：缺 tenant_id 抛 MISSING_TENANT）
- [apps/api/src/services/wechat/cs-account-config-store.ts 注释约束] → getCSConfig 按 wechat_id 物理分行；空 wechat_id 返回 null（强制 dryrun，绝不误真发）
- [现有 /api/wechat/cs/* 路由约定] → handler 成功返 `{ ok: true, ... }`，失败返 `{ error: 'CODE', message }`（见 wechat.ts /cs/outbound、/cs/alert）
- 数据隔离纪律（既有）：所有 cs_memory_* 读写按 (tenant_id, contact) 过滤，绝不跨租户/跨客服串台

## Response Schema（推导来源: 混合 — 4 个统计数字字段 [FROM_PRD]E2E 验收点2 字面；信封 ok:true 由 api_registry 现有 /cs/outbound 推导；mode 值命名 [NEW_PATTERN]）

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

- `ok` (boolean, 必填): 来源——api_registry 现有 /cs/outbound 端点 `{ok:true,...}` 约定
- `date` (string "today"|"yesterday", 必填): 来源——PRD Golden Path Step4 今天/昨天切换；回显请求的 date
- `timezone` (string, 必填): 来源——PRD NFR「日界一律按北京时区 Asia/Shanghai」；固定 `"Asia/Shanghai"`
- `agents` (array, 必填): 每台客服机一项（PRD Golden Path Step3「每台客服机一张卡」）。无任何客服时为 `[]`
- `agents[].cs_wechat_id` (string, 必填): 来源——PRD 范围「cs_memory_messages 加 cs_wechat_id」字面；该客服微信号身份章，也是分组主键
- `agents[].cs_name` (string, 必填): 来源——PRD Golden Path Step3「客服名」；无配置名时回落 cs_wechat_id
- `agents[].online` (boolean, 必填): 来源——PRD Golden Path Step3「在线状态」
- `agents[].mode` (string "live"|"dryrun", 必填): 来源——PRD Golden Path Step3「真发/演练标」；值命名 [NEW_PATTERN]（live=真发 / dryrun=演练）
- `agents[].received_count` (number, 必填): 来源——PRD 口径定义「接收=count(role='in')」字面字段名
- `agents[].reply_count` (number, 必填): 来源——PRD 口径定义「回复=count(role='out')」字面字段名
- `agents[].served_customers` (number, 必填): 来源——PRD 口径定义「接待=distinct 客户数」字面字段名
- `agents[].work_duration_minutes` (number, 必填): 来源——PRD 口径定义「工作时长=当天末条−首条消息时间（分钟）」字面字段名

**禁用字段名**（drift 防御，contract 任何正向断言严禁出现）: `in_count`、`out_count`、`messages_received`、`reply`、`replies`、`customer_count`、`duration`、`duration_minutes`、`minutes`、`wxid`

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
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 1 条 + 范围「cs_memory_messages 加 cs_wechat_id（nullable）+ 索引 (cs_wechat_id, created_at)」+「appendMessage in/out 两处盖当前客服身份章」

**可观测行为**: `zenithjoy.cs_memory_messages` 表有可空列 `cs_wechat_id` + 索引 `(cs_wechat_id, created_at)`；写入 in/out 两条消息时盖上当前客服微信号（身份来源 csConfig.wechat_id，链路 UUID→agents→env-id→machine→config 已存在）。老数据/解析失败 → `cs_wechat_id` 为 NULL，不回填。

**验证命令**（schema 断言铁律：node 读 migration 文件，严禁 psql 查 information_schema）:
```bash
# 列 + 索引存在性 — 读 migration 文件断言
MIG=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql 2>/dev/null | head -1)
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r)){console.error("FAIL: 缺 ADD COLUMN cs_wechat_id");process.exit(1)}
if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r)){console.error("FAIL: 缺索引 (cs_wechat_id, created_at)");process.exit(1)}
console.log("OK")' "$MIG"
# 落库盖章代码 — 读 wechat-draft.ts 断言 in/out 两处写入带 cs_wechat_id 身份章
node -e 'const fs=require("fs");const r=fs.readFileSync("apps/api/src/services/wechat-draft.ts","utf8");
if(!/cs_wechat_id/.test(r)){console.error("FAIL: 落库未盖 cs_wechat_id 身份章");process.exit(1)}
console.log("OK")'
```

**硬阈值**: migration 文件含 `cs_wechat_id` 列（IF NOT EXISTS 幂等）+ 索引 `(cs_wechat_id, created_at)`；落库代码引用 cs_wechat_id 身份章；列 nullable 不回填历史

---

### Step 2: 管理员打开「客服工作汇总」页（挂 Line04 私域客服区下）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条「管理员打开 dashboard『客服工作汇总』页（挂 Line04 区下）」+ 范围「dashboard『客服工作汇总』页 + Line04 区路由挂载」

**可观测行为**: dashboard 新增 `CsWorkSummaryPage`，路由 `/wechat/cs-stats` 注册进 navigation.config.ts（requireAuth），挂在 Line04 私域客服区下。页面打开后可见「客服工作汇总」标题与今天/昨天切换控件。

**验证命令**:
```bash
# 页面组件存在
node -e 'require("fs").accessSync("apps/dashboard/src/pages/CsWorkSummaryPage.tsx")' || { echo "FAIL: 缺 CsWorkSummaryPage"; exit 1; }
# 路由注册（挂 Line04 私域客服区）
node -e 'const fs=require("fs");const r=fs.readFileSync("apps/dashboard/src/config/navigation.config.ts","utf8");
if(!/CsWorkSummaryPage/.test(r)){console.error("FAIL: navigation.config 未注册 CsWorkSummaryPage");process.exit(1)}
console.log("OK")'
```

**硬阈值**: `CsWorkSummaryPage.tsx` 存在 + navigation.config.ts 注册路由

---

### Step 3: 每台客服机一张卡 4 个数 + 真发/演练标（GET /cs/stats?date=today）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条 + 口径定义「接收=count(role='in')；回复=count(role='out')；接待=distinct 客户数；工作时长=当天末条−首条（分钟）」

**可观测行为**: `GET /api/wechat/cs/stats?date=today` 按北京时区聚合，每台客服机返回一项，含 `received_count`/`reply_count`/`served_customers`/`work_duration_minutes` 四数（口径精确）+ `cs_name`/`online`/`mode`(真发live/演练dryrun)。当天还没消息 → 4 个 0（不报错、不消失）。

**验证命令**（seed 已知 in/out → curl jq 精确断言；唯一 run-scoped 标记防历史数据冒充）:
```bash
API="${API_BASE:-http://localhost:5200}"
RUN="e2e-cs-a-$$-$RANDOM"
# seed：北京今天 5 条 in + 3 条 out，2 个不同客户（served=2），created_at=now()（北京今天）
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  SELECT 't-e2e','cust1','in','hi'||g,'$RUN', now() FROM generate_series(1,3) g
  UNION ALL SELECT 't-e2e','cust2','in','hi'||g,'$RUN', now() FROM generate_series(1,2) g
  UNION ALL SELECT 't-e2e','cust1','out','re'||g,'$RUN', now() FROM generate_series(1,3) g;"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$RESP" | jq -e '.ok == true' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.timezone == "Asia/Shanghai"' || { echo FAIL; exit 1; }
CARD=$(echo "$RESP" | jq -c --arg w "$RUN" '.agents[] | select(.cs_wechat_id==$w)')
echo "$CARD" | jq -e '.received_count == 5' || { echo "FAIL received"; exit 1; }
echo "$CARD" | jq -e '.reply_count == 3' || { echo "FAIL reply"; exit 1; }
echo "$CARD" | jq -e '.served_customers == 2' || { echo "FAIL served"; exit 1; }
echo "$CARD" | jq -e '.work_duration_minutes | type == "number"' || { echo "FAIL duration"; exit 1; }
# 禁用字段反向：不许 drift
echo "$CARD" | jq -e 'has("in_count") | not' || { echo "FAIL: 禁用字段 in_count 漏网"; exit 1; }
echo "$CARD" | jq -e 'has("customer_count") | not' || { echo "FAIL: 禁用字段 customer_count 漏网"; exit 1; }
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$RUN';"
echo OK
```

**硬阈值**: received_count=5、reply_count=3、served_customers=2 精确相等；work_duration_minutes 为 number；禁用字段不存在

---

### Step 4: 切「昨天」→ 4 个数变为昨天的数（北京时区日界）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条「顶部切『昨天』」+ 边界「时区边界：北京 00:30 的消息（中台美区当时为昨天）→ 仍归『今天』（防 #832）」

**可观测行为**: `GET /cs/stats?date=yesterday` 按北京时区返回昨天的数；今天的消息不出现在昨天卡片，反之亦然。北京时区今天 00:30 的消息归「今天」（即便中台美区本地时间算成昨天）。

**验证命令**（seed 昨天数据 + 北京今天 00:30 数据，按北京时区断归属；唯一标记防伪）:
```bash
API="${API_BASE:-http://localhost:5200}"
RUN="e2e-cs-tz-$$-$RANDOM"
# A) 昨天（北京）2 条 in
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  SELECT 't-e2e','custY','in','y'||g,'$RUN',
    ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1 + time '10:00') AT TIME ZONE 'Asia/Shanghai'
  FROM generate_series(1,2) g;"
# B) 北京今天 00:30 一条 in（美区当时算昨天）→ 应归今天
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  VALUES ('t-e2e','custT','in','midnight','$RUN',
    ((now() AT TIME ZONE 'Asia/Shanghai')::date + time '00:30') AT TIME ZONE 'Asia/Shanghai');"
Y=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday")
T=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$Y" | jq -e --arg w "$RUN" '.agents[] | select(.cs_wechat_id==$w) | .received_count == 2' || { echo "FAIL: 昨天应=2"; exit 1; }
echo "$T" | jq -e --arg w "$RUN" '.agents[] | select(.cs_wechat_id==$w) | .received_count == 1' || { echo "FAIL: 北京今天00:30 应归今天=1"; exit 1; }
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$RUN';"
echo OK
```

**硬阈值**: 昨天卡 received_count=2；北京 00:30 消息归今天 received_count=1（北京时区日界，非美区）

---

### Step 5: 数据隔离 — A 的数绝不出现在 B 的卡片
**来源**: `[FROM_PRD]` — PRD 边界「数据隔离：两个不同 cs_wechat_id 的消息各算各的」+ NFR「按 cs_wechat_id 过滤，绝不跨客服串台」

**可观测行为**: 灌两个不同 cs_wechat_id（A 多、B 少）→ A 卡只含 A 的数，B 卡只含 B 的数，互不串台。

**验证命令**:
```bash
API="${API_BASE:-http://localhost:5200}"
A="e2e-iso-a-$$-$RANDOM"; B="e2e-iso-b-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  SELECT 't-e2e','ca','in','x'||g,'$A', now() FROM generate_series(1,4) g
  UNION ALL SELECT 't-e2e','cb','in','x'||g,'$B', now() FROM generate_series(1,1) g;"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$RESP" | jq -e --arg w "$A" '.agents[] | select(.cs_wechat_id==$w) | .received_count == 4' || { echo "FAIL: A 应=4"; exit 1; }
echo "$RESP" | jq -e --arg w "$B" '.agents[] | select(.cs_wechat_id==$w) | .received_count == 1' || { echo "FAIL: B 应=1（A 的数串到 B 了）"; exit 1; }
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id IN ('$A','$B');"
echo OK
```

**硬阈值**: A.received_count=4 且 B.received_count=1（A 的 4 条绝不串到 B）

---

### Step 6: 老数据兼容 — cs_wechat_id=NULL 不计入任何客服、接口不报错
**来源**: `[FROM_PRD]` — PRD 边界「cs_wechat_id 为 NULL（老数据/解析失败）→ 不计入任何客服统计、接口不报错（不串到别人头上）」

**可观测行为**: 灌一批 cs_wechat_id=NULL 的消息 + 一个正常客服 → 接口 HTTP 200 不报错；NULL 消息不出现在任何客服卡片（不被任意计入）。

**验证命令**:
```bash
API="${API_BASE:-http://localhost:5200}"
N="e2e-null-ref-$$-$RANDOM"
# NULL 身份消息 3 条 + 一个正常客服 1 条（用 contact 标记 NULL 批次便于清理）
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  SELECT 't-e2e','$N','in','old'||g, NULL, now() FROM generate_series(1,3) g;"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id, created_at)
  VALUES ('t-e2e','live1','in','hi','$N-live', now());"
CODE=$(curl -s -o /tmp/null_resp.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=today")
[ "$CODE" = "200" ] || { echo "FAIL: NULL 数据致接口非 200 (=$CODE)"; exit 1; }
# NULL 不得成为某个 agent（不出现 cs_wechat_id=null 的卡片）
jq -e '[.agents[] | select(.cs_wechat_id == null)] | length == 0' /tmp/null_resp.json || { echo "FAIL: NULL 串成了一张卡"; exit 1; }
# 正常客服仍正确计入
jq -e --arg w "$N-live" '.agents[] | select(.cs_wechat_id==$w) | .received_count == 1' /tmp/null_resp.json || { echo "FAIL: 正常客服漏计"; exit 1; }
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE contact='$N' OR cs_wechat_id='$N-live';"
echo OK
```

**硬阈值**: NULL 数据下接口 HTTP 200；无 cs_wechat_id=null 的卡片；正常客服计数不受 NULL 干扰

---

### Step 7: error path — 非法 date 返 400
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 限定 date∈{today,yesterday}，需明确非法输入的可观测错误契约，防 generator 静默吞错（404/500/空响应）当成功

**可观测行为**: `GET /cs/stats?date=garbage` → HTTP 400 + `error` 字段为 string，不 500、不静默返空。

**验证命令**:
```bash
API="${API_BASE:-http://localhost:5200}"
CODE=$(curl -s -o /tmp/bad_resp.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=garbage")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 date 未返 400 (=$CODE)"; exit 1; }
jq -e '.error | type == "string"' /tmp/bad_resp.json || { echo "FAIL: 缺 error 字段"; exit 1; }
echo OK
```

**硬阈值**: HTTP 400 + error 为 string

---

## 接缝清单（接缝 vs 逻辑断言区分）

本 sprint **几乎全是逻辑断言**（口径聚合、时区计算、NULL 过滤、隔离均为环境无关纯逻辑 + DB SQL），CI（ubuntu + postgres）跑绿 = 真 done：

| # | 断言 | 类型 | 验证位置 | done 判定 |
|---|---|---|---|---|
| 1 | 4 数口径 / 北京时区日界 / NULL 过滤 / 数据隔离 | **逻辑** | CI ubuntu + postgres seed→curl/psql + vitest 纯函数 | 绿 = 真 done |
| 2 | dashboard 卡片渲染 + 今天/昨天切换 | **逻辑**（Playwright page.route stub 后端，纯前端渲染逻辑）| windows_cloud GHA Playwright | 绿 = 真 done |
| 3 | 落库盖 cs_wechat_id 身份章（依赖 csConfig.wechat_id 真实解析链 UUID→agents→env-id→machine→config）| **接缝**（真实身份解析链是生产环境集成点）| 本 sprint 仅验「落库写入了 cs_wechat_id 字段」(逻辑)；真实解析链端到端在生产客户机真发回路上验，标 `logic-done-pending` | 逻辑部分绿可标 done；真实解析链贯通需生产真验 |

接缝 #3 说明：身份解析链本身（[ASSUMPTION] 已由 Issue defe1a42/dd320e56 修过）不在本 sprint 重验；本 sprint 只保证「拿到 cs_wechat_id 后正确盖进 cs_memory_messages 并被统计」。若真实链路在生产回路出现 cs_wechat_id 解析失败 → 走 NULL 兼容路径（Step 6），不报错、不串台，已在逻辑层兜住。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: user_facing
**target_environment**: windows_cloud

> 选模板规则：target_environment=windows_cloud。本 sprint 含 (a) 后端口径/时区/隔离 = CI ubuntu + postgres 跑 smoke .sh；(b) dashboard 汇总页 = windows_cloud GHA Playwright spec。两者均为 4 铁律强制（lint-feature-has-smoke + lint-tdd-commit-order）。

### (a) 后端口径 smoke（CI ubuntu + postgres，写入 `.github/workflows/scripts/smoke/cs-work-stats-smoke.sh`）

```bash
#!/usr/bin/env bash
# cs-work-stats-smoke.sh — Line04 客服工作汇总：schema + /cs/stats 口径/时区/隔离/NULL/error
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="${API_BASE:-http://localhost:5200}"

echo "── ① schema：migration 含 cs_wechat_id 列 + 索引（node 读文件，不查 information_schema）──"
MIG=$(ls "$ROOT"/apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql | head -1)
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r))throw new Error("缺列 cs_wechat_id");
if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r))throw new Error("缺索引");
console.log("  PASS: cs_wechat_id 列 + (cs_wechat_id, created_at) 索引就位")' "$MIG"

echo "── ② 路由 + 落库盖章就位 ──"
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/cs\/stats/.test(r))throw new Error("缺 GET /cs/stats 路由");
console.log("  PASS: /cs/stats 路由就位")' "$ROOT/apps/api/src/routes/wechat.ts"
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/cs_wechat_id/.test(r))throw new Error("落库未盖 cs_wechat_id");
console.log("  PASS: 落库盖 cs_wechat_id 身份章")' "$ROOT/apps/api/src/services/wechat-draft.ts"

echo "── ③ 口径：seed 已知 in/out → curl jq 精确断言（唯一标记防伪）──"
RUN="smoke-cs-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  SELECT 't-smk','c1','in','i'||g,'$RUN',now() FROM generate_series(1,3) g
  UNION ALL SELECT 't-smk','c2','in','i'||g,'$RUN',now() FROM generate_series(1,2) g
  UNION ALL SELECT 't-smk','c1','out','o'||g,'$RUN',now() FROM generate_series(1,3) g;"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$RESP" | jq -e '.ok==true and .timezone=="Asia/Shanghai"' >/dev/null || { echo "  FAIL: 信封不符"; exit 1; }
CARD=$(echo "$RESP" | jq -c --arg w "$RUN" '.agents[]|select(.cs_wechat_id==$w)')
echo "$CARD" | jq -e '.received_count==5 and .reply_count==3 and .served_customers==2' >/dev/null \
  || { echo "  FAIL: 口径错 $CARD"; exit 1; }
echo "$CARD" | jq -e '(has("in_count")|not) and (has("customer_count")|not)' >/dev/null \
  || { echo "  FAIL: 禁用字段漏网"; exit 1; }
echo "  PASS: received=5 reply=3 served=2 字段名合规"

echo "── ④ 隔离 + NULL + error path ──"
B="smoke-iso-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  VALUES ('t-smk','cb','in','x','$B',now()),('t-smk','cn','in','old',NULL,now());"
RESP2=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$RESP2" | jq -e --arg w "$RUN" '.agents[]|select(.cs_wechat_id==$w)|.received_count==5' >/dev/null \
  || { echo "  FAIL: B/NULL 串台污染了 A"; exit 1; }
echo "$RESP2" | jq -e '[.agents[]|select(.cs_wechat_id==null)]|length==0' >/dev/null \
  || { echo "  FAIL: NULL 串成卡片"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/wechat/cs/stats?date=garbage")
[ "$CODE" = "400" ] || { echo "  FAIL: 非法 date 未返 400 (=$CODE)"; exit 1; }
echo "  PASS: 隔离不串台 + NULL 不计入 + 非法 date 返 400"

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='t-smk';"
echo "✅ cs-work-stats smoke 全过"
```

### (b) Dashboard 汇总页 Playwright（windows_cloud GHA windows-latest，写入 `apps/dashboard/e2e/cs-work-summary.spec.ts`）

```typescript
// cs-work-summary.spec.ts — 客服工作汇总页：每客服一卡 4 数 + 今天/昨天切换
// page.route stub /cs/stats（纯前端渲染逻辑，无 DB；后端口径由 smoke .sh 验）
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

  // 今天：卡片 4 数可见
  const card = page.getByTestId('cs-card-wxid_a')
  await expect(card).toBeVisible({ timeout: 10000 })
  await expect(card.getByTestId('received-count')).toHaveText('10')
  await expect(card.getByTestId('reply-count')).toHaveText('8')
  await expect(card.getByTestId('served-customers')).toHaveText('3')
  await expect(card.getByTestId('work-duration')).toContainText('45')
  await expect(card.getByTestId('cs-mode-badge')).toContainText('真发')
  await page.screenshot({ path: `${SHOT_DIR}/02-action.png`, fullPage: true })

  // 切「昨天」→ 4 数变昨天
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
| 口径/时区/NULL/隔离 纯函数 | `tests/cs-work-stats.test.ts` | aggregateCsStats 4 数口径 + 北京时区日界 + NULL 排除 + 隔离 | → import 失败 / 断言失败 N failures |
