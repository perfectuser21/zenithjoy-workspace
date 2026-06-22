# Sprint Contract Draft (Round 1) — Line04 每客服独立配置 + 客户机按身份拉配置

**journey_type**: user_facing
**target_environment**: windows_cloud
**对应 Issue**: defe1a42（全局单行配置导致人设串台）
**决策**: 04c34b86（每客服配置按微信号 key 物理分行，写一行不影响其他行）

---

## 已知约束（来自回归测试）

- [apps/api/src/services/wechat/__tests__/cs-config-store.test.ts] → getPersona/getBusinessKB：DB 命中返回 DB 值；无行/抛错/解析失败 → 回落兜底 loadPersona/loadBusinessKB（**新表读取须保留同款容错纪律：读失败回落，绝不抛断主链路**）
- [cs-config-store.test.ts] → savePersona/saveBusinessKB：upsert SQL 含 `ON CONFLICT`；DB 失败时 console.warn 不抛
- [p4-wechat-cs-config/wechat-config.integration.test.ts] → PUT 落库后 GET 往返一致；非法 body → 400 `INVALID_BODY`（**新端点错误响应须沿用 `{error,message,issues}` 格式**）
- [06220821 cs-auto-agent-config.test.ts] → 默认关：未配置时 `auto_agent_enabled` 读回 false；`daily_limit` 默认 0（不限）；保存即生效 upsert 读回一致（**新表默认值须沿用：auto_agent_enabled=false / business_hours 06:00–24:00 / key_contact_wechat='' / daily_limit=0**）

---

## Response Schema（推导来源: PRD 字面 + api_registry 推导[registry 本地不可达，回落现有 wechat-config.ts 约定] + `[NEW_PATTERN]`）

> registry 端点不可达，按 PRD 字面 + 现有 `apps/api/src/routes/wechat-config.ts` 既有约定推导（PUT 返回 `{success:true,...}`、错误返回 `{error,message,issues}`、GET 直接返回配置对象）。新增字段标 `[NEW_PATTERN]`。

### 通用对象：`CSConfig`（每客服那一行）
```json
{
  "wechat_id": "<string>",
  "persona": { "self_name": "<string>", "address_style": "<string>", "tone": "<string>", "sentence_style": "<string>", "use_emoji": "<string>", "banned_phrases": ["<string>"], "few_shot": [{"customer":"<string>","me":"<string>"}] },
  "auto_agent_enabled": false,
  "business_hours_start": "06:00",
  "business_hours_end": "24:00",
  "key_contact_wechat": "",
  "whitelist": ["<string>"],
  "daily_limit": 0,
  "updated_at": "<ISO8601>"
}
```
- `wechat_id` (string, 必填): 该客服绑定微信号 = 每客服配置主 key（PRD「微信号作为每客服配置主 key，全局唯一」）。来源 `[FROM_PRD]`
- `persona` (object, 必填): 该客服人设。结构字面复用现有 `PersonaSchema`（self_name/address_style/tone/sentence_style/use_emoji/banned_phrases/few_shot）。来源 现有 wechat-config.ts
- `auto_agent_enabled` (boolean, 必填): 该客服真发总开关。**默认 false（dryrun）**。来源 `[FROM_PRD]` + 现有 AutoAgentConfig
- `business_hours_start` / `business_hours_end` (string, 必填): 营业时间。默认 `06:00` / `24:00`。来源 现有 AutoAgentConfig
- `key_contact_wechat` (string, 必填): 关键人微信。默认 `''`。来源 现有 AutoAgentConfig
- `whitelist` (string[], 必填): 该客服名单内客户白名单。默认 `[]`。来源 `[FROM_PRD]` `[NEW_PATTERN]`
- `daily_limit` (number, 必填): 每日单号自动回上限。默认 0=不限。来源 现有 AutoAgentConfig
- `updated_at` (string, 必填): 末次更新时间。来源 `[NEW_PATTERN]`

### Endpoint A: `PUT /api/wechat/cs/config/:wechatId`（管理员，superAdminGuard）
**作用**: 按微信号 key upsert「该客服那一行」，**只写该行，不覆盖其他客服行**。
**Success (HTTP 200)**:
```json
{"success": true, "config": <CSConfig>}
```
- `success` (boolean, 必填): 字面 `true`。来源 现有 PUT 约定
- `config` (CSConfig, 必填): 落库后的该客服整行（读回一致）。来源 `[NEW_PATTERN]`
**禁用字段名**: `persona_global`、`cs_config`（全局单行残留语义，新端点严禁出现）
**Error (HTTP 400)**:
```json
{"error": "INVALID_BODY", "message": "<string>", "issues": [{"path":"<string>","message":"<string>"}]}
```

