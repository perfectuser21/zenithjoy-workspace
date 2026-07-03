# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 Sprint 实现纯进程内 IPC 状态机，无 HTTP 端点。IPC 消息协议（供 BEHAVIOR 引用）：

**Broker IPC 消息协议**（wechat-rpa.ts 转发，listen_chat.py 发起）

| 方向 | 消息类型 | 响应字段 |
|---|---|---|
| listen_chat → Broker | `desktop_lease_acquire` | `{granted:boolean, lease_id?:string, expires_at?:number, retry_after_ms?:number}` |
| listen_chat → Broker | `desktop_lease_renew` | `{ok:boolean, reason?:string}` |
| listen_chat → Broker | `desktop_lease_release` | `{ok:boolean}` |

Brain log 写入（watchdog 触发时）：`POST /api/agent/events` → `zenithjoy.agent_events`，字段 `module='desktop_lease'`，`message='desktop_lease_watchdog_triggered'`，`kind='log'`，`level='warn'`，`context.tenant_id=<tenant_id>`（**非空**，租户隔离 invariant）

**E2E 测试专用 HTTP 端点**（Generator 必须实现，仅用于 E2E watchdog 触发）：

| 端点 | 方法 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| `/api/agent/desktop-lease-broker/e2e-watchdog-probe` | POST | `{"ttl_ms": 2000}` | `{"ok":true, "lease_id":"<uuid>"}` | 内部 acquire 一个短 TTL probe lease，不 renew，让看门狗 ≤7s 内自然触发；禁止在生产主流程中调用 |

> **`[AI_ADDED]`** — 原因：消除 Reviewer 指出的"Scenario 3 触发命令是注释占位符"，评估侧需要真实 HTTP curl，不允许注释代替触发动作。

---

## 已知约束（来自回归测试）

- `services/agent/src/__tests__/module-manager.test.ts` → forwardMessage 在模块未激活时不抛异常
- `services/agent/src/__tests__/module-manager.test.ts` → preflight 未通过时触发 onPreflightFail 回调，且不激活
- `services/agent/wechat-rpa/tests/test_delivery_readback_poll.py` → test_always_empty_is_not_delivered（readback poll 不合格不判成功）
- `services/agent/wechat-rpa/tests/test_tray_scan_fix.py` → tray 扫描修复回归
- `services/agent/src/__tests__/preflight-line04-exe-first.test.ts` → line04 preflight exe 优先检查

---

## 接缝清单（Seam List）

> 以下接缝必须在 xian-rog 真机验证后才能标 done；未真验只能标 `logic-done-pending`。

| 接缝 | 真实世界碰撞点 | 真目标验证方式 |
|---|---|---|
| **接缝 1** | listen_chat.py → IPC → wechat-rpa.ts → DesktopLeaseBroker acquire/release | xian-rog 上 `python listen_chat.py --dryrun --inject-message '{"sender":"客户A","wechat_id":"wxid_A","content":"你好"}'`，stderr 必须含 `[desktop_lease] acquire granted` + `[desktop_lease] release` |
| **接缝 2** | DesktopLeaseBroker watchdog → POST /api/agent/events → zenithjoy.agent_events | xian-rog 上有 Brain 在线时，acquire 后不 renew，等 ≤15s，`psql` 查 `zenithjoy.agent_events WHERE module='desktop_lease' AND message='desktop_lease_watchdog_triggered' AND created_at > NOW() - interval '3 minutes'`，count ≥ 1 |

---

## Golden Path

listen_chat.py 窗口切换前申请租约 → Broker 状态机独占管理 → 操作完成归还 / 崩溃时看门狗兜底

---

### Step 1: listen_chat 发 acquire，Broker 返回 granted:true

**来源**: `[FROM_PRD]` — PRD Golden Path #1-2：「租约空闲 → {granted:true, lease_id, expires_at}」

**可观测行为**: Broker 接收到 `desktop_lease_acquire`（priority=50, ttl_ms=10000, client_id="line04/listen_chat"）时，若无持有方，立即返回 `{granted:true, lease_id:<uuid>, expires_at:<now+10000ms>}`，并将 lease 状态置为 HELD。

**验证命令**:
```bash
# Broker 单元测试（vitest，纯逻辑断言）
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*acquire.*granted|✗|FAIL" | head -20
# 期望：出现 "✓ acquire 空闲状态返回 granted:true" 行，无 ✗ 或 FAIL
```

