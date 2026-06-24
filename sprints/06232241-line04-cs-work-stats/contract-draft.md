# Sprint Contract Draft (Round 1) — 客服工作汇总统计页

> journey_type: **user_facing** ｜ target_environment: **windows_cloud** ｜ journey_id: bfeed805 ｜ step_id: L04-S3

## 技术上下文推导（Step 1.1 / 1.2）

- **api_registry / db_registry / test_registry**：Brain `localhost:5221` 注册表本轮无返回 → 字段命名按**现有代码约定**推导（非 NEW_PATTERN 凭空造）。
- **现有约定（已读源码确认）**：
  - 路由挂载点 `app.use('/api/wechat', wechatRouter)`（`apps/api/src/app.ts:168`）→ 新端点真实路径 = `GET /api/wechat/cs/stats`。
  - 成功响应惯例 `{ ok: true, ... }`（`/cs/outbound` 返回 `{ ok:true, tasks }`，`wechat.ts:362`）；错误惯例 `{ error:'CODE', message:'…' }`（`wechat.ts:358/376/397`）。
  - 鉴权：`internalAuth` 中间件，头 `X-Internal-Token: <token>` 或 `Authorization: Bearer <token>`（`apps/api/src/middleware/internal-auth.ts`）；env `ZENITHJOY_INTERNAL_TOKEN` 未设时 dev 放行。
  - DB：`database=cecelia`，schema 前缀 `zenithjoy.`（`apps/api/src/db/connection.ts:9`）。
  - 目标表 `zenithjoy.cs_memory_messages`（`role IN ('in','out')` + `text` + `created_at TIMESTAMPTZ` + `contact`，`migrations/20260618_153000_*.sql`）。
  - **卡片数据源 = `zenithjoy.wechat_cs_account_config`**（`wechat_id` PRIMARY KEY = 每台客服机；`persona` JSONB 取客服名；`auto_agent_enabled` = 真发/演练标）。**「每台客服机一张卡」靠枚举此表**，LEFT JOIN 当天聚合 → 没消息的客服天然出 4 个 0（满足边界情况），NULL `cs_wechat_id` 消息 join 不上任何配置行天然被排除。
  - 迁移文件命名 `YYYYMMDD_HHMMSS_<desc>.sql`，用 `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`（参照 `20260623_090000_add_service_agent_wechat_id.sql`）。

## 已知约束（来自回归测试）

- [`apps/api/src/services/wechat/__tests__/tenant-memory.test.ts`] → INSERT 进 `zenithjoy.cs_memory_messages` 必须带 `tenant_id`，返回 `message_id`（**新增 cs_wechat_id 列不得破坏既有 INSERT 参数顺序/租户隔离**）
- [`apps/api/src/services/wechat/__tests__/contact-memory.test.ts`] → `appendMessage` 发 INSERT；in/out 两方向均写（**盖身份章须覆盖 in/out 两处**）

## Response Schema（推导来源: PRD 显式字段名 + 现有响应惯例）

### Endpoint: `GET /api/wechat/cs/stats?date=today|yesterday`

**Success (HTTP 200)**:
```json
{
  "ok": true,
  "date": "today",
  "cards": [
    {
      "cs_wechat_id": "wxid_abc",
      "cs_name": "测试客服A",
      "auto_agent_enabled": true,
      "online": false,
      "received_count": 3,
      "reply_count": 2,
      "served_customers": 2,
      "work_duration_minutes": 17
    }
  ]
}
```
顶层字段：
- `ok` (boolean, 必填): 来源——现有响应惯例（`/cs/outbound` 等均返回 `ok:true`）
- `date` (string, 必填): 来源——PRD「顶部切昨天」，回显请求的 `today`/`yesterday`
- `cards` (array, 必填): 来源——PRD「每台客服机一张卡」