### Endpoint B: `GET /api/wechat/cs/config/:wechatId`（管理员）
**作用**: 读「该客服那一行」供前台编辑。
**Success (HTTP 200)**: `<CSConfig>`（直接返回配置对象，含 `wechat_id`）
**Error (HTTP 404)**:
```json
{"error": "NOT_FOUND", "message": "<string>"}
```

### Endpoint C: `GET /api/wechat/cs/agent-config?wechat_id=<X>`（客户机，internalAuth）
**作用**: 客户机按自己登录微信号身份拉「自己那份」配置。注册号→返回该号那份；未注册/登录号无对应行→拒绝且**不返回任意一份配置**，并写诊断异常。
**Success (HTTP 200)**: `<CSConfig>`（仅该 `wechat_id` 那份）
**Error (HTTP 403)**（未注册/身份不符）:
```json
{"error": "UNREGISTERED_WECHAT", "message": "<string>"}
```
- 响应体**严禁含 `persona` 字段**（不得泄漏任意配置）

### Endpoint D: `GET /api/wechat/cs/diagnostics`（管理员，诊断页数据源）`[NEW_PATTERN]`
**作用**: 中台诊断页读最近身份校验异常。
**Success (HTTP 200)**:
```json
{"alerts": [{"wechat_id":"<string>","reason":"<string>","created_at":"<ISO8601>"}]}
```

---

## Golden Path

[管理员前台分别配每个客服] → [客户机按自己微信号上报校验] → [校验通过拉自己那份] → [真发跟随该客服开关] → [名单内私聊真发+读回] → [第二台客户机各拉各配置互不串]

### Step 1: 管理员在「某客服设置区」按微信号写该客服那一行
**来源**: `[FROM_PRD]` — Golden Path 第 1 步「按微信号 key 写中台『该客服那一行』→ 仅该客服生效，不覆盖其他客服」+ 范围内「前台客户管理页『每客服设置区』编辑该客服那一行」

**可观测行为**: 管理员给客服 A（微信号 wxid_csa）设人设=「萌萌」、给客服 B（wxid_csb）设人设=「天下第一」，中台落成两条按微信号 key 物理分行的独立记录，互不覆盖（复现并钉死 Issue defe1a42 串台 bug）。

**验证命令**:
```bash
API=${API_BASE:-http://localhost:3000}
PA='{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}}'
PB='{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]}}'
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -d "$PA" | jq -e '.success == true and .config.persona.self_name == "萌萌"'
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' -d "$PB" | jq -e '.success == true and .config.persona.self_name == "天下第一"'
# 互不覆盖：写 B 不污染 A
curl -sf "$API/api/wechat/cs/config/wxid_csa" | jq -e '.persona.self_name == "萌萌"'
curl -sf "$API/api/wechat/cs/config/wxid_csb" | jq -e '.persona.self_name == "天下第一"'
```
**硬阈值 + 可执行验证**: 两行物理独立，5 分钟内写入
```bash
DB=${DB:-postgresql://localhost/cecelia}
C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('wxid_csa','wxid_csb') AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" = "2" ] || { echo "FAIL: 期望两独立行 实际 $C"; exit 1; }
```

---

### Step 2: 客户机上报登录微信号 → 中台身份校验（号不符报红 + 诊断页标异常）
**来源**: `[FROM_PRD]` — Golden Path 第 2 步 +「客户机登录微信号 ≠ 管理员绑定微信号 → 开机自检报红 + 中台诊断页标异常 → 不按错配置跑」+「用未注册微信号拉配置 → 拒绝/报异常，不返回任意一份配置」

**可观测行为**: 客户机用已注册号拉配置→放行返回该号那份；用未注册/不符号拉→HTTP 403 拒绝、响应体不含任何 persona、中台写一条诊断异常（诊断页可见）。

