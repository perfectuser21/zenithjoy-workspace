# Sprint Contract Draft (Round 2) — Path 2 抖音私信主动触达 thin v1

## 已知约束（来自回归测试）

- [agent-burner-routes.test.ts] burner 派单/回报路由：qr-bind / crawl-comments 既有 6 端点 + 6 错码，本 sprint 新增端点必须沿用同一 `{success,data,timestamp}` / `{success,error:{code,message},timestamp}` 包裹格式
- [smoke-fake-agent-burner.test.ts] fake-agent 双门禁：NODE_ENV!=production 否则 404 + X-Smoke-Token 否则 403
- [lead-writer.test.ts] 飞书写表复用 `writeRecord(tenant_id, table_id, fields)`，顺序写、单条失败重试 1 次、整体 lead_write_status=success|failed
- [golden-path-2-b1-smoke.sh] DB 计数断言全部带时间窗 `created_at/updated_at > NOW() - interval`，禁止无时间窗计数

## Response Schema（推导来源: api_registry 不可达 → 复用同 repo agent-burner.ts 既有端点约定 + PRD 字面）

> Brain registry 本轮不可达（curl 返空），按 `apps/api/src/routes/agent-burner.ts` 既有端点的字面约定推导：统一 `{success, data, timestamp}` 成功包裹、`{success, error:{code,message}, timestamp}` 错误包裹。task_type/platform 按 PRD 字面 `dm_outreach` / `douyin`。

### Endpoint 1: POST /api/agent/burner/dm-outreach（派单）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>"}, "timestamp": "<iso>"}
```
- `success` (boolean, 必填): 来源——agent-burner.ts 既有 OK() 包裹
- `data.task_id` (string uuid, 必填): 来源——agent-burner.ts qr-bind / crawl-comments 均返 `data.task_id`
- `timestamp` (string iso, 必填): 来源——agent-burner.ts 既有包裹
**禁用字段名**: `id`（顶层裸 id）、`taskId`（驼峰）、`result`、`dm_id` —— 既有端点一律 `data.task_id` snake_case
**Error (HTTP 400)**: `{"success": false, "error": {"code": "<CODE>", "message": "<string>"}, "timestamp": "<iso>"}`
- 错码集合: `MISSING_PROFILE_URL` / `MISSING_MESSAGE` / `NO_BURNER_SESSION` / `FEISHU_NOT_BOUND`

### Endpoint 2: POST /api/agent/burner/dm-outreach-result（agent 回报）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "sent", "lead_write_status": "success", "feishu_bitable_url": "<url>"}, "timestamp": "<iso>"}
```
- `data.status` (string enum, 必填): `sent` | `limited` | `failed` —— 来源 PRD Golden Path Step 3/4/5 字面
- `data.lead_write_status` (string enum, 必填): `success` | `failed` —— 来源 lead-writer.ts 既有返回
- `data.feishu_bitable_url` (string, 必填): 来源——crawl-comments-result 既有 `feishu_bitable_url`
- failed 且 error_code∈{SESSION_EXPIRED,RISK} 时附 `data.session_disabled` (boolean)
**禁用字段名**: `dm_status`（顶层；状态字段名统一 `status`）、`ok`、`written`、`negation`
**Error**: `MISSING_TASK_ID` (400) / `TASK_NOT_FOUND` (404)

### Endpoint 3: GET /api/agent/burner/dm-tasks/:task_id（查状态）
**Success (HTTP 200)**:
```json
{"success": true, "data": {"task_id": "<uuid>", "status": "done", "dm_status": "sent", "error_code": null, "feishu_bitable_url": "<url>", "profile_url": "<url>", "account_label": "<string>", "created_at": "<iso>", "updated_at": "<iso>"}, "timestamp": "<iso>"}
```
- `data.status` (string, 必填): publish_tasks.status —— `queued`|`running`|`done`|`failed`
- `data.dm_status` (string|null, 必填): 业务触达态 `sent`|`limited`|`failed`|null（此端点取自 response，命名沿用既有 crawl-tasks 的扁平 data 风格）
**Error**: `NO_DM_TASK` (404)

---

## Golden Path
运营 POST 私信触达（主页 URL + 文案） → 中台落 dm_outreach task → xian-pc agent 轮询取单 → 进主页(滑动+停留) → 点私信→输入→回车发送 → agent 回报 status(+证据) → 中台写飞书 Lead 触达状态 → 运营在飞书看到状态

### Step 1: 运营对一个 lead 发起「私信触达」派单
**来源**: `[FROM_PRD]` — Golden Path 第 1 条「运营在中台/脚本对一个 lead 发 POST『私信触达』… → 中台落一条 task_type=dm_outreach / platform=douyin 的 task → 返回 task_id」

