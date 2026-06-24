# Sprint Contract Draft (Round 1) — Line04 中台 AI-native CRM·客户列表页

> 系统对象（真实被测系统）：ZenithJoy 中台 API = `apps/api`（Express，base `http://localhost:5200`）+
> `zenithjoy.*` Postgres + `apps/dashboard`（React+Vite，localhost:5174）。
> **不是** Cecelia Brain(5221)——本 sprint 是 ZenithJoy 产品功能，BEHAVIOR 一律打产品 API :5200 + psql zenithjoy schema。
> journey_type=user_facing；target_environment=windows_cloud（GHA windows-latest 跑 e2e-verify.ps1 + Playwright）。

---

## 已知约束（来自回归测试）

- [apps/api/src/middleware/cs-config-guard.test.ts] → 写接口闸链：member→403 NOT_ADMIN；跨租户→403 CROSS_TENANT；目标解析不到→404 TARGET_NOT_FOUND（deny by default）
- [apps/api/tests/regression/line04-cs-config-permission.test.ts] → 写客服配置必须 owner/admin 角色
- [apps/api/tests/regression/line04-cs-tenant-isolation.test.ts] → 客服读写按 req.tenantId scope，缺租户上下文一律 4xx，绝不回退全量
- [apps/api/src/routes/wechat-config.ts] → `PUT /api/wechat/cs/config/:wechatId` 挂 `requireCsWriteAccess('wechatId')`；whitelist 为 `JSONB string[]`（微信昵称数组）
- [services/agent/wechat-rpa/cs_config_gate.py::should_reply] → `sender_name in config.whitelist` 才回（白名单 gate，环境无关纯函数）

**本 sprint 修两处既有 bug（必带 failing test 进 repo，永久回归）**：
1. `apps/dashboard/src/pages/PerCsConfigPage.tsx:111` 及客户列表 fetch 写接口**缺 `credentials:'include'`** → 浏览器不带 better-auth session cookie → tenantContext 401「未登录」。
2. `apps/api/src/routes/crm.ts:46` `GET /api/crm/wechat-contacts` 读 **client 提供的 `?tenant_id=default` query 参数**返回 mock，**无租户闸**（任意 tenant_id 都返回同一份）。

---

## Response Schema（推导来源：NEW_PATTERN — Brain registry 不可达，按 apps/api 既有约定推导：snake_case 字段、读接口裸数据、写接口 `{success,...}` 信封、guard 拒绝用嵌套 `error.{code,message}`、校验 400 用 `{error:"..."}`）

### Endpoint A: `GET /api/crm/customers`（租户内客户列表，需登录）
鉴权：`tenantContext`（缺/失效登录态 → 401；无租户 → 403 NO_TENANT）。scope：仅当前 `req.tenantId` 自己客服机（service_agents.wechat_id）的客户。
**Success (HTTP 200)**:
```json
{"customers":[{"name":"张三","contact":"张三","wechat_id":"wx_001","status":"A3","last_contact_at":"2026-06-24T08:00:00.000Z","managed":true}],"total":1}
```
- `customers` (array, 必填): 名册 = `cs_memory_messages` 按 (tenant_id, contact) distinct 已聊过的人 ∪ `crm_customers` source='manual' 手动加的人。来源——NEW_PATTERN（PRD Golden Path Step 1）
- `name` (string, 必填): 客户姓名/微信昵称（第一刀身份 key=昵称）。来源——NEW_PATTERN（CustomerListPage 既有把 nickname→name）
- `contact` (string, 必填): 客户昵称（whitelist 命中 key，与 should_reply 的 sender_name 同字面）。来源——cs_memory_messages.contact / cs_config_gate
- `wechat_id` (string|null): 客户微信号（手填可空）。来源——NEW_PATTERN
- `status` (string, 必填): A1-A5 枚举，无记录默认 'A1'。来源——NEW_PATTERN（PRD Step 4）
- `last_contact_at` (string ISO8601 | null): 最后联系时间 = `max(cs_memory_messages.created_at)`；手动加未聊过→null。来源——PRD Step 1「最后联系时间」
- `managed` (boolean, 必填): 接管开关态 = `contact ∈ wechat_cs_account_config.whitelist`（实时读 whitelist，非缓存）。来源——PRD Step 2
- `total` (number, 必填): customers 长度。
**禁用字段名**（drift 信号，正向断言中绝不出现）: `rating`、`is_managed`、`enabled`、`checked`、`stage`、`tenant_id`（响应体不得回泄租户 id）
**Error**: 401（未登录，body 含提示语义）；403 `{"success":false,"data":null,"error":{"code":"NO_TENANT","message":"..."},"timestamp":"..."}`

