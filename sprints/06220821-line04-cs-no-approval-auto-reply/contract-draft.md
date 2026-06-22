# Sprint Contract Draft (Round 1) — 微信客服 无审批自动回复闭环（Line 04）

**journey_type**: agent_remote
**target_environment**: windows_wechat（xian-rog self-hosted runner，微信 4.1.8，标签 `wechat-capable`）
**journey_id**: bfeed805-deed-46c3-8624-87f0028101d4 / step_id: L04-无审批自动回复闭环

> **两类断言分家（本 sprint 核心）**：逻辑断言（模式裁决 / 营业时间窗 / 播报裁决 / 配置端点 / migration）环境无关，CI vitest+smoke 绿 = 真 done；接缝断言（真机微信真收真回、不抢焦点、ToAPI 真出 reply）必须在 xian-rog 真机验，未真验只能标 `logic-done-pending`，**不得标 done**。接缝清单见末尾。

---

## Response Schema（推导来源：api_registry 不可达 → 复用同 router 既有端点 `apps/api/src/routes/wechat-config.ts` 约定）

### Endpoint: GET /api/wechat/auto-agent
**Success (HTTP 200)**:
```json
{"auto_agent_enabled": false, "business_hours_start": "06:00", "business_hours_end": "24:00", "key_contact_wechat": ""}
```
- `auto_agent_enabled` (boolean, 必填): 自动代理总开关。来源——FROM_PRD（ASSUMPTION `auto_agent_enabled` 默认 false）
- `business_hours_start` (string `HH:MM`, 必填): 营业开始。来源——FROM_PRD（默认 `"06:00"`）
- `business_hours_end` (string `HH:MM`, 必填): 营业结束，`"24:00"` 合法（午夜）。来源——FROM_PRD（默认 `"24:00"`）
- `key_contact_wechat` (string, 必填，可空串): 关键人微信（播报对象）。来源——FROM_PRD（ASSUMPTION `key_contact_wechat`）

### Endpoint: PUT /api/wechat/auto-agent
**Success (HTTP 200)**:
```json
{"success": true}
```
- `success` (boolean): 字面 `true`。来源——api_registry 推导（同 router `PUT /persona`、`PUT /business-kb` 均返 `{success:true}`）

**Error (HTTP 400)**:
```json
{"error": "INVALID_BODY", "message": "字段校验失败: <fields>", "issues": [{"path": "...", "message": "..."}]}
```
- 来源——api_registry 推导（`wechat-config.ts` `invalidBody()` 字面格式）

**禁用字段名**（来自同 router 现有端点的同义替换词，contract 正向断言严禁出现）: `enabled`、`businessHoursStart`、`businessHoursEnd`、`keyContact`、`ok`、`data`、`result`

---

## 已知约束（来自回归测试 / 既有代码 — 防同坑重现）

- [`apps/api/src/services/wechat-draft.ts`] → `generateChatDraft({mode:'auto'})` 已实现：名单内 mode='auto' 跳白名单、AI 成功才带 `reply`、AI 失败 `reply=undefined`（listener 跳过不发占位 `FAIL_PLACEHOLDER`）。**本 sprint 复用，不重写**。
- [`apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`] → J1-J4：auto 成功带 reply / review 不带 reply / auto AI 失败 reply undefined / 名单外 not_in_whitelist。**回归须保持绿**。
- [`apps/api/src/routes/wechat-config.ts`] → 配置端点统一挂 `wechatConfigRouter`（mount `/api/wechat`），**不挂 superAdminGuard**（dashboard better-auth 场景），PUT 返 `{success:true}`，错误 `{error,message,issues}`。新端点照此。
- [`apps/api/src/services/wechat/cs-config-store.ts`] → 配置走 `zenithjoy.wechat_cs_config`（key-value JSONB）upsert；读失败 console.warn 回落兜底、写失败不抛。新 4 键照此容错。
- [`services/agent/wechat-rpa/send_chat.py`] → `REAL_PUBLISH=0` 默认输出 mock `{"ok":true,"dryRun":true}`；真发走纯 UIA（不抢前台）；**只在已存在会话发，定位 target**。上线/下线播报复用此脚本对关键人发（关键人需已有会话）。
- ⚠️ **migration 漂移既存事实（不是本 sprint 引入）**：磁盘 `20260513_221814_create_wechat_publish_task.sql` 是旧 schema（`status`/`agent_id`/`content`/`approval_source IN (feishu_user,feishu_api)`）；而运行时代码（`wechat-draft.ts`/`wechat.ts`/`feishu-poll.ts`）用 `approval_status`(states: pending_review/approved/rejected/published/failed/rate_limited)/`content_draft`/`target_user`/`receipt_status`/`receipt_error`。回归测试 `apps/api/tests/ws1/db-schema.test.ts` 当前已 9 失败（断言旧 create 文件含新列，恒不成立）。**本 sprint 的 migration 以「运行时代码实际使用的列」为准（`approval_status` + `approval_source`），用 idempotent ALTER 放开约束**；db-schema.test.ts 已是 broken guard，不作为绿色基线依赖。