**硬阈值**: `granted === true`，`lease_id` 为非空字符串，`expires_at > Date.now()`，响应时间 ≤200ms（本地进程内，无网络）

---

### Step 1.5: 高优先级抢占——priority=10 到来 → Broker 发 yield → ≤2200ms 强制授予

**来源**: `[FROM_PRD]` — PRD Golden Path #2：「高优先级抢占 → 向持有方发 yield，等待≤2s 后强制授予」

**可观测行为**:
- priority=50（listen_chat）正在持有时，priority=10（紧急操作）发 acquire
- Broker 立即通过 `onYield` 回调通知持有方（priority=50）让位
- 等待最多 2000ms（`yieldWaitMs`）：
  - **持有方在 2000ms 内 release** → Broker 立即授予 priority=10
  - **2000ms 超时持有方未 release** → Broker 强制清除 lease，授予 priority=10
- priority=10 最终收到 `{granted:true, lease_id:..., expires_at:...}`
- priority=50 的持有方收到 yield 通知后应停止操作（listen_chat 行为约束，不在本 Sprint 断言，仅确保 Broker 侧 onYield 被调用）

**验证命令**:
```bash
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*高优先级抢占|✓.*preemption|✗|FAIL" | head -20
# 期望：出现 "✓ 高优先级抢占（priority=10 抢占 priority=50）→ onYield 回调 + 2000ms 内强制授予" 行，无 ✗ 或 FAIL
```

**硬阈值**:
- `onYield` 回调被调用（入参含 `clientId: 'line04/listen_chat'`）
- priority=10 acquire 响应时间：超时分支 **2000ms ≤ elapsed ≤ 2200ms**（fake timers 推进 2100ms 后 resolve）
- priority=10 `granted === true`，`lease_id` 非空

**可执行时间断言**:
```bash
# 在 vitest 内用 fake timers 推进 2100ms，断言 resolve 时 vi.getFakeTimerCount() 推进了 ≥2000ms
# （见 tests/desktop-lease-broker.test.ts preemption 测试段）
```

---

### Step 2: 持有期间每 5s 发 renew，TTL 重置为 10000ms

**来源**: `[FROM_PRD]` — PRD Golden Path #3：「持有期间每 5s 发 renew，TTL 重置为 10000ms」

**可观测行为**: 持有方发 `desktop_lease_renew(lease_id=<持有的 id>)`，Broker 返回 `{ok:true}`，`expires_at` 重置为 `now() + 10000ms`（不得超期释放）。非持有方发 renew 返回 `{ok:false, reason:"not_owner"}`。

**验证命令**:
```bash
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*renew|✓.*not_owner|✗|FAIL" | head -20
# 期望：出现 "✓ renew 续期返回 ok:true" + "✓ 非持有方 renew 返回 not_owner" 行
```

**硬阈值**: `ok === true`（持有方），`{ok:false, reason:"not_owner"}`（非持有方）

---

### Step 3: 操作完成发 release，租约立即清除

**来源**: `[FROM_PRD]` — PRD Golden Path #4：「操作完成发 release，租约立即清除」；边界情况：「重复 release → 幂等，忽略」

**可观测行为**: `desktop_lease_release(lease_id)` → Broker 清除 lease 状态，返回 `{ok:true}`。重复 release 同样返回 `{ok:true}`（幂等）。release 后其他等待方可立即获取。

**验证命令**:
```bash
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*release|✓.*幂等|✗|FAIL" | head -20
# 期望：出现 "✓ release 清除租约" + "✓ 重复 release 幂等" 行
```

**硬阈值**: 首次 release `{ok:true}`，重复 release 也 `{ok:true}`，release 后 Broker 内部状态 `currentLease === null`

---

### Step 4: 崩溃/TTL 超期——看门狗 ≤15s 内自动释放并写 Brain log

**来源**: `[FROM_PRD]` — PRD Golden Path #5 出口：「TTL 看门狗 10s 未收到 renew → 自动释放，写 Brain log `desktop_lease_watchdog_triggered`」；PRD 边界情况：「未 release 退出/crash → TTL 看门狗兜底（≤15s 释放）」

**可观测行为**: 持有方 acquire 成功后不再发 renew。Broker 内看门狗每 5s 轮询，发现 `expires_at < now()` 时：① 清除 lease；② 调用 Brain log API 写 `desktop_lease_watchdog_triggered`。从最后一次 renew（或 acquire）算起，≤15s 内完成自动释放。