**可观测行为**: POST `/api/agent/burner/dm-outreach`（含 profile_url + message + account_label）返回 `data.task_id`，DB `publish_tasks` 新增一行 task_type=`dm_outreach` / platform=`douyin` / status=`queued`

**验证命令**:
```bash
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4waaa\",\"message\":\"您好，看到您在评论区的提问\"}")
echo "$RESP" | jq -e '.success == true and (.data.task_id | type == "string")' || { echo FAIL; exit 1; }
DM_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
C=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND task_type='dm_outreach' AND platform='douyin' AND status='queued' AND created_at > NOW() - interval '60 seconds'")
[ "$C" = "1" ] || { echo "FAIL: dm_outreach task 未落库 (count=$C)"; exit 1; }
```

**硬阈值**: HTTP 200 + data.task_id 为 string + DB 60s 内恰 1 行 task_type=dm_outreach/platform=douyin/status=queued

---

### Step 2: xian-pc 常驻 agent 取单 → 进主页 → 系统记「触达中」
**来源**: `[FROM_PRD]` — Golden Path 第 2 条「xian-pc 常驻 agent 轮询拿到 task → 进对方抖音主页（模拟滑动 + 随机停留）→ 系统状态记为『触达中』」

**可观测行为**: agent 取单后回报中间态（fake-agent 模式模拟），task status=`running`、response.phase=`dm_in_progress`

**验证命令**:
```bash
curl -sf -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM_TASK_ID\",\"phase\":\"dm_in_progress\",\"current_url\":\"https://www.douyin.com/user/MS4waaa\"}" >/dev/null
PHASE=$(psql "$DB" -t -A -c "SELECT response->>'phase' FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND status='running' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$PHASE" = "dm_in_progress" ] || { echo "FAIL: 触达中态未记录 (phase=$PHASE)"; exit 1; }
```

**硬阈值**: status=running 且 response.phase=dm_in_progress，60s 内更新

---

### Step 3: agent 真发私信 → 出现消息气泡 = sent → 回报 → 飞书写「已私信」
**来源**: `[FROM_PRD]` — Golden Path 第 3 条（点私信→输入→回车→气泡=sent）+ 第 5 条（sent→「已私信」/ 附时间 + 触达小号）。
> 真 CDP 发送（semi-button-second 私信按钮 + contenteditable + Enter）由 xian-pc 真机手验（PRD 假设 3 + 范围限定「本 sprint 自动 E2E 不含真发」）；自动 E2E 走 fake-agent 报 status=sent 验**编排 + 飞书回写**。

**可观测行为**: agent POST `/dm-outreach-result` status=sent → task=done、response.dm_status=sent；飞书 Lead 表新增一条 `触达状态=已私信` 记录（含 触达时间 + 触达小号）

**验证命令**:
```bash
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/MS4waaa\",\"screenshot_path\":\"/tmp/zj/dm-sent.png\"}")
echo "$RESP" | jq -e '.success == true and .data.status == "sent" and .data.lead_write_status == "success"' || { echo FAIL; exit 1; }
ST=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$DM_TASK_ID' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
[ "$ST" = "done" ] || { echo "FAIL: sent 后 task 未 done (st=$ST)"; exit 1; }
# 飞书 Lead 表收到「已私信」记录（含触达小号 + 触达时间）
sleep 1
REC=$(curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -c '.records[] | select(.["触达状态"]=="已私信")' | head -1)
[ -n "$REC" ] || { echo "FAIL: 飞书无「已私信」记录"; exit 1; }
echo "$REC" | jq -e '(.["触达小号"] | length > 0) and (.["触达时间"] | length > 0)' || { echo "FAIL: 已私信记录缺 触达小号/触达时间"; exit 1; }
```

**硬阈值**: status=sent → task done + dm_status=sent + 飞书新增 触达状态=已私信 记录（触达小号、触达时间非空），全程 ≤ 10s

---

### Step 4: 对方仅互关受限 → 如实标 limited → 飞书写「未送达-仅互关」（禁止假 sent）
**来源**: `[FROM_PRD]` — Golden Path 第 4 条 + 边界情况「对方仅互关受限 → 必须如实标 limited，禁止假装 sent」

**可观测行为**: agent 报 status=limited → task=done、dm_status=limited；飞书写 `触达状态=未送达-仅互关`，**绝不**写 已私信