每张卡（`cards[]`）字段：
- `cs_wechat_id` (string, 必填): 来源——PRD「微信号身份章 cs_wechat_id」
- `received_count` (number, 必填): 来源——**PRD E2E 点 2 字面字段**（接收=count(in)）
- `reply_count` (number, 必填): 来源——**PRD E2E 点 2 字面字段**（回复=count(out)）
- `served_customers` (number, 必填): 来源——**PRD E2E 点 2 字面字段**（接待=distinct 客户）
- `work_duration_minutes` (number, 必填): 来源——**PRD E2E 点 2 字面字段**（工作时长=末条−首条分钟）
- `cs_name` (string, 展示enrichment): 来源——PRD「客服名」，取 `persona->>'name'`
- `auto_agent_enabled` (boolean, 展示enrichment): 来源——PRD「真发/演练标」
- `online` (boolean, 展示enrichment): 来源——PRD「在线状态」，取 listener 心跳

**禁用字段名**（generator 不得漂移成这些同义名，仅可出现在反向 `! has(...)` 检查）:
`["in_count","out_count","received","replies","customers","served","duration","minutes","work_minutes","count_in","count_out"]`

**Error (HTTP 400)** — `date` 非 `today`/`yesterday`:
```json
{"error": "INVALID_DATE", "message": "date 仅支持 today|yesterday"}
```

---

## 口径 SQL（钉死 — generator 必须按此聚合，北京时区）

```sql
-- :TARGET_DATE = (now() AT TIME ZONE 'Asia/Shanghai')::date            （date=today）
--             或 (now() AT TIME ZONE 'Asia/Shanghai')::date - 1        （date=yesterday）
SELECT
  c.wechat_id                                         AS cs_wechat_id,
  c.persona->>'name'                                  AS cs_name,
  c.auto_agent_enabled                                AS auto_agent_enabled,
  COALESCE(s.received_count, 0)                       AS received_count,
  COALESCE(s.reply_count, 0)                          AS reply_count,
  COALESCE(s.served_customers, 0)                     AS served_customers,
  COALESCE(s.work_duration_minutes, 0)                AS work_duration_minutes
FROM zenithjoy.wechat_cs_account_config c
LEFT JOIN (
  SELECT
    cs_wechat_id,
    count(*) FILTER (WHERE role = 'in')   AS received_count,
    count(*) FILTER (WHERE role = 'out')  AS reply_count,
    count(DISTINCT contact)               AS served_customers,
    COALESCE(
      ROUND(EXTRACT(EPOCH FROM (max(created_at) - min(created_at))) / 60.0)::int, 0
    )                                     AS work_duration_minutes
  FROM zenithjoy.cs_memory_messages
  WHERE cs_wechat_id IS NOT NULL                                  -- 老数据 NULL 不计入
    AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = :TARGET_DATE  -- 北京日界
  GROUP BY cs_wechat_id
) s ON s.cs_wechat_id = c.wechat_id;
```

口径锁（与 PRD「口径钉死」逐条对应）：
- 接收 `received_count` = `count(*) FILTER (WHERE role='in')`
- 回复 `reply_count` = `count(*) FILTER (WHERE role='out')`
- 接待 `served_customers` = `count(DISTINCT contact)`
- 工作时长 `work_duration_minutes` = `round((max(created_at)-min(created_at)) 秒 / 60)`；单条消息 → max=min → **0**
- 日界 = `(created_at AT TIME ZONE 'Asia/Shanghai')::date`（中台在美区也以北京日归日，防 #832）
- `cs_wechat_id IS NULL` 的行**永不进任何聚合**（不串号、不报错）

---

## 接缝清单（v9.3 — 碰真实世界的点，必真目标验证）

> 「这功能在哪几个点碰真实世界？」答：① 真实写入路径盖身份章；② 真实浏览器渲染卡片。其余（SQL 口径/时区/NULL 排除/schema）全是环境无关的**逻辑断言**，psql seed + curl 在 CI 验绿 = 真 done。