**验证命令（逻辑断言，vitest）**:
```bash
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*watchdog|✗|FAIL" | head -20
# 期望：出现 "✓ TTL 超期后看门狗自动释放 lease" 行
```

**验证命令（接缝断言，xian-rog 真机 — Brain 在线时）**:
```bash
# 接缝 2 验证：先调 e2e-watchdog-probe 触发（ttl_ms=2000），再等 ≤10s，最后 psql 带时间窗口+tenant_id 断言
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# Step A: 真实触发（不是注释，不是 sleep 占位）
PROBE_RESP=$(curl -sf -X POST "$BRAIN_URL/api/agent/desktop-lease-broker/e2e-watchdog-probe" \
  -H "Content-Type: application/json" \
  -d '{"ttl_ms":2000}')
echo "$PROBE_RESP" | jq -e '.ok == true' || { echo "FAIL: probe 未返回 ok:true resp=$PROBE_RESP"; exit 1; }
echo "watchdog probe 已触发，等待 ≤10s..."
sleep 10

# Step B: 断言 Brain log（时间窗口 + tenant_id 非空）
COUNT=$(PGPASSWORD="$PGPASSWORD" psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
  -d "${DB_NAME:-cecelia}" -t -c \
  "SELECT count(*) FROM zenithjoy.agent_events \
   WHERE module='desktop_lease' \
   AND message='desktop_lease_watchdog_triggered' \
   AND context->>'tenant_id' IS NOT NULL \
   AND created_at > NOW() - interval '3 minutes'" | tr -d ' ')
[ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: Brain log 无 watchdog_triggered（含 tenant_id，time window 3min）count=${COUNT:-0}"; exit 1; }
echo "OK watchdog brain log count=$COUNT"
```

**硬阈值**: 看门狗触发时间 ≤15s（probe ttl_ms=2000 + watchdog interval 5s ≤ 7s），Brain log `count ≥ 1`（3 分钟时间窗口内），log 中 `context.tenant_id` 非空（租户隔离 invariant）

---

### Step 5: listen_chat dryrun 注入消息——IPC 集成 acquire + release 日志可见

**来源**: `[FROM_PRD]` — PRD E2E 验收 Step 2：「python listen_chat.py --dryrun --inject-message ... stderr 含 [desktop_lease] acquire granted + [desktop_lease] release」

**可观测行为**: listen_chat.py 在 `--dryrun --inject-message` 模式下，在消息处理前调用 acquire（经 IPC → wechat-rpa.ts → Broker），处理后调用 release。`acquire granted` 和 `release` 两行日志必须出现在 stderr，且不得出现 `acquire failed`。

**验证命令（接缝 1 — xian-rog 执行）**:
```bash
# 需要 Broker 进程已运行（agent core 已启动）
STDERR_OUT=$(python listen_chat.py --dryrun \
  --inject-message '{"sender":"客户A","wechat_id":"wxid_testA","content":"你好"}' \
  2>&1 1>/dev/null)
echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire granted" || { echo "FAIL: 缺 acquire granted 日志"; exit 1; }
echo "$STDERR_OUT" | grep -q "\[desktop_lease\] release" || { echo "FAIL: 缺 release 日志"; exit 1; }
echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire failed" && { echo "FAIL: 出现 acquire failed — 违反 [防假成功] invariant"; exit 1; } || true
echo "OK IPC acquire/release 日志验证通过"
```

**硬阈值**: `acquire granted` 出现，`release` 出现，`acquire failed` 不出现

---

### Step 6: 低优先级 acquire（冲突时 granted:false，listen_chat 不崩溃）

**来源**: `[FROM_PRD]` — PRD 边界情况：「acquire 超时仍未得租约 → 返回 {granted:false}，listen_chat 跳过本轮，不崩溃」；PRD 假设：「优先级数字越小越高，0 保留给人工操作」；`[AI_ADDED]` — 防止 acquire 失败时 listen_chat 假装成功（对应 Invariant `[防假成功]`）

**可观测行为**: 已有 priority=0（人工操作）持有租约时，listen_chat 以 priority=50 发 acquire → Broker 返回 `{granted:false, retry_after_ms:<ms>}`。listen_chat 收到 `granted:false` 后跳过本轮消息处理，stdout 出现 `ok:false` 且不含发送记录，进程正常退出（不崩溃）。