---

## Golden Path
管理员配置开关（保存→上线播报）→ 名单内自动回 + 名单外 pending_human → 回执回写 → 关闭开关（下线播报，回退监控态）

### Step 1: 管理员保存「关键人 + 营业时间 + 开启自动代理」→ 上线播报
**来源**: `[FROM_PRD]` — Golden Path 第 1 步 + 范围限定「自动代理开关 + 营业时间窗口 + 关键人配置 + 上线/下线播报」

**可观测行为**: PUT `/api/wechat/auto-agent` 落 `wechat_cs_config` 4 键并返 `{success:true}`；开关由 OFF→ON 触发对关键人发上线通知（`🟢 智能客服已上线`）。关键人未配置 → 跳过播报、记日志、不阻塞保存。

**验证命令**（逻辑层 — 路由 schema + 播报裁决）:
```bash
cd /workspace && npx vitest run apps/api/src/routes/__tests__/wechat-auto-agent.test.ts apps/api/src/services/wechat/__tests__/agent-toggle.test.ts --reporter=dot
# 期望：全 PASS（GET 返 4 字段 / PUT 合法 200 {success:true} / 非法 400 INVALID_BODY；OFF→ON=online、ON→OFF=offline、无关键人=skip）
```
**硬阈值**: vitest exit 0；OFF→ON `resolveToggleBroadcast(false,true,'x').action === 'online'`，无关键人 `.action === 'skip' && .reason === 'key_contact_not_configured'`
**接缝**（真机，logic-done-pending）: 关键人微信真收到「🟢 智能客服已上线」——见末尾接缝清单 S1

---

### Step 2: 名单内客户私聊 → 三态裁决取 auto → 1~5s 延迟 → 不抢焦点自动发 + 读回验证
**来源**: `[FROM_PRD]` — Golden Path 第 2 步 + NFR「拟人延迟 1~5 秒 / 营业时间 06:00–24:00 含跨午夜」

**可观测行为**: 校验【名单内 ✅ + 营业时间内 ✅ + 自动代理 ON ✅】→ `decideReplyMode` 返 `auto` → 复用 `generateChatDraft({mode:'auto'})` 出 `reply` → 随机等 `humanDelayMs()`∈[1000,5000]ms → send_chat 纯 UIA 不抢焦点发 + 读回验证 → 客户真收到。

**验证命令**（逻辑层 — 裁决树 + 营业时间窗 + 延迟 + 既有 auto reply 回归）:
```bash
cd /workspace && npx vitest run \
  apps/api/src/services/wechat/__tests__/auto-mode.test.ts \
  apps/api/src/services/wechat/__tests__/business-hours.test.ts \
  apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts --reporter=dot
# 期望：全 PASS（ON+名单内+营业内→auto；06:00–24:00 含 23:59 不含 00:00；跨午夜 22:00–02:00 含 23:00/01:00；delay∈[1000,5000]；auto 带 reply）
```
**硬阈值**: vitest exit 0；`decideReplyMode({enabled:true,inWhitelist:true,inBusinessHours:true})==='auto'`；`humanDelayMs()` 500 采样恒 ∈[1000,5000] 且 ≥2 个不同值
**接缝**（真机，logic-done-pending）: 名单内号发消息 → AI 1~5s 内自动回 → 真收到、窗口全程不抢焦点；ToAPI 真出 reply（非 mock）——见接缝清单 S2/S4

---

### Step 3: 名单外的人私聊 → 不生成不发 → 写 pending_human
**来源**: `[FROM_PRD]` — Golden Path 第 3 步 + 范围限定「名单外 `pending_human`」

**可观测行为**: 识别不在飞书客户名单 → `decideReplyMode` 返 `pending_human` → 不调 LLM、不发 → 写一条 `pending_human` 记录到 DB `wechat_publish_task`（`approval_status='pending_human'`，`approval_source` 不写/NULL）/ 飞书「互动记录」→ 管理员可见待接管。