### Endpoint B: `PUT /api/crm/customers/manage`（接管开关 → 写 whitelist，需登录+管理员+同租户）
鉴权：`requireCsWriteAccess('wechatId')`（tenantContext → requireCsAdmin → requireSameTenant）。
**Body**: `{"wechat_id":"<本租户客服机微信号>","contact":"张三","managed":true}`
**Success (HTTP 200)**:
```json
{"success":true,"managed":true,"message":"保存成功"}
```
- `managed` (boolean): 写后该 contact 是否在 whitelist 内（true=已加入，false=已移除）。
- `message` (string): '保存成功'（PRD「返回保存成功」字面）。
**副作用**: `wechat_cs_account_config.whitelist` JSONB 数组中 `contact` 存在(true)/移除(false)，幂等。
**Error**: 401 未登录（**修复后登录管理员调用必须 200，不再 401**）；403 NOT_ADMIN（非管理员）；403 CROSS_TENANT（跨租户）；404 TARGET_NOT_FOUND。

### Endpoint C: `PUT /api/crm/customers/status`（状态 A1-A5 持久化，需登录+管理员+同租户）
**Body**: `{"wechat_id":"<客服机微信号>","contact":"张三","status":"A3"}`
**Success (HTTP 200)**:
```json
{"success":true,"status":"A3"}
```
- `status` (string): 回显已落库的状态（必须 ∈ A1..A5，非法值 → 400）。
**副作用**: `crm_customers` upsert (tenant_id, cs_wechat_id, contact) 行 status='A3'。
**Error**: 400 `{"error":"..."}`（status 非 A1-A5）；401/403 同 B。

### Endpoint D: `POST /api/crm/customers`（+加客户入册，需登录+管理员+同租户）
**Body**: `{"wechat_id":"<客服机微信号>","name":"周八","contact":"周八"}`
**Success (HTTP 200)**:
```json
{"success":true,"customer":{"name":"周八","contact":"周八","wechat_id":null,"status":"A1","managed":false}}
```
**副作用**: `crm_customers` 插入 source='manual' 行；随后 GET 列表能查到。
**Error**: 400（contact 缺失）；401/403 同 B。

---

## 数据模型（Proposer 倒推 — PRD ASSUMPTION「状态落库字段由 Proposer 倒推」）

新增 migration `apps/api/db/migrations/<ts>_create_crm_customers.sql`：
```sql
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customers (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  cs_wechat_id text NOT NULL,                         -- 所属客服机微信号 = wechat_cs_account_config 主 key
  contact      text NOT NULL,                          -- 客户昵称（第一刀身份 key，与 whitelist / should_reply 同字面）
  wechat_id    text,                                   -- 客户微信号（手填可空）
  status       text NOT NULL DEFAULT 'A1' CHECK (status IN ('A1','A2','A3','A4','A5')),
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('message','manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cs_wechat_id, contact)
);
CREATE INDEX IF NOT EXISTS idx_crm_customers_tenant_cs ON zenithjoy.crm_customers(tenant_id, cs_wechat_id);
```
名册读取 = `cs_memory_messages`（按 tenant_id distinct contact + max(created_at) last_contact_at）FULL/LEFT JOIN `crm_customers`（取 status/manual 行），`managed` 由 `wechat_cs_account_config.whitelist` 实时比对。

---

## Golden Path

打开「客户列表」页 → GET 租户内客户表 → 勾接管(写 whitelist) → should_reply 命中 → 改状态(持久化) → +加客户 → （全程租户隔离 + 登录态正确传递）