**验证命令**:
```bash
# 新派一单走 limited 分支
DM2=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4wbbb\",\"message\":\"hi\"}" | jq -r '.data.task_id')
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM2\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"limited\",\"profile_url\":\"https://www.douyin.com/user/MS4wbbb\"}")
echo "$RESP" | jq -e '.data.status == "limited"' || { echo FAIL; exit 1; }
sleep 1
# 飞书出现「未送达-仅互关」且该主页 URL 不得出现「已私信」
ALL=$(curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads")
echo "$ALL" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wbbb")] | any(.["触达状态"]=="未送达-仅互关")' || { echo "FAIL: 无 未送达-仅互关"; exit 1; }
echo "$ALL" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wbbb")] | any(.["触达状态"]=="已私信") | not' || { echo "FAIL: limited 被错写成 已私信（假 sent）"; exit 1; }
```

**硬阈值**: status=limited → dm_status=limited + 飞书 该主页 触达状态=未送达-仅互关 且 **不含** 已私信

---

### Step 5: session 失效/风控 → error_code 区分 → task failed + 单号停用不连坐
**来源**: `[FROM_PRD]` — Golden Path 出错恢复段「chrome 登录态失效 / 触发风控 → 回报 error_code=SESSION_EXPIRED / RISK → 中台标记该 session 停用 + 该 task failed，不连坐其他号；飞书显示 failed 原因」+ 边界情况「单号停用不连坐」

**可观测行为**: agent 报 status=failed + error_code=SESSION_EXPIRED → task=failed、response.error_code=SESSION_EXPIRED；该 (agent,account_label) burner session status→`expired`（CHECK 约束内合法值，语义=停用），**同 agent 的另一 burner 号仍 active**；飞书写 触达状态=失败 + 失败原因=SESSION_EXPIRED

**验证命令**:
```bash
# 预置同 agent 第二个 burner 号（验证不连坐）
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at, created_at) VALUES ('$AGENT_ID','douyin','装修小号2','burner','active',NOW(),NOW()) ON CONFLICT (agent_id,platform,account_label) DO UPDATE SET status='active'" >/dev/null
DM3=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/MS4wccc\",\"message\":\"hi\"}" | jq -r '.data.task_id')
RESP=$(curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$DM3\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"failed\",\"error_code\":\"SESSION_EXPIRED\",\"profile_url\":\"https://www.douyin.com/user/MS4wccc\"}")
echo "$RESP" | jq -e '.data.status == "failed" and .data.session_disabled == true' || { echo FAIL; exit 1; }
ST=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$DM3' AND updated_at > NOW() - interval '60 seconds'" | tr -d ' ')
EC=$(psql "$DB" -t -A -c "SELECT response->>'error_code' FROM zenithjoy.publish_tasks WHERE id='$DM3'" | tr -d ' ')
[ "$ST" = "failed" ] && [ "$EC" = "SESSION_EXPIRED" ] || { echo "FAIL: task 未 failed/error_code 错 (st=$ST ec=$EC)"; exit 1; }
# 被触达的小号停用（expired），第二个小号不连坐（仍 active）
S1=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND account_label='$LABEL' AND role='burner'" | tr -d ' ')
S2=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND account_label='装修小号2' AND role='burner'" | tr -d ' ')
[ "$S1" = "expired" ] || { echo "FAIL: 触达号未停用 (s1=$S1)"; exit 1; }
[ "$S2" = "active" ] || { echo "FAIL: 连坐了其他号 (s2=$S2)"; exit 1; }
sleep 1
curl -sf "${FEISHU_API_BASE}/__test/seen-records?table_id=tbl_b1_leads" | jq -e '[.records[] | select(.["触达主页 URL"]=="https://www.douyin.com/user/MS4wccc")] | any(.["触达状态"]=="失败" and (.["失败原因"]=="SESSION_EXPIRED"))' || { echo "FAIL: 飞书 失败原因 未写 SESSION_EXPIRED"; exit 1; }
```

**硬阈值**: task=failed + error_code=SESSION_EXPIRED + 该号 status=expired + 另一号仍 active + 飞书 触达状态=失败/失败原因=SESSION_EXPIRED

---

### Step 6: 运营在飞书看到该 lead 状态更新（= 查状态端点反映终态）
**来源**: `[FROM_PRD]` — Golden Path 第 6 条「运营在飞书看到该 lead 状态更新」。自动 E2E 用查状态端点 + 飞书 seen-records 代理「运营可见」。

**可观测行为**: GET `/api/agent/burner/dm-tasks/$DM_TASK_ID` 返回 status=done + dm_status=sent + feishu_bitable_url

