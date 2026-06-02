# Sprint Contract Draft (Round 1)

## Sprint 标识

- **Sprint**: Path 4 Step 1 第一刀 — 微信 iLink 客户端通道（thin）
- **journey_type**: `user_facing`（外部微信号给测试号发私聊后能看到 AI 回复；CI 自动化用 mock iLink HTTP；真实用户可见性由 Lead 在 xian-rog 自验 evidence 留证）
- **target_environment**: `local_api`（CI 跑在 Linux runner，apps/api + Postgres + mock iLink HTTP 同进程/同主机；无 UI/Dashboard 可驱动，PRD 明确 Dashboard 不在范围内）
- **is_skeleton**: false（真实业务 sprint，非 playground）

## Golden Path

[Lead 跑 `npm run wechat:ilink-login` / Dashboard 调 `POST /api/wechat/ilink-login-start`]
  → [Step A 拉二维码 + 主理人扫码 + 拿 Bearer token + 写 agent_platform_sessions(role=burner,status=bound)]
  → [Step B 启动 ilink-poller 长轮询 getupdates 收私聊文字]
  → [Step C 调 callOpenRouter(purpose=wechat_ilink_chat_reply) 拿单轮回复]
  → [Step D 构造 sendmessage 请求体（带 context_token）回 iLink]
  → [Step E 调 lead-writer 把交互记录写飞书 Lead 表]
  → [Step F 若任何 ilink 调用返 errcode=-14 → 把 session 标 needs_rebind 并停该 burner 长轮询]

---

### Step A: 扫码登录拿 Bearer token

**来源**: `[FROM_PRD]` — PRD 「Golden Path / Step A — 扫码登录拿 Bearer token」段直接定义（人工扫码 + 系统拿 token + 写 agent_platform_sessions）

**可观测行为**:
- `POST /api/wechat/ilink-login-start` 返回 `{ session_id, qr_url }`
- 扫码完成（CI 用 mock iLink 的 `/auth/poll` 直接返成功）后，`GET /api/wechat/ilink-login-status?session_id=X` 返 `{ status: "bound", uin, wxid, nickname }`
- DB `zenithjoy.agent_platform_sessions` 新增一行：`platform='wechat_personal_ilink'`、`role='burner'`、`status='bound'`、`extra_json` 含 `token`、`uin`、`wxid`

**验证命令**:
```bash
# 由 smoke.sh 提供 mock iLink server（环境变量 ILINK_BASE_URL=http://localhost:7799）
SESSION_RESP=$(curl -fs -X POST http://localhost:3000/api/wechat/ilink-login-start \
  -H "Content-Type: application/json" -d '{"agent_id":"e2e-burner-1"}')
SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.session_id')
echo "$SESSION_RESP" | jq -e '.qr_url | type == "string"' || { echo "FAIL: 无 qr_url"; exit 1; }

# mock iLink server 自动标扫码完成；轮询 status 直到 bound
for i in $(seq 1 10); do
  ST=$(curl -fs "http://localhost:3000/api/wechat/ilink-login-status?session_id=$SESSION_ID" | jq -r '.status')
  [ "$ST" = "bound" ] && break
  sleep 1
done
[ "$ST" = "bound" ] || { echo "FAIL: 未 bound, status=$ST"; exit 1; }

# DB 断言
psql $DB -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions \
  WHERE platform='wechat_personal_ilink' AND role='burner' AND status='bound' \
  AND created_at > NOW() - interval '5 minutes'" | tr -d ' ' | grep -q '^1$' || \
  { echo "FAIL: agent_platform_sessions 无新行"; exit 1; }
```

**硬阈值**: HTTP 200 + status=bound + DB 5 分钟内 1 行（role=burner, platform=wechat_personal_ilink）

---

### Step B: 长轮询启动 + 收私聊文字

**来源**: `[FROM_PRD]` — PRD 「Step B — getupdates 长轮询常驻 + 收私聊」段直接定义