### Step 1: 管理员打开「客户列表」页，系统列出当前租户自己客服机的客户行
**来源**: `[FROM_PRD]` — Golden Path 具体步骤 1（姓名|微信号|状态|最后联系时间|接管开关；名册=消息记录 distinct + 手动加）

**可观测行为**: 登录管理员 GET 客户列表，返回本租户客服机客户数组；每行含 name / wechat_id / status / last_contact_at / managed；非本租户客户绝不出现。

**验证命令**（real API :5200，登录态经 better-auth cookie 或 admin header）:
```bash
RESP=$(curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers")
echo "$RESP" | jq -e '.customers | type == "array"' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.customers[0] | has("name") and has("wechat_id") and has("status") and has("last_contact_at") and has("managed")' || { echo FAIL; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo FAIL; exit 1; }
# 禁用字段反向（drift 信号）
echo "$RESP" | jq -e '.customers[0] | (has("rating") or has("is_managed") or has("enabled")) | not' || { echo "FAIL: 出现禁用字段"; exit 1; }
```
**硬阈值**: HTTP 200；customers 为数组；首行含 5 个 PRD 字段；耗时 < 5s。
**验证命令（硬阈值）**: `START=$(date +%s); curl -fs -b "$COOKIE" "${API_BASE}/api/crm/customers" >/dev/null; END=$(date +%s); [ $((END-START)) -lt 5 ] || { echo "FAIL: 耗时 $((END-START))s"; exit 1; }`

---

### Step 2: 管理员打开某客户接管开关 → 写入 whitelist → 返回「保存成功」（登录态正确，不再 401）
**来源**: `[FROM_PRD]` — Golden Path 步骤 2（写 wechat_cs_account_config.whitelist + 返回保存成功 + 不再报「未登录」）

**可观测行为**: 登录管理员 PUT manage(managed=true) → 200 `{success:true,managed:true,message:"保存成功"}`；DB whitelist JSONB 真含该 contact（5 分钟内写入）。

**验证命令**:
```bash
PUT_RESP=$(curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" \
  -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}")
echo "$PUT_RESP" | jq -e '.success == true and .managed == true and .message == "保存成功"' || { echo FAIL; exit 1; }
# 副作用：whitelist JSONB 真含 contact（jsonb 元素存在性）
IN_WL=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT (whitelist @> to_jsonb('$CONTACT'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS_WECHAT_ID' AND updated_at > NOW() - interval '5 minutes'")
[ "$IN_WL" = "t" ] || { echo "FAIL: whitelist 未含 $CONTACT 或非本轮写入"; exit 1; }
```
**硬阈值**: HTTP 200，5 分钟内 whitelist 含 contact，且 **登录态正确时绝不返回 401**。

---

### Step 3: 该客户私聊进来 → 客服读白名单命中 → AI 真回复；未开接管不回（沿用现有 gate）
**来源**: `[FROM_PRD]` — Golden Path 步骤 3（白名单 gate 驱动 should_reply）

**可观测行为**: `cs_config_gate.should_reply(config, sender)`：sender ∈ whitelist → True；未勾接管的 sender → False。（环境无关纯函数 = **逻辑断言**，CI 单测即真 done）

**验证命令**（pytest 真跑 gate 纯函数，不 mock whitelist 逻辑）:
```bash
python3 -c "
import sys; sys.path.insert(0,'services/agent/wechat-rpa')
from cs_config_gate import should_reply
assert should_reply({'whitelist':['张三']}, '张三') is True
assert should_reply({'whitelist':['张三']}, '李四') is False
assert should_reply({'whitelist':[]}, '张三') is False
print('OK')
"
```
**硬阈值**: 命中 True / 未命中 False / 空 whitelist False，三例全过。

---

### Step 4: 管理员下拉改状态为 A3 → 持久化 → 刷新仍显示 A3
**来源**: `[FROM_PRD]` — Golden Path 步骤 4（状态持久化 + 列表刷新仍 A3）