**验证命令**:
```bash
API=${API_BASE:-http://localhost:3000}
# 注册号 → 放行（返回自己那份）
curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa" | jq -e '.persona.self_name == "萌萌"'
# 未注册号 → 拒绝且不泄漏配置
CODE=$(curl -s -o /tmp/unreg.json -w '%{http_code}' "$API/api/wechat/cs/agent-config?wechat_id=wxid_never_registered_zzz")
[ "$CODE" = "403" ] || { echo "FAIL: 未注册号未拒绝 code=$CODE"; exit 1; }
jq -e 'has("persona") | not' /tmp/unreg.json
# 诊断页可见该异常
curl -sf "$API/api/wechat/cs/diagnostics" | jq -e '[.alerts[] | select(.wechat_id == "wxid_never_registered_zzz")] | length >= 1'
```
**硬阈值 + 可执行验证**: 异常 5 分钟内入诊断
```bash
DB=${DB:-postgresql://localhost/cecelia}
C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_identity_alert WHERE wechat_id='wxid_never_registered_zzz' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" -ge 1 ] || { echo "FAIL: 诊断异常未入库"; exit 1; }
```

---

### Step 3: 校验通过 → 拉自己那份配置（人设/白名单/营业时间各取各）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步「向中台拉『自己那份』配置 → 用自己的人设/白名单/营业时间跑」

**可观测行为**: agent-config 返回的 `whitelist`/`business_hours_*`/`persona` 与该客服那一行一致，不是别人的。

**验证命令**:
```bash
API=${API_BASE:-http://localhost:3000}
# 给 A 配白名单后拉回一致
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' \
  -d '{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"whitelist":["客户甲","客户乙"]}' | jq -e '.success == true'
curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa" | jq -e '(.whitelist | index("客户甲")) != null and .business_hours_start == "06:00"'
```
**硬阈值 + 可执行验证**: 拉回的 whitelist 与落库一致
```bash
DB=${DB:-postgresql://localhost/cecelia}
psql "$DB" -t -c "SELECT whitelist FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | grep -q '客户甲' || { echo "FAIL: 白名单未落库"; exit 1; }
```

---

### Step 4: 真发 gate 跟随该客服 `auto_agent_enabled`（OFF=dryrun / ON=real / 拉失败=强制 dryrun）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步 + 范围内「真发 gate = 该客服 `auto_agent_enabled`（默认 dryrun；OFF=演练，ON=真发，拉失败=强制 dryrun）」+ 边界「拉配置失败 → 用上次缓存 + 强制 dryrun」。**不再靠装包写死 env**（替换现有 `REAL_PUBLISH`/`ZENITHJOY_AGENT_REAL_PUBLISH` env gate）。

**可观测行为**:
(a) 中台侧：开关 OFF 时 agent-config 返回 `auto_agent_enabled=false`；管理员打开后下一轮拉到 `true`；
(b) 客户机侧 gate 决策纯函数 `resolveSendMode(config, pullOk)`：`(enabled=true, pullOk=true)→'real'`；`(enabled=false, *)→'dryrun'`；`(enabled=true, pullOk=false 拉失败)→'dryrun'`（强制演练，绝不误真发）。

**验证命令**:
```bash
API=${API_BASE:-http://localhost:3000}
# (a) 默认 OFF
curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb" | jq -e '.auto_agent_enabled == false'
# 管理员开启 B
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' \
  -d '{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true}' | jq -e '.config.auto_agent_enabled == true'
curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb" | jq -e '.auto_agent_enabled == true'
# (b) 客户机 gate 决策纯函数（拉失败强制 dryrun，绝不误真发）
node -e 'const {resolveSendMode}=require("./services/agent/build-modules/line04/cs-config-gate.js");
const ok = resolveSendMode({auto_agent_enabled:true},true)==="real"
  && resolveSendMode({auto_agent_enabled:false},true)==="dryrun"
  && resolveSendMode({auto_agent_enabled:true},false)==="dryrun";
if(!ok){console.error("FAIL: gate 决策错误");process.exit(1)}'
```
**硬阈值 + 可执行验证**: 默认值必须 dryrun（开关默认 false）
```bash
DB=${DB:-postgresql://localhost/cecelia}
psql "$DB" -t -c "SELECT auto_agent_enabled FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_csa'" | grep -qiE '^\s*f' || { echo "FAIL: 新客服默认非 dryrun"; exit 1; }
```

---

### Step 5: 名单内客户私聊该客服 → 按自己那份人设/白名单判定 → 真发回复 → 读回验证真送达
**来源**: `[FROM_PRD]` — Golden Path 第 5 步。**接缝**：真机微信真收真回 + 读回验证真送达需 xian-rog windows_wechat 真机（见下「接缝清单」#2）。本 sprint 在 windows_cloud 验「白名单判定 + gate 决策」逻辑层；真机真送达标 `logic-done-pending`。