| # | 接缝（环境相关） | 真目标验证方式 | 状态判定 |
|---|---|---|---|
| 1 | **身份章在真实落库路径被写入**：名单内客户私聊→客服机回复，in/out 两条落 `cs_memory_messages` 时 `cs_wechat_id` = 当前客服机配置微信号（来源链 machine→`service_agents.wechat_id`/config，**非 mock 注入**） | mode-A 集成断言：调真实写入函数（`appendMessage`/`appendTenantMessage` 或 `POST /api/wechat/draft-generate` 真实链路）后 `SELECT cs_wechat_id FROM cs_memory_messages` 该行 = 配置微信号；**禁止 `MOCK_*`/stub 替身** | 真写入路径验过=done；若身份链未接到真实 machine 解析仅占位 → 标 `logic-done-pending` |
| 2 | **真实浏览器渲染**：dashboard「客服工作汇总」页真实加载、卡片 4 数可见、今天/昨天切换真实改数 | mode-B final-e2e：windows_cloud GHA windows-latest 真实 Chromium Playwright，`toBeVisible`/`toHaveText` 断言 + 截图 | GHA 真浏览器验过=done |

**禁止写死环境假设值**：不得硬编码「美区当前时刻=昨天」之类的固定偏移；时区归日一律 `AT TIME ZONE 'Asia/Shanghai'` 由 DB 推导，不写死小时差。

---

## Golden Path

[管理员打开「客服工作汇总」页] → [看每台客服机一张卡的今天 4 数] → [切「昨天」看另一天的数]，其上游 = [客户私聊→客服机回复→in/out 落库自动盖 cs_wechat_id 身份章]

### Step 1: 落库自动盖身份章（cs_wechat_id）
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「in/out 落库时自动盖该客服微信号身份章 cs_wechat_id」+ 预期受影响文件 `wechat-draft.ts appendMessage`

**可观测行为**: 经真实写入路径写入 `cs_memory_messages` 的 in/out 两条消息，行上 `cs_wechat_id` 非空且等于当前客服机配置微信号（不靠 `MOCK_*`）。

**验证命令**（mode-A 集成，真写入路径；不可用 mock 替身 — 接缝 1）:
```bash
# RUN_TOKEN 隔离本轮 seed，避免历史数据冒充；测前清理本 token
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
TK="cswstat-$$-$RANDOM"
# 触发真实写入路径（draft-generate 真实链路会经 appendMessage 写 in/out）；
# 若该链路在 CI 不可达，generator 必须提供等价「真实写入函数」集成测试（非 mock）
psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id) VALUES ('t_$TK','cust1','in','你好','wxid_$TK')"
ROW=$(psql "$DB" -t -c "SELECT cs_wechat_id FROM zenithjoy.cs_memory_messages WHERE tenant_id='t_$TK' AND cs_wechat_id IS NOT NULL" | tr -d ' ')
[ "$ROW" = "wxid_$TK" ] || { echo "FAIL: cs_wechat_id 未盖章 got=$ROW"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='t_$TK'"
echo OK
```
**硬阈值**: 写入行 `cs_wechat_id` 字面 = 配置微信号；in/out 两处均盖章。
> gate-allow: db-time-window 本断言按 RUN_TOKEN 唯一 tenant/cs_wechat_id 隔离 + 测前后 DELETE，历史数据无法冒充，故不用 NOW() 时间窗。

### Step 2: schema 迁移 — cs_wechat_id 列 + 索引
**来源**: `[FROM_PRD]` — 范围限定「cs_wechat_id 字段 + 索引」+ NFR「nullable，老数据 NULL 不报错不回填」

**可观测行为**: 新迁移文件给 `cs_memory_messages` 加 `cs_wechat_id`（nullable）+ 索引 `(cs_wechat_id, created_at)`。

**验证命令**（schema 存在性，禁用 information_schema，按 PRD E2E 点 1 读迁移文件）:
```bash
F=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages*.sql 2>/dev/null | head -1)
[ -n "$F" ] || { echo "FAIL: 迁移文件不存在"; exit 1; }
node -e '
const c=require("fs").readFileSync(process.argv[1],"utf8").toLowerCase();
if(!/alter table\s+zenithjoy\.cs_memory_messages/.test(c)) {console.error("FAIL: 未 ALTER cs_memory_messages");process.exit(1)}
if(!/add column.*cs_wechat_id/.test(c)) {console.error("FAIL: 未加 cs_wechat_id");process.exit(1)}
if(/cs_wechat_id\s+text\s+not\s+null/.test(c)) {console.error("FAIL: cs_wechat_id 必须 nullable");process.exit(1)}
if(!/create index.*cs_wechat_id.*created_at/s.test(c)) {console.error("FAIL: 缺索引 (cs_wechat_id, created_at)");process.exit(1)}
console.log("OK")
' "$F"
```
**硬阈值**: 列存在 + nullable + 索引 `(cs_wechat_id, created_at)`。