**可观测行为**:
- `POST /api/wechat/ilink-poller-start?session_id=X` 返 `{ status: "started" }`
- mock iLink `/getupdates` 返一条私聊文字 → poller 解析出 `from_user_id`、`text`、`context_token` 后进入 C-D-E 流（不留私聊原文在内存，下一轮 getupdates 用更新后的游标）
- 第一次轮询后 mock iLink 应记录到 poller 携带了 Bearer token + X-WECHAT-UIN header

**验证命令**:
```bash
curl -fs -X POST "http://localhost:3000/api/wechat/ilink-poller-start?session_id=$SESSION_ID" \
  | jq -e '.status == "started"' || { echo "FAIL: poller 未启动"; exit 1; }

# mock iLink 内置一条预置私聊文字；等 poller 拉到（最多 10s）
for i in $(seq 1 10); do
  CNT=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq 'length')
  [ "$CNT" -ge 1 ] && break
  sleep 1
done
[ "$CNT" -ge 1 ] || { echo "FAIL: poller 未触发 sendmessage（即未走通 B→C→D）"; exit 1; }

# 校验 poller 发出的请求带正确 header
curl -fs http://localhost:7799/__mock/last-getupdates-headers \
  | jq -e '.authorization | startswith("Bearer ") and (. != "Bearer ")' \
  || { echo "FAIL: getupdates 未携带 Bearer token"; exit 1; }
curl -fs http://localhost:7799/__mock/last-getupdates-headers \
  | jq -e '.["x-wechat-uin"] | type == "string"' \
  || { echo "FAIL: getupdates 未携带 X-WECHAT-UIN"; exit 1; }
```

**硬阈值**: poller 启动后 10 秒内 mock iLink 的 sendmessage 调用 ≥ 1；getupdates 携带 Bearer + X-WECHAT-UIN

---

### Step C: DeepSeek 生成回复

**来源**: `[FROM_PRD]` — PRD 「Step C — DeepSeek 生成回复」段直接定义（复用 callOpenRouter，purpose=wechat_ilink_chat_reply）

**可观测行为**:
- 收到 Step B 私聊文字后，调 `callOpenRouter({ prompt, purpose: 'wechat_ilink_chat_reply' })`
- `zenithjoy.llm_audit` 表新增一行：`request_purpose='wechat_ilink_chat_reply'`、`success=true`、`created_at` 在最近 5 分钟内

**验证命令**:
```bash
# CI 用环境变量 OPENROUTER_BASE_URL 把 callOpenRouter 指到本地 mock；mock 返回固定 content
psql $DB -t -c "SELECT count(*) FROM zenithjoy.llm_audit \
  WHERE request_purpose='wechat_ilink_chat_reply' \
  AND success=true \
  AND created_at > NOW() - interval '5 minutes'" | tr -d ' ' | grep -q '^[1-9]' || \
  { echo "FAIL: llm_audit 无 wechat_ilink_chat_reply 行"; exit 1; }
```

**硬阈值**: 5 分钟内 ≥ 1 行 `request_purpose='wechat_ilink_chat_reply'` 且 `success=true`

---

### Step D: sendmessage 自动回

**来源**: `[FROM_PRD]` — PRD 「Step D — sendmessage 自动回」段直接定义

**可观测行为**:
- 用 Step C 生成的 content 构造请求体：`to_user_id`、`context_token`（来自 Step B）、`item_list=[{type:'text',text:<content>}]`
- mock iLink `/sendmessage` 收到一次 POST，body schema 完整
- mock iLink 返成功 → 客户端记录 `message_id`（仅日志，不存 DB；第一刀范围）

**验证命令**:
```bash
# 校验 sendmessage 请求 schema 完整性
LAST=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq '.[-1]')
echo "$LAST" | jq -e '.to_user_id | type == "string"' || { echo "FAIL: 缺 to_user_id"; exit 1; }
echo "$LAST" | jq -e '.context_token | type == "string"' || { echo "FAIL: 缺 context_token"; exit 1; }
echo "$LAST" | jq -e '.item_list | type == "array" and length == 1' || { echo "FAIL: item_list 异常"; exit 1; }
echo "$LAST" | jq -e '.item_list[0].type == "text"' || { echo "FAIL: type 非 text"; exit 1; }
echo "$LAST" | jq -e '.item_list[0].text | type == "string" and length > 0' || { echo "FAIL: text 空"; exit 1; }
```