**可观测行为**: PUT status(A3) → 200；DB crm_customers.status='A3'（5 分钟内 upsert）；再 GET 列表该 contact.status 仍为 A3。

**验证命令**:
```bash
curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/status" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A3\"}" | jq -e '.success==true and .status=="A3"' || { echo FAIL; exit 1; }
DB_ST=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT status FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$CONTACT' AND updated_at > NOW() - interval '5 minutes'")
[ "$DB_ST" = "A3" ] || { echo "FAIL: DB status=$DB_ST 非本轮 A3"; exit 1; }
# 刷新仍 A3
curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e --arg c "$CONTACT" '.customers[] | select(.contact==$c) | .status == "A3"' || { echo FAIL; exit 1; }
```
**硬阈值**: 三处一致 A3，5 分钟时间窗。非法 status（如 A9）→ 400。
**验证命令（error path）**: `CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/status" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"status\":\"A9\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 status 未返 400 实际 $CODE"; exit 1; }`

---

### Step 5: 管理员点「+加客户」填姓名/微信号 → 入册（为没聊过的人预设接管/状态）
**来源**: `[FROM_PRD]` — Golden Path 步骤 5（手动入册）

**可观测行为**: POST customers → 200 `{success:true,customer:{...status:"A1",managed:false}}`；DB crm_customers source='manual' 行存在；GET 列表能查到该新人。

**验证命令**:
```bash
NEW_CONTACT="测试客户_$(date +%s)"
curl -sf -b "$COOKIE" -X POST "${API_BASE}/api/crm/customers" -H 'Content-Type: application/json' \
  -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"name\":\"$NEW_CONTACT\",\"contact\":\"$NEW_CONTACT\"}" \
  | jq -e '.success==true and .customer.status=="A1" and .customer.managed==false' || { echo FAIL; exit 1; }
CNT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT count(*) FROM zenithjoy.crm_customers WHERE cs_wechat_id='$CS_WECHAT_ID' AND contact='$NEW_CONTACT' AND source='manual' AND created_at > NOW() - interval '5 minutes'")
[ "$CNT" = "1" ] || { echo "FAIL: 手动客户未入册"; exit 1; }
curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e --arg c "$NEW_CONTACT" 'any(.customers[]; .contact==$c)' || { echo FAIL; exit 1; }
```
**硬阈值**: 入册行 source='manual'，5 分钟时间窗，列表可见。

---

### Step 6: 跨租户隔离 — 管理员 A 的读/写接口绝不返回/改动管理员 B 的客服机数据
**来源**: `[FROM_PRD]` — 边界情况「跨租户」+ 范围限定「读接口补租户隔离闸」+ NFR

**可观测行为**: 租户 B 登录 GET /api/crm/customers 只见 B 自己客服机的客户，绝无 A 的 contact；B PUT manage 改 A 的客服机 wechat_id → 403 CROSS_TENANT。

**验证命令**:
```bash
# B 读：绝不含 A 的 contact
curl -sf -b "$COOKIE_B" "${API_BASE}/api/crm/customers" | jq -e --arg a "$CONTACT" 'all(.customers[]; .contact != $a)' || { echo "FAIL: B 看到 A 的客户=串台"; exit 1; }
# B 写 A 的客服机 → 403 CROSS_TENANT
CODE=$(curl -s -o /tmp/x.json -w "%{http_code}" -b "$COOKIE_B" -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}")
[ "$CODE" = "403" ] || { echo "FAIL: 跨租户写未拦 实际 $CODE"; exit 1; }
jq -e '.error.code == "CROSS_TENANT"' /tmp/x.json || { echo "FAIL: 非 CROSS_TENANT"; exit 1; }
```
**硬阈值**: B 读不到 A、B 跨写 403 CROSS_TENANT。

---

### Step 7: 登录态修复 — 缺/失效登录态写接口返 401 + 提示；登录后重试成功
**来源**: `[FROM_PRD]` — 边界情况「写接管开关返回 401/无权限 → 提示登录失效，重新登录后重试成功」（本次必修 cs-config-guard 登录态未传到写接口 bug）