### Step 3: GET /cs/stats 今天口径精确
**来源**: `[FROM_PRD]` — Golden Path 第 3 步 + 口径钉死 + E2E 点 2

**可观测行为**: seed 已知 in/out 消息（指定 cs_wechat_id + created_at=北京今天）→ 接口返回该卡 4 数精确等于预期。

**验证命令**（mode-A，真实 apps/api + 真 DB）:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
API="${API_BASE:-http://localhost:3000}"
TK="cswstat-$$-$RANDOM"; W="wxid_$TK"
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$W'; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$W';"
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id, persona) VALUES ('$W', '{\"name\":\"客服$TK\"}'::jsonb)"
NOWB="(now() AT TIME ZONE 'Asia/Shanghai')"
# 北京今天 3 in / 2 out / 2 客户 / 首末相隔 17 分钟
psql "$DB" <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t_$TK','c1','in','q1','$W', timezone('Asia/Shanghai', ($NOWB)::date + time '10:00')),
 ('t_$TK','c1','out','a1','$W',timezone('Asia/Shanghai', ($NOWB)::date + time '10:05')),
 ('t_$TK','c1','in','q2','$W', timezone('Asia/Shanghai', ($NOWB)::date + time '10:10')),
 ('t_$TK','c2','in','q3','$W', timezone('Asia/Shanghai', ($NOWB)::date + time '10:15')),
 ('t_$TK','c2','out','a2','$W',timezone('Asia/Shanghai', ($NOWB)::date + time '10:17'));
SQL
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}") || { echo "FAIL: 接口非 2xx"; exit 1; }
CARD=$(echo "$RESP" | jq -c ".cards[] | select(.cs_wechat_id==\"$W\")")
echo "$CARD" | jq -e '.received_count==3'        || { echo "FAIL received_count"; exit 1; }
echo "$CARD" | jq -e '.reply_count==2'           || { echo "FAIL reply_count"; exit 1; }
echo "$CARD" | jq -e '.served_customers==2'      || { echo "FAIL served_customers"; exit 1; }
echo "$CARD" | jq -e '.work_duration_minutes==17'|| { echo "FAIL work_duration_minutes"; exit 1; }
echo "$RESP" | jq -e 'keys == ["cards","date","ok"]' || { echo "FAIL 顶层 schema"; exit 1; }
echo "$CARD" | jq -e 'has("in_count") or has("received") or has("duration") or has("replies") | not' || { echo "FAIL 禁用字段漏网"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$W'; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$W';"
echo OK
```
**硬阈值**: received=3, reply=2, served=2, work_minutes=17，顶层 keys 严格 `["cards","date","ok"]`，禁用字段不存在。
> gate-allow: db-time-window seed 用 RUN_TOKEN 唯一 cs_wechat_id + 测前后 DELETE 隔离；时区测试需固定 created_at，不能用 NOW() 窗口。

### Step 4: 数据隔离 — A 的数绝不出现在 B 的卡片
**来源**: `[FROM_PRD]` — 边界情况「两个不同 cs_wechat_id 各算各的」+ E2E 点 3

**可观测行为**: 灌两个不同 cs_wechat_id 的消息，A 卡只含 A 的数。

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"
TK="cswstat-$$-$RANDOM"; A="wxidA_$TK"; B="wxidB_$TK"
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES ('$A','{\"name\":\"A\"}'::jsonb),('$B','{\"name\":\"B\"}'::jsonb)"
psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES ('t','ca','in','x','$A'),('t','cb','in','y','$B'),('t','cb','in','z','$B')"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}")
echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$A\") | .received_count==1" || { echo "FAIL A!=1"; exit 1; }
echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$B\") | .received_count==2" || { echo "FAIL B!=2"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id IN ('$A','$B'); DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('$A','$B');"
echo OK
```
**硬阈值**: A.received=1，B.received=2，互不串。
> gate-allow: db-time-window RUN_TOKEN 唯一 cs_wechat_id + 测后 DELETE 隔离历史数据。

### Step 5: 时区 — 北京今天 00:30 仍归「今天」
**来源**: `[FROM_PRD]` — NFR「北京时区聚合日界，美区也归北京日」+ E2E 点 4

**可观测行为**: 灌一条 created_at = 北京今天 00:30（美区当时为昨天）的消息，仍计入 today。

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"
TK="cswstat-$$-$RANDOM"; W="wxidTZ_$TK"
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES ('$W','{\"name\":\"TZ\"}'::jsonb)"
# 北京今天 00:30 → 转成 timestamptz 落库
psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES ('t','c','in','x','$W', timezone('Asia/Shanghai', (now() AT TIME ZONE 'Asia/Shanghai')::date + time '00:30'))"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}")
echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==1" || { echo "FAIL: 北京 00:30 未归今天"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$W'; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$W';"
echo OK
```
**硬阈值**: 北京 00:30 的消息 today 计数 = 1。
> gate-allow: db-time-window 时区测试固定 created_at=北京 00:30，不能用 NOW() 窗口；用 RUN_TOKEN 唯一 cs_wechat_id + DELETE 隔离。

### Step 6: 老数据兼容 — cs_wechat_id NULL 不计入、不报错
**来源**: `[FROM_PRD]` — NFR「nullable，NULL 不计入不报错不回填」+ 边界情况 + E2E 点 5

**可观测行为**: 灌 cs_wechat_id=NULL 的消息，接口正常返回（2xx），该消息不计入任何卡。

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"
TK="cswstat-$$-$RANDOM"
psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES ('t_$TK','cnull','in','orphan',NULL)"
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}") || { echo "FAIL: NULL 数据致接口报错"; exit 1; }
echo "$RESP" | jq -e '.ok == true' || { echo "FAIL: 接口未正常返回"; exit 1; }
# NULL 行不产生任何 cs_wechat_id=null 卡片
echo "$RESP" | jq -e '[.cards[] | select(.cs_wechat_id==null)] | length == 0' || { echo "FAIL: NULL 串成卡片"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='t_$TK'"
echo OK
```
**硬阈值**: 接口 2xx + `ok:true`，无 `cs_wechat_id=null` 卡片。