**硬阈值**: sendmessage body 含 to_user_id（string） + context_token（string） + item_list（1 元素 text 类型 + 非空 text）

---

### Step E: writeLead 写飞书 Lead 表

**来源**: `[FROM_PRD]` — PRD 「Step E — writeLead 写飞书 Lead 表」段直接定义（复用 lead-writer）

**可观测行为**:
- Step D 成功后调用 lead-writer 的 wechat chat 包装函数（如 `writeWechatChatLead`），把 `{ from_user_id, 客户原话, AI 回复, 时间, context_token }` 写入飞书 Lead 表
- 飞书写入由 mock feishu HTTP（已存在 `_smoke-feishu-seed` 等 fake 路径）接收；CI 在 DB 镜像表或内存 spy 中可验

**验证命令**:
```bash
# mock feishu writeRecord 调用日志（smoke.sh 启动时 mock 自带 __mock/feishu-write-log 端点）
WLOG=$(curl -fs http://localhost:7799/__mock/feishu-write-log)
echo "$WLOG" | jq -e 'length >= 1' || { echo "FAIL: lead-writer 未写飞书"; exit 1; }
LAST_WRITE=$(echo "$WLOG" | jq '.[-1].fields')
echo "$LAST_WRITE" | jq -e '. | type == "object"' || { echo "FAIL: writeRecord 字段非对象"; exit 1; }
# 至少含 from_user_id（客户微信 id） 和 context_token（错误追踪用）
echo "$LAST_WRITE" | jq -e 'keys | any(. == "from_user_id") and any(. == "context_token")' \
  || { echo "FAIL: writeRecord 缺 from_user_id 或 context_token"; exit 1; }
```

**硬阈值**: mock feishu writeRecord 调用 ≥ 1 次，字段含 `from_user_id` + `context_token`

---

### Step G: migration 加 extra_json JSONB + status CHECK 含 bound/needs_rebind（[AI_ADDED]）

**来源**: `[AI_ADDED]` — **PRD 假设漏洞**：PRD 假设段第 4 条只提"若 platform CHECK 阻拦才加 migration"，但实际现状（已 grep 仓库当前 schema 确认）：
1. `agent_platform_sessions.status` 已被 `20260524_110000_*` 的 CHECK 约束写死为 `('pending','active','connected','offline','expired')` —— `'bound'` 和 `'needs_rebind'` 都不在内，Step A / Step F 的 INSERT/UPDATE 会被 CHECK 静默 reject（或抛 23514）→ DB 没行 → 所有下游 BEHAVIOR 假绿/假红 都不到位。
2. `agent_platform_sessions` 表无 `extra_json` JSONB 列（grep 全部 migrations 确认）；Step A 要存 `{token,uin,wxid,nickname,scanned_at}` 必须有这列。
3. `platform` 字段无 CHECK 约束，`'wechat_personal_ilink'` 可直接写入，**无需**为 platform 加 migration（PRD 假设第 4 条已正确）。

**可观测行为**:
- `apps/api/db/migrations/20260602_*_aps_ilink_extras.sql` 存在（文件名前缀 `20260602_`，含 `aps`/`ilink` 关键字）
- 内容含：`ADD COLUMN IF NOT EXISTS extra_json JSONB`
- 内容含：DROP/ADD CONSTRAINT chk_aps_status，新值集合包含 `'bound'` 与 `'needs_rebind'`
- 必须保留旧 5 个值（`pending`/`active`/`connected`/`offline`/`expired`）——不许把 status 改成完全替换，否则历史 Path 1 主号 INSERT 全炸

**关键约束（[AI_ADDED]）**:
- 幂等：复用 20260510 + 20260524 现有 `DO $$...IF NOT EXISTS...$$` 模式
- 不许新建 `aps_ilink` 子表（PRD 范围限定明确"复用 agent_platform_sessions + role 字段"）