**可观测行为（逻辑层，本 sprint 验）**: 给定某 wechat_id 的配置与一条来自白名单内/外客户的消息，判定函数正确决定「回 / 不回」，且回的模式跟随该客服 gate。

**验证命令**:
```bash
node -e 'const {shouldReply}=require("./services/agent/build-modules/line04/cs-config-gate.js");
const cfg={auto_agent_enabled:true, whitelist:["客户甲"]};
const ok = shouldReply(cfg,"客户甲")===true && shouldReply(cfg,"陌生人路人")===false;
if(!ok){console.error("FAIL: 白名单判定错误");process.exit(1)}'
```
**硬阈值（接缝，logic-done-pending）**: 真机微信屏幕全程不闪 + 读回该消息真出现在对话窗 —— 真目标=xian-rog，本 sprint 不在 windows_cloud 验证，标 `logic-done-pending`。

---

### Step 6: 第二台客户机（另一客服微信）同时跑 → 各拉各配置 → 人设/名单/开关互不串
**来源**: `[FROM_PRD]` — Golden Path 第 6 步。钉死多租户隔离 invariant（决策 04c34b86）。

**可观测行为**: 同一时刻两次身份拉取（wxid_csa / wxid_csb）返回完全独立的 persona/whitelist/auto_agent_enabled，无任何串台。

**验证命令**:
```bash
API=${API_BASE:-http://localhost:3000}
A=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa")
B=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb")
echo "$A" | jq -e '.persona.self_name == "萌萌" and .auto_agent_enabled == false'
echo "$B" | jq -e '.persona.self_name == "天下第一" and .auto_agent_enabled == true'
# 交叉断言：A 的人设绝不等于 B 的人设（串台即 FAIL）
[ "$(echo "$A" | jq -r '.persona.self_name')" != "$(echo "$B" | jq -r '.persona.self_name')" ] || { echo "FAIL: 人设串台"; exit 1; }
```
**硬阈值**: 两份配置 persona.self_name 不相等且各自 = 各自落库值。

---

### Step 7: 存量全局 `wechat_cs_config` migration 迁为 legacy 现客服那一行（向后兼容）
**来源**: `[FROM_PRD]` — 范围内「存量全局 `wechat_cs_config` migration 迁为 xian-rog 现客服那一行（向后兼容）」。
> **接缝注**: 迁移目标 `wechat_id` 在 CI 用占位 `wxid_legacy_global`（PRD 要求迁为 xian-rog 现客服真号——真号绑定是部署期 ops 步骤，见「接缝清单」#3，标 `logic-done-pending`；CI 只验迁移逻辑把存量人设/开关原样搬过去）。

**可观测行为**: 跑迁移后，存量全局 `wechat_cs_config`(key=persona/auto_agent) 的值被原样搬进 `wechat_cs_account_config` 的 `wxid_legacy_global` 那一行，旧单客服人设不丢。迁移幂等（重复跑不重复插）。

**验证命令**:
```bash
DB=${DB:-postgresql://localhost/cecelia}
# 种入存量全局 persona
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_config(key,value) VALUES ('persona','{\"self_name\":\"存量小助手\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
# 跑迁移（幂等）
( cd apps/api && npm run migrate ) >/dev/null 2>&1
# 验证存量被迁为 legacy 那一行
psql "$DB" -t -c "SELECT persona->>'self_name' FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_legacy_global'" | grep -q '存量小助手' || { echo "FAIL: 存量人设未迁移"; exit 1; }
```
**硬阈值**: 迁移后 legacy 行存在且 persona.self_name = 存量值；二次跑迁移行数不变（幂等）。

---

## 接缝清单（v9.3 — 碰真实世界的点，CI 绿 ≠ done）

> 本 sprint verifiable scope = 中台每客服配置隔离 + 客户机按身份拉配置逻辑 + 真发 gate 决策逻辑 + 迁移逻辑（**全部逻辑断言**，windows_cloud CI 绿 = 真 done）。下列接缝触真实世界，windows_cloud（GHA，无真机微信）照不到 → 标 `logic-done-pending`，真目标验证为后续 windows_wechat（xian-rog）步骤，**不得在本 sprint 标 done**。