### Step 7: 切「昨天」返回昨天的数
**来源**: `[FROM_PRD]` — Golden Path 第 4 步「顶部切昨天 → 4 个数变昨天」

**可观测行为**: 灌北京昨天的消息 → `date=yesterday` 该卡有数，`date=today` 该卡为 0。

**验证命令**:
```bash
DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"
TK="cswstat-$$-$RANDOM"; W="wxidY_$TK"
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES ('$W','{\"name\":\"Y\"}'::jsonb)"
psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES ('t','c','in','x','$W', timezone('Asia/Shanghai', ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1) + time '12:00'))"
RY=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}")
RT=$(curl -sf "$API/api/wechat/cs/stats?date=today"     -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}")
echo "$RY" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==1" || { echo "FAIL: yesterday!=1"; exit 1; }
echo "$RT" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==0" || { echo "FAIL: today!=0"; exit 1; }
psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='$W'; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$W';"
echo OK
```
**硬阈值**: yesterday.received=1 且 today.received=0。
> gate-allow: db-time-window 固定 created_at=北京昨天，用 RUN_TOKEN 唯一 cs_wechat_id + DELETE 隔离。

### Step 8: error path — date 非法返 400
**来源**: `[AI_ADDED]` — 理由：防 generator 对非法 `date` 静默当 today 或 500 崩溃造假；锁死 PRD「date=today|yesterday」枚举边界。

**可观测行为**: `date=lastweek` → HTTP 400 + `error` 字段。

**验证命令**:
```bash
API="${API_BASE:-http://localhost:3000}"
CODE=$(curl -s -o /tmp/cswstat_err.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=lastweek" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}")
[ "$CODE" = "400" ] || { echo "FAIL: 非法 date 应 400 got=$CODE"; exit 1; }
jq -e '.error | type == "string"' /tmp/cswstat_err.json || { echo "FAIL: 缺 error 字段"; exit 1; }
echo OK
```
**硬阈值**: HTTP 400 + `error` string。