**验证命令（逻辑断言，vitest）**:
```bash
cd /workspace/services/agent && npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose 2>&1 | grep -E "✓.*低优先级|✓.*granted.*false|✗|FAIL" | head -20
# 期望：出现 "✓ 低优先级 acquire 被高优先级持有方拒绝返回 granted:false" 行
```

**硬阈值**: `granted === false`，`retry_after_ms > 0`，Broker 原持有方 lease 未被清除

---

## Risks（风险与 Mitigation）

| # | 风险 | 影响 | Mitigation（合同要求） |
|---|---|---|---|
| R1 | **e2e-watchdog-probe 端点未实现**：Generator 未在 wechat-rpa.ts 注册此 HTTP 路由，Scenario 3 curl 直接 404 → evaluator FAIL | E2E Step 4 完全不可验证 | DoD `[ARTIFACT]` 明确要求此端点存在且返回 `{ok:true}`；Generator 必须实现，缺失则 ARTIFACT FAIL |
| R2 | **agent core 未启动时 Scenario 2 IPC 不可达**：xian-rog runner 启动 E2E 脚本时 Broker 进程尚未拉起，listen_chat.py dryrun IPC 连不上 → 超时假绿或异常退出 | 接缝 1 断言被环境问题遮蔽，不是代码问题 | Scenario 2 脚本前置 `curl -sf $BRAIN_URL/api/brain/health` 健康检查；失败则 `echo "FAIL: agent core 未就绪"; exit 1`（不静默跳过） |
| R3 | **`zenithjoy.agent_events` 表 `context` 字段兼容性**：若 Generator 写 `context.tenant_id` 时用 JSON 字符串而非 JSONB，`context->>'tenant_id'` 返回 NULL → Scenario 3 psql 断言 count=0 | 看门狗功能正确但 DB 写法不合格 | 合同明确要求：`context` 字段类型为 JSONB，Generator 写入必须用 `context = $1::jsonb`；BEHAVIOR B7 包含 `context->>'tenant_id' IS NOT NULL` 断言，Generator 必须确保非空 |

---

## E2E 验收（final-e2e — target_environment: windows_wechat，xian-rog self-hosted runner）

**journey_type**: autonomous
**target_environment**: windows_wechat

> 合同 E2E 在 xian-rog self-hosted runner（标签 `wechat-capable`，微信 4.1.8.107 已安装）执行。
> evaluator 调 `gh workflow run e2e-wechat-rpa.yml` 触发。所有接缝断言必须在此机器上真实验证后才能标 done。

<!-- GOLDEN_SMOKE_ABILITY_SLUG: desktop-lease-broker -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_wechat -->

### Scenario 1: broker-unit-tests
<!-- GOLDEN_SMOKE_SCENARIO: broker-unit-tests -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 在 xian-rog 上运行 DesktopLeaseBroker 单元测试（纯逻辑断言，无真机依赖）
cd /workspace/services/agent
npx vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts \
  --reporter=verbose 2>&1 | tee /tmp/broker-unit.log
grep -E "✗|FAIL|0 passed" /tmp/broker-unit.log && { echo "FAIL: 单元测试有失败项"; exit 1; }
grep -E "passed" /tmp/broker-unit.log || { echo "FAIL: 无通过项"; exit 1; }
echo "✅ Scenario 1 broker-unit-tests 通过"
```

### Scenario 2: dryrun-acquire-release
<!-- GOLDEN_SMOKE_SCENARIO: dryrun-acquire-release -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 接缝 1：listen_chat.py dryrun 注入消息，验证 acquire/release 日志（需 agent core 已启动）
# 在 xian-rog 执行，AGENT_DIR 由 xian-rog 环境提供
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
AGENT_DIR="${AGENT_DIR:-$LOCALAPPDATA\\zenithjoy-agent}"
PYTHON_EXE="$AGENT_DIR/python-embedded/python.exe"
LISTEN_CHAT="$AGENT_DIR/wechat-rpa/listen_chat.py"

# 前置：agent core 健康检查（对应 Risk R2，IPC 不可达时快速 FAIL 而非超时假绿）
curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.ok == true' \
  || { echo "FAIL: agent core 未就绪，IPC Broker 不可达（$BRAIN_URL）"; exit 1; }

STDERR_OUT=$("$PYTHON_EXE" "$LISTEN_CHAT" --dryrun \
  --inject-message '{"sender":"E2E测试客户","wechat_id":"wxid_e2e_test","content":"自动测试消息"}' \
  2>&1 1>/dev/null) || true

echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire granted" \
  || { echo "FAIL: 缺 [desktop_lease] acquire granted 日志"; exit 1; }
echo "$STDERR_OUT" | grep -q "\[desktop_lease\] release" \
  || { echo "FAIL: 缺 [desktop_lease] release 日志"; exit 1; }
echo "$STDERR_OUT" | grep -q "\[desktop_lease\] acquire failed" \
  && { echo "FAIL: 出现 acquire failed — 违反 [防假成功] invariant"; exit 1; } || true
echo "✅ Scenario 2 dryrun-acquire-release 通过"
```