**验证命令**（逻辑层 — 裁决 + migration 容纳新状态）:
```bash
cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/auto-mode.test.ts --reporter=dot
# 期望 PASS：decideReplyMode({enabled:true,inWhitelist:false,inBusinessHours:true})==='pending_human'
# migration 容纳 pending_human / auto_sent / send_failed + approval_source='system'（DB 往返见下方 E2E smoke 段，psql 时间窗防伪）
node -e "const fs=require('fs');const d='apps/api/db/migrations';const f=fs.readdirSync(d).find(x=>/auto.?reply|auto.?agent|approval_source/i.test(x));if(!f){console.error('FAIL: 缺 auto-reply migration');process.exit(1)};const s=fs.readFileSync(d+'/'+f,'utf8');for(const v of ['auto_sent','pending_human','send_failed','system']){if(!s.includes(v)){console.error('FAIL: migration 缺 '+v);process.exit(1)}};console.log('OK migration='+f)"
```
**硬阈值**: vitest exit 0；migration 文件含 `auto_sent`/`pending_human`/`send_failed`/`system` 四值；psql 往返（smoke）`approval_source='system'` + `approval_status IN (auto_sent,pending_human,send_failed)` 可写、非法值被 23514 拒
**接缝**（真机，logic-done-pending）: 名单外号真机发消息 → 不被自动回 → 飞书/DB 出现一条 `pending_human`——见接缝清单 S3

---

### Step 4: 发送完成 → 回执回写飞书「互动记录」/ DB
**来源**: `[FROM_PRD]` — Golden Path 第 4 步 + 边界「读回验证失败标 `send_failed`、记回执、不重发」+ NFR「回执（成功/失败+原因）回写飞书+DB」

**可观测行为**: 自动发成功 → `approval_status='auto_sent'`、`receipt_status='sent'`；读回验证失败 → `approval_status='send_failed'`、`receipt_status='failed'`、`receipt_error=<原因>`、**不重发**；AI 生成空/超时 → 不发占位、跳过、记日志（复用 `FAIL_PLACEHOLDER`）。

**验证命令**（逻辑层 — migration 含回执状态；smoke 三态 + 回执回写）:
```bash
cd /workspace && bash .github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh
# 期望 PASS：扩后 smoke 覆盖 auto / review(监控) / pending_human / out_of_hours 四路由 + 回执回写
```
**硬阈值**: smoke exit 0；`send_failed` 路径断言「不重发」（同 task_id 只一条 out 记录）
**接缝**（真机，logic-done-pending）: 真发成功/失败的 receipt 回写飞书+DB——见接缝清单（随 S2 一并真验）

---

### Step 5: 管理员关闭「开启自动代理」→ 下线播报 → 回退监控态
**来源**: `[FROM_PRD]` — Golden Path 第 5 步

**可观测行为**: 开关 ON→OFF → 对关键人发下线通知（`🔴 智能客服已下线，转人工接管`）→ 回退监控态（名单内消息照常生成草稿写飞书 `pending_review`，不自动发）。关键人未配置 → 跳过+记日志。

**验证命令**（逻辑层 — 播报裁决 + 监控态裁决）:
```bash
cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/agent-toggle.test.ts apps/api/src/services/wechat/__tests__/auto-mode.test.ts --reporter=dot
# 期望 PASS：resolveToggleBroadcast(true,false,'x').action==='offline' 且 message 含「下线」；decideReplyMode({enabled:false,...})==='review'
```
**硬阈值**: vitest exit 0；下线 message 含 `🔴` + `下线`；OFF → 裁决恒 `review`
**接缝**（真机，logic-done-pending）: 关闭 → 关键人微信真收到「🔴 …下线」——见接缝清单 S1

---

## 接缝清单（碰真实世界的点 — 必须 xian-rog 真机验，未验标 logic-done-pending）

| # | 接缝点（碰真实世界在哪）| 真目标验证方式（windows_wechat / xian-rog 真机）|
|---|---|---|
| S1 | 开关跳变 → 关键人**微信真收到**上线/下线通知（send_chat 纯 UIA 对真实会话发）| 打开自动代理 → 关键人微信屏幕真出现「🟢…上线」；关闭 → 真出现「🔴…下线」；全程窗口不抢焦点 |
| S2 | 名单内号发消息 → AI **1~5s 内自动回** → 客户**真收到** → **窗口不抢焦点**（pywinauto UIA SetValue+Invoke 真送达 + 读回验证）| 名单内真机号私聊 → 1~5s 内对方真收到回复 + 读回验证通过；操作期间前台焦点不被抢走 |
| S3 | 名单外号发消息 → **真不被自动回** + 飞书/DB 出现一条 `pending_human` | 名单外真机号私聊 → 无任何自动回复 + 查 DB/飞书有本轮 `pending_human` 记录（时间窗 5min） |
| S4 | **ToAPI（deepseek-v3.2）真出 reply**（非 mock，`TOAPI_API_KEY` 真实环境）| `REAL_PUBLISH=1` + 真 key 下 `generateChatDraft({mode:'auto'})` 真返回非空 reply（非 `FAIL_PLACEHOLDER`）|

> 上述 4 条在 GAN/CI 阶段只跑逻辑断言；S1-S4 由 evaluator 在 xian-rog 真机经 `e2e-verify.ps1` 验。**未真验过的功能在 contract-dod.md 标 `logic-done-pending`，不得标 done。**
> **禁止写死环境假设值**：关键人会话定位、读回阈值、UIA 控件路径必须真机校准或从环境推导，不许写死屏幕外坐标/假版本/假 env 值兜过（这些本质是接缝，必真验）。