**可观测行为**: 不带 cookie PUT manage → 401（前端据此提示「登录已失效，请重新登录」）；带正确登录 cookie 重试 → 200 不再 401。

> **接缝诚实声明（对齐 reviewer 问题1）**：下面两条 curl 命令是 **API-level 逻辑断言**——它在 curl 层手动带/不带 cookie，验的是**后端**对 cookie 在/不在的 401/200 行为，**不验** dashboard 前端 fetch 是否真带了 `credentials:'include'`（即真正的「未登录」bug 接缝）。该前端→后端 cookie 接缝的**真目标验证**在 `[BEHAVIOR:E2E:COOKIE-SEAM]`（Step 9 + 接缝清单 #1）：真浏览器在真后端上点开关、真发 session cookie。windows_cloud stub Playwright **不**算这条接缝的验证。

**验证命令**:
```bash
# 无登录态 → 401
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}")
[ "$CODE" = "401" ] || { echo "FAIL: 缺登录态未返 401 实际 $CODE"; exit 1; }
# 带登录态 → 不再 401
CODE2=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":true}")
[ "$CODE2" != "401" ] || { echo "FAIL: 登录管理员仍 401 = 登录态 bug 未修"; exit 1; }
```
**硬阈值**: 无态 401 / 有态 ≠401。

---

### Step 8: managed 字段真实反映 whitelist 当前内容（防前端臆测假绿）
**来源**: `[AI_ADDED]` — 理由：防 generator 用前端硬编码 managed=true 或缓存值假绿；交叉校验 GET 返回的 managed 与 DB whitelist 实时一致，杜绝「列表显示已接管但 whitelist 实际没写进去」的接缝假成功。

**可观测行为**: 对同一 contact，先 manage(true) 再 GET，managed=true 且 DB whitelist 含之；再 manage(false) 再 GET，managed=false 且 DB whitelist 不含之。

**验证命令**:
```bash
curl -sf -b "$COOKIE" -X PUT "${API_BASE}/api/crm/customers/manage" -H 'Content-Type: application/json' -d "{\"wechat_id\":\"$CS_WECHAT_ID\",\"contact\":\"$CONTACT\",\"managed\":false}" | jq -e '.managed==false' || { echo FAIL; exit 1; }
curl -sf -b "$COOKIE" "${API_BASE}/api/crm/customers" | jq -e --arg c "$CONTACT" '.customers[] | select(.contact==$c) | .managed == false' || { echo "FAIL: GET managed 与 whitelist 不一致"; exit 1; }
OUT=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc "SELECT (whitelist @> to_jsonb('$CONTACT'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS_WECHAT_ID'")
[ "$OUT" = "f" ] || { echo "FAIL: managed=false 但 whitelist 仍含"; exit 1; }
```
**硬阈值**: GET.managed 与 DB whitelist 实时一致（true↔含、false↔不含）。

---

### Step 9: cookie 接缝真目标验证 — 真浏览器在真后端上点接管开关，真发 better-auth session cookie
**来源**: `[AI_ADDED]` — 理由：reviewer 问题1（阻塞）。本 sprint 的**必修 bug**就是 dashboard 写接口 fetch 缺 `credentials:'include'` 导致浏览器不带 session cookie → 后端 401「未登录」。此接缝**唯一**能被真验的方式是"真浏览器 + 真 cookie + 真后端"；ARTIFACT 静态 grep / Mode A 的 `curl -b` / windows_cloud 的 `page.route` stub 三者都绕过它，故新增本步骤作真目标腿。

**可观测行为**: 在能起真 `:5200` + 真 postgres + dashboard preview（vite proxy `/api`→`:5200`）的 **linux CI** 上：先真登录拿真 better-auth session cookie → `context.addCookies` 注入浏览器 → goto `/customers`（真 GET 带 cookie 出真数据）→ 点接管开关（**不 stub** `/api/crm/customers/manage`）→ 浏览器 fetch 带 `credentials:'include'` → 真后端真收 cookie → 真 200。断言「保存成功」可见、「登录已失效」count=0，并 psql 复核 whitelist 5 分钟内真写入该 contact（证明 cookie 真到达后端触发真写，前端确实带了凭据）。