### Scenario 3: watchdog-brain-log
<!-- GOLDEN_SMOKE_SCENARIO: watchdog-brain-log -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 120000 -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

```bash
#!/bin/bash
set -e
# 接缝 2：看门狗 Brain log（带时间窗口 + tenant_id 断言，防历史数据造假）
# 前提：Brain API 在 xian-rog 上可达（$BRAIN_URL），agent core 已启动 Broker

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# Step 1: 前置健康检查（对应 Risk R2）
curl -sf "$BRAIN_URL/api/brain/health" | jq -e '.ok == true' \
  || { echo "FAIL: Brain API 不可达 $BRAIN_URL"; exit 1; }

# Step 2: 真实触发 watchdog probe（ttl_ms=2000，Broker 不 renew，看门狗 ≤7s 内触发）
PROBE_RESP=$(curl -sf -X POST "$BRAIN_URL/api/agent/desktop-lease-broker/e2e-watchdog-probe" \
  -H "Content-Type: application/json" \
  -d '{"ttl_ms":2000}')
echo "$PROBE_RESP" | jq -e '.ok == true' \
  || { echo "FAIL: watchdog probe 未返回 ok:true resp=$PROBE_RESP"; exit 1; }
echo "watchdog probe 触发成功，等待 ≤10s 看门狗轮询..."
sleep 10

# Step 3: 断言 Brain log（时间窗口 3min + tenant_id 非空，对应 Risk R3）
COUNT=$(PGPASSWORD="$PGPASSWORD" psql -h "${DB_HOST:-localhost}" -U "${DB_USER:-cecelia}" \
  -d "${DB_NAME:-cecelia}" -t -c \
  "SELECT count(*) FROM zenithjoy.agent_events \
   WHERE module='desktop_lease' \
   AND message='desktop_lease_watchdog_triggered' \
   AND context->>'tenant_id' IS NOT NULL \
   AND created_at > NOW() - interval '3 minutes'" 2>/dev/null | tr -d ' ')

[ "${COUNT:-0}" -ge 1 ] \
  || { echo "FAIL: Brain log 无 watchdog_triggered（tenant_id 非空，time window 3min）count=${COUNT:-0}"; exit 1; }
echo "✅ Scenario 3 watchdog-brain-log 通过（count=$COUNT）"
```

---

### 完整 E2E 验收脚本（e2e-verify.ps1，xian-rog 执行）