**验证命令**:
```bash
node -e "
const fs=require('fs');const path=require('path');
const dir='apps/api/db/migrations';
const files=fs.readdirSync(dir).filter(f=>/^20260602_.*aps.*ilink.*\.sql\$/i.test(f));
if(files.length===0){console.error('FAIL: 未找到 20260602_*_aps*ilink*.sql migration');process.exit(1)}
const sql=fs.readFileSync(path.join(dir,files[0]),'utf8');
if(!/ADD COLUMN.*extra_json.*JSONB/i.test(sql)){console.error('FAIL: 缺 ADD COLUMN extra_json JSONB');process.exit(2)}
if(!/'bound'/.test(sql)){console.error('FAIL: 缺 status bound');process.exit(3)}
if(!/'needs_rebind'/.test(sql)){console.error('FAIL: 缺 status needs_rebind');process.exit(4)}
for (const old of ['pending','active','connected','offline','expired']) {
  if(!sql.includes(\"'\"+old+\"'\")){console.error('FAIL: 删了旧 status '+old);process.exit(5)}
}
console.log('OK');
"
```

**硬阈值**: exit 0；文件存在 + extra_json JSONB + 新值 bound/needs_rebind + 保留旧 5 个值。

---

### Step F: token 失效分支（errcode=-14）

**来源**: `[FROM_PRD]` — PRD 「Step F — token 失效分支」段直接定义

**可观测行为**:
- 触发 mock iLink 下一轮 `/getupdates` 返 `{ errcode: -14, errmsg: "session timeout" }`
- poller catch 到 → 把 DB 该 session 行 `status` 改为 `needs_rebind`
- 停止该 burner 的长轮询循环（后续 mock iLink 不再收到 getupdates）

**验证命令**:
```bash
# 触发 mock 切换到 -14 模式
curl -fs -X POST http://localhost:7799/__mock/trigger-session-timeout

# 等最多 15s 看 DB 状态变 needs_rebind
for i in $(seq 1 15); do
  ST=$(psql $DB -t -c "SELECT status FROM zenithjoy.agent_platform_sessions \
    WHERE platform='wechat_personal_ilink' AND role='burner' \
    ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ "$ST" = "needs_rebind" ] && break
  sleep 1
done
[ "$ST" = "needs_rebind" ] || { echo "FAIL: -14 后 status 未改 needs_rebind, status=$ST"; exit 1; }

# 确认 poller 已停（再等 5s，sendmessage-log 数量不应再增）
BEFORE=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq 'length')
sleep 5
AFTER=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq 'length')
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: poller 未停（sendmessage 仍在增）"; exit 1; }
```

**硬阈值**: DB status=needs_rebind（15s 内）+ poller 停止（5s 内 sendmessage 数量不变）

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> 选模板理由：PRD 范围内 CI 自动化用 mock iLink + curl + psql；无 UI/Dashboard 可驱动（PRD 明确不在范围）；journey_type=user_facing 的"真实用户可见性"由 Lead 在 xian-rog 自验 evidence（`.agent-knowledge/path-4/ilink-step1-acceptance.md`）补足，但**不在自动化 E2E 范围内**（人工动作不可机械化）。

**`.github/workflows/scripts/smoke/golden-path-4-smoke.sh`**：