| # | 接缝 | 碰真实世界在哪 | 真目标验证方式 | 本 sprint 状态 |
|---|---|---|---|---|
| 1 | 客户机读真实登录微信号 | listen_chat 经 UIA 从真机微信读自己登录号 | xian-rog windows_wechat 真机读真号上报，与绑定号比对 | `logic-done-pending`（本 sprint 验「给定 wechat_id 拉对配置」逻辑） |
| 2 | 真发回复到真机微信 + 读回验证真送达（Step 5） | wechat_rpa 经 UIA 真发 + 屏幕读回 | xian-rog 真机：名单内私聊真收真回，屏幕全程不闪，读回消息真出现 | `logic-done-pending`（本 sprint 验白名单判定 + gate 决策逻辑） |
| 3 | 迁移目标绑定 xian-rog 现客服真号 | 部署期把 `wxid_legacy_global` 那行 `wechat_id` 改为 xian-rog 真实登录号 | xian-rog 上 agent-config 用真号拉到迁移过来的存量配置 | `logic-done-pending`（CI 用占位号验迁移逻辑） |

**禁止写死环境假设值**: 迁移占位 `wxid_legacy_global` 是显式占位 marker（非真号假设），真号由 ops 部署期从真机推导绑定；客户机登录号一律从真机 UIA 读取，**严禁 `MOCK_WECHAT_*` 注入假号**。

---

## E2E 验收（最终 final-e2e 跑 — target_environment = windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud（GitHub Actions windows-latest，干净 sandbox；postgres service + node + curl + psql）

> 选 windows_cloud 依据：ZenithJoy 产品（CLAUDE.md E2E 死规则 ZenithJoy UI/Dashboard → windows_cloud）+ PRD 显式钉。本 sprint verifiable scope（中台配置隔离 + 按身份拉 + gate 决策 + 迁移）全是逻辑断言，可在 GHA 干净 VM 上 curl 中台 API + psql 验 DB 完成；真机微信部分是接缝（见接缝清单），不在本环境验。
> 含两段：① Playwright 验前台「每客服设置区」编辑 UI（user_facing 步骤 1 的用户可见验证）；② curl + psql 验隔离/身份/gate/迁移 invariant（PRD 显式「curl 中台 API + psql 验 DB」）。

写入 `sprints/06222337-line04-per-cs-config/e2e-verify.ps1`：