### Step 9: 前台「客服工作汇总」页 + 今天/昨天切换（UI，windows_cloud）
**来源**: `[FROM_PRD]` — Golden Path 第 2/3/4 步 + 受影响文件 `CsWorkStatsPage.tsx` + `DynamicSidebar`/`navigation.config`

**可观测行为**: dashboard 打开「客服工作汇总」页 → 每台客服机一张卡显示 4 数 → 点「昨天」4 数变化。

**验证**: 见下方 `## E2E 验收`（windows_cloud Playwright，接缝 2）。
**硬阈值**: 卡片可见 + 4 数文本可见 + 点「昨天」后数字 DOM 变化。

---

## E2E 验收（final-e2e — target_environment = windows_cloud 变体 C：Vite + Playwright）

> **职责边界**：本节脚本由 evaluator 在 GHA windows-latest 跑（mode B，接缝 2）。口径精确（Step 3-8）由 mode-A BEHAVIOR 在真实 apps/api + 真 DB 上确定性验证。
>
> **[CI_GAP: `.github/workflows/e2e-windows.yml` 缺 postgres service + apps/api 启动 + migration 步骤]** — 已读该 workflow（仅 checkout + setup-node + ffmpeg + 跑 `e2e-verify.ps1`），**未提供 postgres、未跑 migration、未起 apps/api**。本 UI E2E 需要数据，generator 必须二选一补齐：
> (a) 在 `e2e-windows.yml` 增 postgres（容器/服务）+ `npm run migrate` + 起 apps/api（port 3000）步骤，并在 `e2e-verify.ps1` 内 seed；或
> (b) 让 `CsWorkStatsPage` 走 Playwright `page.route` 拦截 `/api/wechat/cs/stats` 注入**确定性 fixture**（仅 UI 渲染/切换验证用，**不替代 mode-A 真 DB 口径验证**）。
> 推荐 (a)；未补齐前 UI 数据驱动断言标 `logic-done-pending`。

Playwright spec（generator 落 `apps/dashboard/e2e/cs-work-stats.spec.ts`）：
```typescript
import { test, expect } from '@playwright/test';

// 数据来源：方案(a) 真 apps/api+DB 已 seed 一张卡含 today/yesterday 不同数；
// 或方案(b) page.route 注入 fixture（today received=3 / yesterday received=1）
test('客服工作汇总：卡片显示今天 4 数，切昨天数字变化', async ({ page }) => {
  await page.goto('/wechat/cs-stats');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/01-initial.png' });

  // 至少一张客服机卡片可见
  const card = page.locator('[data-testid="cs-work-card"]').first();
  await expect(card).toBeVisible({ timeout: 10000 });
  // 4 个口径数文本均可见
  await expect(card.locator('[data-testid="received_count"]')).toBeVisible();
  await expect(card.locator('[data-testid="reply_count"]')).toBeVisible();
  await expect(card.locator('[data-testid="served_customers"]')).toBeVisible();
  await expect(card.locator('[data-testid="work_duration_minutes"]')).toBeVisible();

  const todayReceived = await card.locator('[data-testid="received_count"]').innerText();
  await page.screenshot({ path: 'screenshots/02-action.png' });

  // 切「昨天」
  await page.click('[data-testid="tab-yesterday"]');
  await expect(page.locator('[data-testid="cs-work-card"]').first()).toBeVisible();
  const yesterdayReceived = await page
    .locator('[data-testid="cs-work-card"]').first()
    .locator('[data-testid="received_count"]').innerText();
  await page.screenshot({ path: 'screenshots/03-result.png' });

  // 今天/昨天数字应不同（fixture/seed 保证）
  expect(todayReceived).not.toBe(yesterdayReceived);
});
```

`e2e-verify.ps1`（详见 `sprints/06232241-line04-cs-work-stats/e2e-verify.ps1`，含 [CI_GAP] 标注的 postgres+api 启动占位）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| stats 口径 + 时区 + NULL + 隔离 + 切日 + error | `tests/cs-work-stats.test.ts` | 口径聚合 / 北京日界 / NULL 排除 / 数据隔离 / yesterday / 非法 date 400 | → 红（端点/口径函数未实现）|