---

## E2E 验收（final-e2e 由 evaluator 在 xian-rog 真机跑 — windows_wechat 模板）

写入 `sprints/06220821-line04-cs-no-approval-auto-reply/e2e-verify.ps1`：

```powershell
# final-e2e — 无审批自动回复闭环（xian-rog 真机，微信 4.1.8）
# 禁止 MOCK_WECHAT_VERSION=* / fakeChild EventEmitter；必须读真实微信、真发真收。
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0. 脚本启动时间（防造假：本轮 DB 记录/产出 LastWriteTime 必须晚于此）
$ScriptStart = Get-Date

$agentDir   = "$env:LOCALAPPDATA\zenithjoy-agent"
$pythonExe  = "$agentDir\python-embedded\python.exe"
$listenChat = "$agentDir\wechat-rpa\listen_chat.py"

# 1. 真实微信进程（不注入假版本）
$wechatProc = Get-Process -Name WeChat -ErrorAction SilentlyContinue
if (-not $wechatProc) { throw "FAIL: 微信未运行，xian-rog 预置条件未满足" }

# 2. S1 上线播报：打开自动代理 → 关键人真收到「🟢…上线」
$onRes = & $pythonExe $listenChat --e2e-toggle on  2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: 上线播报 exit=$LASTEXITCODE out=$onRes" }
if ("$onRes" -notmatch "上线") { throw "FAIL: 关键人未收到上线通知" }

# 3. S2/S4 名单内自动回：真机名单内号发消息 → AI 1~5s 真回 → 读回验证通过、不抢焦点
$autoRes = & $pythonExe $listenChat --e2e-auto-reply 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: 名单内自动回 exit=$LASTEXITCODE out=$autoRes" }
if ("$autoRes" -notmatch "delivered|readback_ok") { throw "FAIL: 名单内未真送达/读回失败" }

# 4. S3 名单外 pending_human：名单外号发消息 → 不自动回 + DB 出现本轮 pending_human
$outRes = & $pythonExe $listenChat --e2e-stranger 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: 名单外路径 exit=$LASTEXITCODE out=$outRes" }
if ("$outRes" -notmatch "pending_human") { throw "FAIL: 名单外未记 pending_human" }

# 5. S1 下线播报：关闭自动代理 → 关键人真收到「🔴…下线」
$offRes = & $pythonExe $listenChat --e2e-toggle off 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: 下线播报 exit=$LASTEXITCODE out=$offRes" }
if ("$offRes" -notmatch "下线") { throw "FAIL: 关键人未收到下线通知" }

# 6. 产物时间戳防造假：本轮 smoke 产出文件 LastWriteTime 晚于脚本启动
$outFile = "$agentDir\wechat-rpa\last-auto-reply-result.json"
if (Test-Path $outFile) {
  $w = (Get-Item $outFile).LastWriteTime
  if ($w -lt $ScriptStart.AddMinutes(-1)) { throw "FAIL: $outFile 早于脚本启动，疑似历史产物冒充" }
}

Write-Host "✅ windows_wechat 无审批自动回复闭环 E2E 验证通过"
exit 0
```

**PASS 标准**: exit 0 + 真实微信版本读取成功 + S1/S2/S3/S4 真目标断言通过
**FAIL 标准**: exit 1 OR 微信未运行 OR `MOCK_*` 注入（自动检测）OR 任一接缝断言失败
**GHA workflow**: `.github/workflows/e2e-wechat-rpa.yml`（`workflow_dispatch` + self-hosted `wechat-capable`）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 模式裁决 + 拟人延迟 | `apps/api/src/services/wechat/__tests__/auto-mode.test.ts` | 四态裁决 + delay∈[1000,5000] | Cannot find module '../auto-mode' → 4 FAIL |
| 营业时间窗（含跨午夜）| `apps/api/src/services/wechat/__tests__/business-hours.test.ts` | 06:00–24:00 / 22:00–02:00 边界 | Cannot find module '../business-hours' → FAIL |
| 开关跳变播报 | `apps/api/src/services/wechat/__tests__/agent-toggle.test.ts` | online/offline/none/skip | Cannot find module '../agent-toggle' → FAIL |
| 配置端点 Response Schema | `apps/api/src/routes/__tests__/wechat-auto-agent.test.ts` | GET 4 字段 / PUT 200 / 400 INVALID_BODY | store 缺 getAutoAgentConfig/saveAutoAgentConfig → FAIL |
| 三态路由 + 回执回写 | `.github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh`（扩） | auto/review/pending_human/out_of_hours | smoke 缺新分支 → FAIL |