```powershell
# final-e2e 验证脚本 — DesktopLeaseBroker（xian-rog 自托管 wechat-capable runner）
# 前提：xian-rog 已安装微信 4.1.8.107，agent core 已启动（含 DesktopLeaseBroker 单例）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 0. 脚本启动时间戳（防造假：本轮产物/日志写入必须在此之后）
$ScriptStart = Get-Date
Write-Host "▶ E2E 开始: $ScriptStart"

$RepoRoot   = Resolve-Path "$PSScriptRoot\..\.."
$AgentDir   = if ($env:AGENT_DIR) { $env:AGENT_DIR } else { "$env:LOCALAPPDATA\zenithjoy-agent" }
$PythonExe  = "$AgentDir\python-embedded\python.exe"
$ListenChat = "$AgentDir\wechat-rpa\listen_chat.py"
$BrainUrl   = if ($env:BRAIN_URL) { $env:BRAIN_URL } else { "http://localhost:5221" }

# 1. 版本确认（禁止 MOCK_*）
Write-Host "▶ Step 1: 确认 listen_chat 版本（禁止注入假版本）..."
$verOut = & $PythonExe $ListenChat --dryrun-print-version 2>&1
if ($LASTEXITCODE -ne 0) { throw "FAIL: --dryrun-print-version exit=$LASTEXITCODE" }
Write-Host "listen_chat version info: $verOut"

# 2. vitest Broker 单元测试（逻辑断言，当场跑）
Write-Host "▶ Step 2: vitest DesktopLeaseBroker 单元测试..."
$vitestProc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c npx.cmd vitest run ../../sprints/0703-line04-desktop-lease-broker/tests/desktop-lease-broker.test.ts --reporter=verbose" `
  -WorkingDirectory "$RepoRoot\services\agent" `
  -Wait -PassThru -NoNewWindow
if ($vitestProc.ExitCode -ne 0) { throw "FAIL: Broker 单元测试失败 exit=$($vitestProc.ExitCode)" }
Write-Host "✅ Step 2 Broker 单元测试全绿"

# 3. dryrun 注入消息 — 接缝 1 验证
Write-Host "▶ Step 3: listen_chat dryrun IPC acquire/release 日志验证..."
$dryrunOutput = & $PythonExe $ListenChat --dryrun `
  --inject-message '{"sender":"E2E测试客户","wechat_id":"wxid_e2e_test","content":"自动测试消息"}' `
  2>&1
$stderrLines = ($dryrunOutput | Out-String)

if ($stderrLines -notmatch "\[desktop_lease\] acquire granted") {
  throw "FAIL: stderr 缺 '[desktop_lease] acquire granted'"
}
if ($stderrLines -notmatch "\[desktop_lease\] release") {
  throw "FAIL: stderr 缺 '[desktop_lease] release'"
}
if ($stderrLines -match "\[desktop_lease\] acquire failed") {
  throw "FAIL: stderr 出现 'acquire failed' — 违反 [防假成功] invariant"
}
Write-Host "✅ Step 3 dryrun IPC 集成验证通过"

# 4. 看门狗 Brain log — 接缝 2 验证（TTL 超期后自动释放写 log）
Write-Host "▶ Step 4: 触发 watchdog probe 并验证 Brain log..."

# Step 4a: 真实触发 watchdog probe（对应 Risks R1 — 端点必须存在）
$probeBody = '{"ttl_ms":2000}'
$probeResp = Invoke-RestMethod -Uri "$BrainUrl/api/agent/desktop-lease-broker/e2e-watchdog-probe" `
  -Method POST -ContentType "application/json" -Body $probeBody -TimeoutSec 10
if (-not $probeResp.ok) { throw "FAIL: watchdog probe 返回 ok=false resp=$($probeResp | ConvertTo-Json)" }
Write-Host "watchdog probe 已触发 lease_id=$($probeResp.lease_id)，等待 ≤10s 看门狗触发..."
Start-Sleep -Seconds 10

# 查 Brain log（psql 带时间窗口）
$pgEnv = @{
  PGPASSWORD = $env:PGPASSWORD
  PGHOST     = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
  PGUSER     = if ($env:DB_USER) { $env:DB_USER } else { "cecelia" }
  PGDATABASE = if ($env:DB_NAME) { $env:DB_NAME } else { "cecelia" }
}
$query = "SELECT count(*) FROM zenithjoy.agent_events WHERE module='desktop_lease' AND message='desktop_lease_watchdog_triggered' AND context->>'tenant_id' IS NOT NULL AND created_at > NOW() - interval '3 minutes'"
$countStr = (psql -t -c $query 2>/dev/null).Trim()

if ([int]$countStr -lt 1) {
  throw "FAIL: Brain log 无 watchdog_triggered（time window 3min）count=$countStr"
}
Write-Host "✅ Step 4 看门狗 Brain log 验证通过（count=$countStr）"

Write-Host ""
Write-Host "✅ DesktopLeaseBroker E2E 全部通过（耗时 $((Get-Date) - $ScriptStart)）"
exit 0
```

**PASS 标准**: 脚本 exit 0 + 4 个 Step 全部通过
**FAIL 标准**: 任意 Step throw / exit≠0 / `acquire failed` 出现 / Brain log count=0（3min 时间窗）
**GHA workflow**: `.github/workflows/e2e-wechat-rpa.yml`（`workflow_dispatch` + self-hosted `wechat-capable`）