**验证命令**（linux CI，真后端 leg；REAL_SESSION_COOKIE 由 smoke 真登录 bootstrap 产出，不写死）:
```bash
cd apps/dashboard
E2E_BASE_URL="http://localhost:5174" E2E_REAL_SESSION_COOKIE="$REAL_SESSION_COOKIE" \
  npx playwright test e2e/crm-cookie-seam.spec.ts --reporter=line || { echo "FAIL: cookie 接缝真浏览器 leg 未过"; exit 1; }
IN=$(PGPASSWORD="$PSQL_PASS" psql -h "$PSQL_HOST" -U "$PSQL_USER" -d "$PSQL_DB" -tAc \
  "SELECT (whitelist @> to_jsonb('$CONTACT'::text)) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='$CS_WECHAT_ID' AND updated_at > NOW() - interval '5 minutes'")
[ "$IN" = "t" ] || { echo "FAIL: 点开关后 whitelist 无真写入 = cookie 未真到达后端"; exit 1; }
```
**硬阈值**: 真浏览器无 stub 点开关 → 真 200「保存成功」、无「登录已失效」、whitelist 5 分钟内真写入。
**done 判定**: 本步骤 PASS 才算 cookie 接缝真 done；CI 暂无真后端 leg 而本步未跑 → 接缝清单 #1 标 `logic-done-pending`，禁止用 stub 绿 / 静态 grep 冒充 done。

---

## 接缝清单（接缝 vs 逻辑 — 真目标验证，未真验标 logic-done-pending）

| # | 接缝点（碰真实世界处） | 类型 | 真目标验证方式 | done 判定 |
|---|---|---|---|---|
| 1 | dashboard fetch 写接口的 **better-auth session cookie 传递**（未登录 bug，覆盖客户列表页 manage/status/POST/GET 全部 CRM fetch）| 接缝（真浏览器 cookie + 真 auth + 真后端）| **Step 9 / `[BEHAVIOR:E2E:COOKIE-SEAM]`**：linux CI 真 :5200 + 真 postgres + dashboard preview，真登录拿真 cookie 注入浏览器（`addCookies`），**无 page.route stub、无 VITE_SKIP_AUTH** 点接管开关 → 真后端真收 cookie 返 200、见「保存成功」不见「登录已失效」+ psql 复核 whitelist 真写入。**windows_cloud stub Playwright 不算此接缝的验证**（它只验 UI 渲染） | `crm-cookie-seam.spec.ts` 真后端 leg PASS 才 done；该 leg 未跑（含 windows_cloud stub 绿 / curl -b / 静态 grep）= `logic-done-pending`，禁止冒充 done |
| 2 | **租户隔离**读/写 SQL WHERE tenant_id=req.tenantId | 逻辑（SQL，环境无关）| smoke.sh 真 psql 两租户造数 + vitest 断言 SQL 文本带 tenant 绑定参数 | CI 绿 = done |
| 3 | **白名单 gate** should_reply | 逻辑（纯函数）| pytest 真跑 cs_config_gate | CI 绿 = done |
| 4 | whitelist / status **DB 真写入** | 逻辑（SQL upsert）| smoke.sh 真 psql 带 5 分钟时间窗读回 | CI 绿 = done |

> 禁止写死环境假设值：API_BASE/PG* 从 env 取（默认 :5200 / cecelia），cs_wechat_id 从 smoke 真造的 service_agents 行推导，不写死。

---

## E2E 验收

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest 跑 `${SPRINT_DIR}/e2e-verify.ps1` → build dashboard + Vite preview:5174 + Playwright `apps/dashboard/e2e/crm-customer-list.spec.ts`）