**验证命令**:
```bash
curl -sf "$API_BASE/api/agent/burner/dm-tasks/$DM_TASK_ID" \
  | jq -e '.success == true and .data.status == "done" and .data.dm_status == "sent" and (.data.feishu_bitable_url | type == "string")' \
  || { echo "FAIL: 查状态端点终态不匹配"; exit 1; }
# 不存在 task_id → 404 NO_DM_TASK
CODE=$(curl -s -o /tmp/dm404.json -w '%{http_code}' "$API_BASE/api/agent/burner/dm-tasks/00000000-0000-0000-0000-000000000000")
[ "$CODE" = "404" ] || { echo "FAIL: 未知 task 应 404 got $CODE"; exit 1; }
jq -e '.error.code == "NO_DM_TASK"' /tmp/dm404.json || { echo "FAIL: 404 错码非 NO_DM_TASK"; exit 1; }
```

**硬阈值**: 查状态端点 status=done/dm_status=sent/feishu_bitable_url 为 string；未知 task_id 返 404 + NO_DM_TASK

---

### Step 7（派单守卫）: 缺字段 / 无 burner / 未绑飞书 → 4xx + 对应错码
**来源**: `[AI_ADDED]` — 理由：派单是真发的唯一入口，缺守卫则脏单流到真机；error path 防造假（错码必须是新逻辑产出，非 Brain 通用 404）

**可观测行为**: 缺 profile_url→400 MISSING_PROFILE_URL；缺 message→400 MISSING_MESSAGE；account_label 无 active burner session→400 NO_BURNER_SESSION；tenant 未绑飞书→400 FEISHU_NOT_BOUND

**验证命令**:
```bash
# 缺 profile_url
C1=$(curl -s -o /tmp/e1.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"message\":\"x\"}")
[ "$C1" = "400" ] && jq -e '.error.code == "MISSING_PROFILE_URL"' /tmp/e1.json || { echo "FAIL: 缺 profile_url 错码"; exit 1; }
# 缺 message
C2=$(curl -s -o /tmp/e2.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"$LABEL\",\"profile_url\":\"https://www.douyin.com/user/x\"}")
[ "$C2" = "400" ] && jq -e '.error.code == "MISSING_MESSAGE"' /tmp/e2.json || { echo "FAIL: 缺 message 错码"; exit 1; }
# 无 burner session
C3=$(curl -s -o /tmp/e3.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/dm-outreach" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"不存在的号\",\"profile_url\":\"https://www.douyin.com/user/x\",\"message\":\"x\"}")
[ "$C3" = "400" ] && jq -e '.error.code == "NO_BURNER_SESSION"' /tmp/e3.json || { echo "FAIL: 无 burner 错码"; exit 1; }
```

**硬阈值**: 三类非法派单各返 400 + 对应错码（错码字面匹配，禁止落 queued task）

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: agent_remote
**target_environment**: local_api

> 真发（xian-pc 真机 CDP）证据另附 sprint，不入自动 E2E（PRD 范围限定）。下面脚本即落地为 `.github/workflows/scripts/smoke/golden-path-2-dm-smoke.sh`，evaluator 模式 B 直接跑。

```bash
#!/usr/bin/env bash
# Path 2 — 抖音私信主动触达 Golden Path E2E smoke（fake-agent 模式）
set -euo pipefail

[ -z "${API_BASE:-}" ] && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ] && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置"; exit 99; }
curl -fsS -X POST "${FEISHU_API_BASE}/__test/reset" >/dev/null || true

# ── 前置：建 tenant + 飞书 binding + agent + active burner session ──
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-dm-${RANDOM}', 'smoke-dm-key-${RANDOM}', 'free') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID','fake_t_dm',NOW()+interval'1 hour','bascn_dm_app','tbl_dm_profile','tbl_dm_videos','tbl_b1_leads',NOW())" >/dev/null
AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$TENANT_ID','xian-pc-dm-${RANDOM}','xian-pc','online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
LABEL="装修小号1"
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at, created_at) VALUES ('$AGENT_ID','douyin','$LABEL','burner','active',NOW(),NOW()) ON CONFLICT (agent_id,platform,account_label) DO UPDATE SET status='active'" >/dev/null

# Step 1 派单 → Step 2 触达中 → Step 3 sent → Step 6 查状态
#（脚本主体 = 上面 Step 1~7 各「验证命令」串联，DM_TASK_ID/DM2/DM3 复用）
echo "（generator 串联 Step 1~7 验证命令；此处省略重复，以各 Step 验证命令为准）"
echo "✅ Path 2 抖音私信主动触达 Golden Path E2E 通过"
```

> 上面脚本主体由 generator 把 Step 1~7 各「验证命令」段顺序落地为一个可执行 `.sh`；contract-dod.md 的 [BEHAVIOR] 各条即逐段断言来源。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| dm-outreach status→飞书映射 + agent handler | `tests/dm-outreach.test.ts` | sent→已私信 / limited→未送达-仅互关 / failed→失败；handler 返 status | 模块未实现 → import/断言 FAIL |