```bash
#!/bin/bash
# Path 4 Step 1 第一刀 — mock 链路 dryrun
set -e

DB="${DB:-postgresql://localhost/zenithjoy_test}"
API_PORT=3000
MOCK_PORT=7799

# 0. 启动 mock iLink + mock OpenRouter + mock 飞书（三合一 fastify mock，端口 7799）
node apps/api/scripts/mock-ilink-server.js & MOCK_PID=$!
trap "kill $MOCK_PID 2>/dev/null || true" EXIT
sleep 2

# 1. 启动 apps/api（指向 mock）
ILINK_BASE_URL=http://localhost:$MOCK_PORT \
OPENROUTER_BASE_URL=http://localhost:$MOCK_PORT/openrouter \
FEISHU_BASE_URL=http://localhost:$MOCK_PORT/feishu \
PORT=$API_PORT \
DATABASE_URL=$DB \
npm --prefix apps/api run start:test & API_PID=$!
trap "kill $API_PID $MOCK_PID 2>/dev/null || true" EXIT

# 等 API 就绪
for i in $(seq 1 20); do
  curl -fs http://localhost:$API_PORT/health >/dev/null && break
  sleep 1
done

# 2. Step A — 扫码登录拿 token
SESSION_RESP=$(curl -fs -X POST http://localhost:$API_PORT/api/wechat/ilink-login-start \
  -H "Content-Type: application/json" -d '{"agent_id":"e2e-burner-1"}')
SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.session_id')
[ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "null" ] || { echo "FAIL: Step A 无 session_id"; exit 1; }

for i in $(seq 1 10); do
  ST=$(curl -fs "http://localhost:$API_PORT/api/wechat/ilink-login-status?session_id=$SESSION_ID" | jq -r '.status')
  [ "$ST" = "bound" ] && break
  sleep 1
done
[ "$ST" = "bound" ] || { echo "FAIL: Step A status=$ST"; exit 1; }
echo "✅ Step A 通过"

# 3. Step B-C-D-E — 启动 poller 后等闭环触发
curl -fs -X POST "http://localhost:$API_PORT/api/wechat/ilink-poller-start?session_id=$SESSION_ID" >/dev/null
for i in $(seq 1 15); do
  SENT=$(curl -fs http://localhost:$MOCK_PORT/__mock/sendmessage-log | jq 'length')
  [ "$SENT" -ge 1 ] && break
  sleep 1
done
[ "$SENT" -ge 1 ] || { echo "FAIL: Step B-D 未走通"; exit 1; }

# Step C 验证 llm_audit
psql $DB -t -c "SELECT count(*) FROM zenithjoy.llm_audit \
  WHERE request_purpose='wechat_ilink_chat_reply' AND success=true \
  AND created_at > NOW() - interval '5 minutes'" | tr -d ' ' | grep -q '^[1-9]' \
  || { echo "FAIL: Step C llm_audit 无记录"; exit 1; }

# Step E 验证 feishu writeRecord
curl -fs http://localhost:$MOCK_PORT/__mock/feishu-write-log | jq -e 'length >= 1' \
  || { echo "FAIL: Step E feishu 未写"; exit 1; }
echo "✅ Step B-C-D-E 通过"

# 4. Step F — 触发 -14 → 验 DB 改 needs_rebind
curl -fs -X POST http://localhost:$MOCK_PORT/__mock/trigger-session-timeout
for i in $(seq 1 15); do
  ST=$(psql $DB -t -c "SELECT status FROM zenithjoy.agent_platform_sessions \
    WHERE platform='wechat_personal_ilink' AND role='burner' \
    ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
  [ "$ST" = "needs_rebind" ] && break
  sleep 1
done
[ "$ST" = "needs_rebind" ] || { echo "FAIL: Step F status=$ST"; exit 1; }
echo "✅ Step F 通过"

echo "✅ Golden Path 4 Step 1 第一刀全程通过"
```

**通过标准**: 脚本 exit 0；Step A→F 每段日志打印 ✅
**FAIL 标准**: 任意 step exit 非 0 / 任意断言失败 / 总耗时 > 90s

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ilink-client（getupdates 解析 / sendmessage 构造 / -14 分支）| `sprints/06020844-wechat-ilink-channel/tests/ilink-client.test.ts` | Step B 解析、Step D 构造、Step F errcode 分支 | → 3 failures（文件/导出未实现） |
| ilink-poller + lead-writer 端到端 | `sprints/06020844-wechat-ilink-channel/tests/ilink-poller-e2e.test.ts` | Step B→E 全链路（mock iLink + mock OpenRouter + mock 飞书）| → 1 failure（poller 模块未实现） |
| wechat-ilink 路由 | `sprints/06020844-wechat-ilink-channel/tests/wechat-ilink-routes.test.ts` | Step A 三个端点 | → 3 failures（路由未注册） |