> 两层：
> **模式 A（evaluator/CI 逐项跑，真后端 API-level）** = 上方各 Step 的 curl :5200 + psql zenithjoy 命令 + pytest gate + vitest 租户隔离回归，打包进
> `.github/workflows/scripts/smoke/line04-crm-customer-list-smoke.sh`（真 API+psql，造两租户验隔离 + 登录态 401/200 + whitelist 写 + status 持久化）。
> **此 smoke 还负责 cookie 接缝真 leg（Step 9）**：起 dashboard preview（vite proxy /api→:5200）→ 真登录 bootstrap 拿真 better-auth session cookie 导出 `REAL_SESSION_COOKIE` → `npx playwright test e2e/crm-cookie-seam.spec.ts`（无 stub）→ psql 复核 whitelist 真写入。
> **模式 B（final-e2e，windows_cloud UI-level）** = Playwright 真浏览器走客户列表页 Golden Path（模板 ①，stub + VITE_SKIP_AUTH，只验 UI），由 evaluator 派 e2e-windows.yml 执行；**cookie 接缝不靠它验**（见模板 ② + Step 9）。

### Playwright spec 模板 ①（`apps/dashboard/e2e/crm-customer-list.spec.ts`，windows_cloud 干净 VM，API 用 page.route stub + VITE_SKIP_AUTH，**只验 UI 渲染/交互/文案，不验 cookie 接缝**）

```typescript
import { test, expect } from '@playwright/test';
import * as path from 'path';
const SHOTS = path.join('screenshots');

const ROWS = [
  { name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1', last_contact_at: '2026-06-24T08:00:00.000Z', managed: false },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A2', last_contact_at: '2026-06-23T08:00:00.000Z', managed: true },
];

test('客户列表 Golden Path — 列表/接管开关/状态下拉', async ({ page }) => {
  // 登录态 stub（true session 由真后端版 smoke 覆盖；UI 层验交互）
  await page.route('**/api/wechat/cs/my-role', (r) => r.fulfill({ json: { role: 'admin', can_config: true } }));
  await page.route('**/api/crm/customers', (r) => r.fulfill({ json: { customers: ROWS, total: ROWS.length } }));

  await page.goto('/customers');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png') });

  // 1. 列表 ≥1 行，含姓名/状态下拉/接管开关
  await expect(page.getByTestId('crm-customer-row')).toHaveCount(2);
  await expect(page.getByTestId('crm-customer-row').first()).toContainText('张三');
  await expect(page.getByTestId('crm-status-select').first()).toBeVisible();
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeVisible();

  // 2. 勾接管 → 见「保存成功」、不见「登录已失效」（接缝 1）
  await page.route('**/api/crm/customers/manage', (r) =>
    r.fulfill({ json: { success: true, managed: true, message: '保存成功' } }));
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByText('保存成功')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('登录已失效')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, '02-action.png') });

  // 3. 改状态 A3 → 刷新仍 A3
  let lastStatus = 'A1';
  await page.route('**/api/crm/customers/status', (r) => { lastStatus = 'A3'; return r.fulfill({ json: { success: true, status: 'A3' } }); });
  await page.route('**/api/crm/customers', (r) =>
    r.fulfill({ json: { customers: [{ ...ROWS[0], status: lastStatus }, ROWS[1]], total: 2 } }));
  await page.getByTestId('crm-status-select').first().selectOption('A3');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-status-select').first()).toHaveValue('A3');
  await page.screenshot({ path: path.join(SHOTS, '03-result.png') });
});
```

evaluator 验收后执行：
```bash
mkdir -p "${SPRINT_DIR}/screenshots/" && cp screenshots/*.png "${SPRINT_DIR}/screenshots/" 2>/dev/null || true
```

### Playwright spec 模板 ②（`apps/dashboard/e2e/crm-cookie-seam.spec.ts`，**linux CI 真后端 leg — cookie 接缝真目标验证**）

> 与模板 ① 的根本区别：**无任何 `page.route` stub、无 `VITE_SKIP_AUTH`**；真后端 `:5200`（vite proxy）+ 真 better-auth session cookie 注入浏览器 context。点接管开关时浏览器 fetch 必须带 `credentials:'include'` 把 cookie 发给真后端，否则真后端 401 → 断言失败。这才真验「未登录」bug 的接缝。run by `line04-crm-customer-list-smoke.sh`（已起真后端 + 真登录拿 cookie）。