```powershell
# final-e2e — Line04 每客服独立配置（windows_cloud / windows-latest）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptStart = Get-Date
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path "$scriptDir\..\.."
$ApiBase   = "http://localhost:3000"
$VitePort  = 5174
$DbUrl     = $env:DATABASE_URL  # postgres service，GHA workflow 注入

# 0. 依赖 + 迁移 + 启动中台
Push-Location $repoRoot
& cmd.exe /c "npm.cmd ci --prefer-offline" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: npm ci" }
& cmd.exe /c "npx.cmd playwright install chromium --with-deps" | Out-Null

# 0b. 种入存量全局配置（验迁移向后兼容）后跑迁移
& psql $DbUrl -c "INSERT INTO zenithjoy.wechat_cs_config(key,value) VALUES ('persona','{\""self_name\"":\""存量小助手\"",\""address_style\"":\""\"",\""tone\"":\""\"",\""sentence_style\"":\""\"",\""use_emoji\"":\""\"",\""banned_phrases\"":[],\""few_shot\"":[]}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
Push-Location "$repoRoot\apps\api"
& cmd.exe /c "npm.cmd run build" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: api build" }
& cmd.exe /c "npm.cmd run migrate" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: migrate" }
$api = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm.cmd start" -WorkingDirectory "$repoRoot\apps\api" -PassThru -NoNewWindow
Pop-Location
# 等中台就绪
$ok=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep 1; try{ if((Invoke-RestMethod "$ApiBase/health").status){$ok=$true;break} }catch{} }
if(-not $ok){ throw "FAIL: 中台 30s 未就绪" }

# 1. 迁移向后兼容：存量人设迁为 legacy 行
$legacy = (& psql $DbUrl -t -c "SELECT persona->>'self_name' FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_legacy_global'").Trim()
if ($legacy -ne "存量小助手") { throw "FAIL: 迁移未保留存量人设 got=$legacy" }

# 2. Playwright 验前台「每客服设置区」编辑 UI（步骤 1 user_facing）
Push-Location "$repoRoot\apps\dashboard"
& cmd.exe /c "npm.cmd run build" ; if ($LASTEXITCODE -ne 0) { throw "FAIL: dashboard build" }
$vite = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd vite preview --port $VitePort --host" -WorkingDirectory "$repoRoot\apps\dashboard" -PassThru -NoNewWindow
$vok=$false; for($i=0;$i -lt 30;$i++){ Start-Sleep 1; if((Test-NetConnection localhost -Port $VitePort -WarningAction SilentlyContinue).TcpTestSucceeded){$vok=$true;break} }
if(-not $vok){ throw "FAIL: Vite 30s 未就绪" }
$e2e = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx.cmd playwright test e2e/per-cs-config.spec.ts --reporter=list" -WorkingDirectory "$repoRoot\apps\dashboard" -Wait -PassThru -NoNewWindow -Environment @{ BASE_URL="http://localhost:$VitePort"; API_BASE=$ApiBase }
Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
if ($e2e.ExitCode -ne 0) { throw "FAIL: Playwright 每客服设置区 E2E exit=$($e2e.ExitCode)" }
Pop-Location

# 3. curl + psql 验隔离/身份/gate（PRD 显式 curl 中台 + psql 验 DB）
$pa = '{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}}'
$pb = '{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true}'
$ra = Invoke-RestMethod -Method Put "$ApiBase/api/wechat/cs/config/wxid_csa" -ContentType 'application/json' -Body $pa
$rb = Invoke-RestMethod -Method Put "$ApiBase/api/wechat/cs/config/wxid_csb" -ContentType 'application/json' -Body $pb
if (-not $ra.success -or -not $rb.success) { throw "FAIL: PUT 未成功" }
$ga = Invoke-RestMethod "$ApiBase/api/wechat/cs/agent-config?wechat_id=wxid_csa"
$gb = Invoke-RestMethod "$ApiBase/api/wechat/cs/agent-config?wechat_id=wxid_csb"
if ($ga.persona.self_name -ne "萌萌")     { throw "FAIL: A 串台 got=$($ga.persona.self_name)" }
if ($gb.persona.self_name -ne "天下第一") { throw "FAIL: B 串台 got=$($gb.persona.self_name)" }
if ($ga.auto_agent_enabled -ne $false)    { throw "FAIL: A 默认应 dryrun" }
if ($gb.auto_agent_enabled -ne $true)     { throw "FAIL: B 开关未生效" }
# 未注册号拒绝 + 不泄漏
$code = (Invoke-WebRequest "$ApiBase/api/wechat/cs/agent-config?wechat_id=wxid_never_zzz" -SkipHttpErrorCheck).StatusCode
if ($code -ne 403) { throw "FAIL: 未注册号未拒绝 code=$code" }
# 诊断异常入库（时间窗防伪）
$alerts = (& psql $DbUrl -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_identity_alert WHERE wechat_id='wxid_never_zzz' AND created_at > NOW() - interval '5 minutes'").Trim()
if ([int]$alerts -lt 1) { throw "FAIL: 诊断异常未入库" }
# DB 两独立行（时间窗防伪）
$cnt = (& psql $DbUrl -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('wxid_csa','wxid_csb') AND updated_at > NOW() - interval '5 minutes'").Trim()
if ([int]$cnt -ne 2) { throw "FAIL: 期望两独立行 got=$cnt" }

# 4. 客户机 gate 决策纯函数（拉失败强制 dryrun）
$node = & node -e 'const {resolveSendMode}=require("./services/agent/build-modules/line04/cs-config-gate.js"); const ok=resolveSendMode({auto_agent_enabled:true},true)==="real"&&resolveSendMode({auto_agent_enabled:false},true)==="dryrun"&&resolveSendMode({auto_agent_enabled:true},false)==="dryrun"; process.exit(ok?0:1)'
if ($LASTEXITCODE -ne 0) { throw "FAIL: gate 决策错误" }

Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
Pop-Location
Write-Host "✅ windows_cloud E2E 全过：每客服配置物理隔离 + 按身份拉 + gate 决策 + 迁移向后兼容"
exit 0
```

**PASS 标准**: 脚本 exit 0（迁移保留存量 + Playwright 编辑 UI 过 + 两客服配置物理隔离不串 + 未注册拒绝且诊断入库 + gate 决策正确）
**FAIL 标准**: 任一 throw / Playwright 失败 / 串台 / 未注册号未拒绝 / 默认非 dryrun
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest` + postgres service）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 每客服配置存取层 | `tests/cs-account-config-store.test.ts` | 按 wechat_id 隔离 upsert/read；写一行不影响另一行；未注册返回 null | → import 不存在模块 FAIL |
| 客户机 gate 决策 | `tests/cs-config-gate.test.ts` | resolveSendMode（OFF/ON/拉失败）+ shouldReply（白名单内外） | → import 不存在模块 FAIL |