```typescript
import { test, expect } from '@playwright/test';

// 真 cookie 由 smoke 真登录 bootstrap 产出，形如 "better-auth.session_token=<token>"（name=value）
const RAW = process.env.E2E_REAL_SESSION_COOKIE || '';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';

test('cookie 接缝 — 真浏览器在真后端上点接管开关，真发 session cookie', async ({ browser }) => {
  test.skip(!RAW, 'E2E_REAL_SESSION_COOKIE 未注入：真后端 leg 未具备，cookie 接缝 logic-done-pending');
  const [name, ...rest] = RAW.split('=');
  const value = rest.join('=');
  const context = await browser.newContext(); // 不用 VITE_SKIP_AUTH，不 stub
  await context.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();

  // 真 GET（带 cookie 经 vite proxy 打真 :5200）
  await page.goto(`${BASE}/customers`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-customer-row').first()).toBeVisible({ timeout: 15000 });

  // 点接管开关 —— 不 stub /api/crm/customers/manage，浏览器 fetch 必须带 credentials 把 cookie 发给真后端
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByText('保存成功')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('登录已失效')).toHaveCount(0);

  // 交叉复核：浏览器 context 内 GET 真后端，managed 已真反映（cookie 真到后端 + 真写）
  const resp = await page.request.get(`${BASE}/api/crm/customers`);
  expect(resp.status()).toBe(200);
  await context.close();
});
```

### windows_cloud 用户路径 1:1 映射检查（已 cat `.github/workflows/e2e-windows.yml`）

workflow 现状：`workflow_dispatch`(task_id/sprint_dir/pr_branch) → checkout → setup-node@20 → ffmpeg → `pwsh & "$sprintDir/e2e-verify.ps1"`（exit code 透传）。
用户真实路径 → workflow step 映射：

| 用户操作 | e2e-verify.ps1 step | 状态 |
|---|---|---|
| 打开客户列表页 | build dashboard + vite preview:5174 + Playwright goto /customers + assert rows | ✅ |
| 勾接管开关 → 保存成功 | Playwright click toggle + assert「保存成功」可见 | ✅ |
| 改状态下拉 → 刷新仍在 | Playwright selectOption + reload + toHaveValue | ✅ |
| 接管真写 whitelist（DB）| `[CI_GAP: windows_cloud Playwright 用 stub 不碰真 DB]` → 真 DB 写入由模式 A smoke.sh（linux 真 psql）+ Step 9 cookie 接缝 leg（真浏览器点开关真写 whitelist）双重验 | ✅（分层覆盖）|
| 租户隔离 | `[CI_GAP]` → 模式 A smoke.sh 真后端造两租户验隔离 + 403 CROSS_TENANT | ✅（分层覆盖）|
| 登录 cookie 接缝（未登录 bug）| `[CI_GAP: windows_cloud stub + VITE_SKIP_AUTH 不验 cookie 接缝]` → **真目标验证 = Step 9 `crm-cookie-seam.spec.ts`（linux CI 真后端 + 真 cookie 注入浏览器，无 stub）**；smoke.sh 的 curl -b 仅验后端 401/200 逻辑，不验前端 credentials | ✅（真接缝由 Step 9 验；未跑则 logic-done-pending）|

> e2e-windows.yml 已含 setup-node（无新增 CI_GAP 需 generator 补 workflow）；真后端断言不在此 workflow，归 smoke CI（linux）。
> secrets：`E2E_SUPER_ADMIN_EMAIL` / `E2E_SUPER_ADMIN_PASSWORD`（已在 e2e-windows.yml env 注入）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 客户列表读+租户闸 | `sprints/06242057-line04-crm-customer-list/tests/crm-customers.test.ts` | 名册聚合 / 租户 scope / managed 由 whitelist | → import 不存在的 buildCustomerRoster → N failures |
| 白名单 gate（既有） | `services/agent/wechat-rpa/cs_config_gate.py`（pytest 复用） | should_reply 命中/未命中 | 既有绿（回归保护）|
