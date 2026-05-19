# Sprint Contract Draft (Round 2)

## Golden Path
[用户点发布] → [中台排队 publish_task + works.publish_status=queued] → [Agent 心跳领取] → [Agent task-ack 确认] → [works.publish_status=success]

---

### Step 1: 用户调用 POST /api/works/:id/publish

**可观测行为**: 中台找当前 tenant 最近活跃 agent，往 publish_tasks 插 pending 记录（result.payload.work_id），works.publish_status 设 queued，返回 `{"task_id":"<uuid>","status":"queued"}`

**验证命令**:
```bash
API=http://localhost:5200
EMAIL="s6-r1-$(date +%s)@test.dev"
curl -fsS -c /tmp/s6r1.cookies -X POST "$API/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Pass1234!\",\"name\":\"s6test\"}" > /dev/null
LK=$(curl -fsS -b /tmp/s6r1.cookies "$API/api/account/me" | jq -r '.license.license_key')
curl -fsS -X POST "$API/api/agent/heartbeat" \
  -H "x-license-key: $LK" -H 'content-type: application/json' \
  -d '{"hostname":"test-agent-s6"}' > /dev/null
WORK_ID=$(curl -fsS -b /tmp/s6r1.cookies -X POST "$API/api/works" \
  -H 'content-type: application/json' \
  -d '{"title":"s6 test work","content_type":"video","body":"body"}' | jq -r '.id')
RESP=$(curl -f -b /tmp/s6r1.cookies -X POST "$API/api/works/$WORK_ID/publish" \
  -H 'content-type: application/json')
echo "$RESP" | jq -e '.status == "queued"' || { echo "FAIL: status 不是 queued"; exit 1; }
echo "$RESP" | jq -e '.task_id | test("^[0-9a-f-]{36}$")' || { echo "FAIL: task_id 不是 uuid"; exit 1; }
echo "$RESP" | jq -e 'keys == ["status","task_id"]' || { echo "FAIL: keys 不匹配 PRD schema"; exit 1; }
echo "$RESP" | jq -e 'has("id") | not' || { echo "FAIL: 禁用字段 id 漏网"; exit 1; }
```

**硬阈值**: HTTP 200, `status == "queued"`, `task_id` 是 UUID, keys 精确等于 `["status","task_id"]`, 无禁用字段 `id/data/result/message/payload`

---

### Step 2: Agent 心跳拉取任务

**可观测行为**: Agent 下次心跳收到 queued_tasks 数组，含新 publish_task（task_id 匹配 Step 1 返回值）

**验证命令**:
```bash
# 接 Step 1 变量
TASK_ID=$(echo "$RESP" | jq -r '.task_id')
HB2=$(curl -f -X POST "$API/api/agent/heartbeat" \
  -H "x-license-key: $LK" -H 'content-type: application/json' \
  -d '{"hostname":"test-agent-s6"}')
echo "$HB2" | jq -e --arg t "$TASK_ID" '[.queued_tasks[].task_id] | contains([$t])' \
  || { echo "FAIL: heartbeat queued_tasks 未含 task_id=$TASK_ID"; exit 1; }
```

**硬阈值**: `queued_tasks[].task_id` 包含 Step 1 返回的 task_id

---

### Step 3: Agent 发送 task-ack 确认执行

**可观测行为**: `POST /api/agent/task-ack` 返回 `{"ok":true}`，publish_tasks.status 改 done，works.publish_status 改 success

**验证命令**:
```bash
# 接 Step 1 变量
ACK=$(curl -f -X POST "$API/api/agent/task-ack" \
  -H "x-license-key: $LK" -H 'content-type: application/json' \
  -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}")
echo "$ACK" | jq -e '.ok == true' || { echo "FAIL: ok 不是 true"; exit 1; }
echo "$ACK" | jq -e 'keys == ["ok"]' || { echo "FAIL: task-ack keys 不匹配"; exit 1; }
echo "$ACK" | jq -e 'has("success") | not' || { echo "FAIL: 禁用字段 success 漏网"; exit 1; }
```

**硬阈值**: HTTP 200, `ok == true`, keys 精确等于 `["ok"]`, 无禁用字段 `success/status/done`

---

### Step 4: 状态回写验证

**可观测行为**: `GET /api/works/:id` 返回 `publish_status:"success"`

**验证命令**:
```bash
WORK=$(curl -f -b /tmp/s6r1.cookies "$API/api/works/$WORK_ID")
echo "$WORK" | jq -e '.publish_status == "success"' \
  || { echo "FAIL: works.publish_status 不是 success"; exit 1; }
```

**硬阈值**: `publish_status == "success"`

---

### Error Paths

**422 NO_AGENT（无活跃 Agent）**:
```bash
EMAIL2="s6-noagent-$(date +%s)@test.dev"
curl -fsS -c /tmp/s6na.cookies -X POST "$API/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL2\",\"password\":\"Pass1234!\",\"name\":\"noagent\"}" > /dev/null
WORK_ID2=$(curl -fsS -b /tmp/s6na.cookies -X POST "$API/api/works" \
  -H 'content-type: application/json' \
  -d '{"title":"no-agent work","content_type":"video","body":"b"}' | jq -r '.id')
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/s6na.cookies \
  -X POST "$API/api/works/$WORK_ID2/publish")
[ "$HTTP_CODE" = "422" ] || { echo "FAIL: 无 agent 应返 422, got $HTTP_CODE"; exit 1; }
BODY=$(curl -s -b /tmp/s6na.cookies -X POST "$API/api/works/$WORK_ID2/publish")
echo "$BODY" | jq -e '.code == "NO_AGENT"' || { echo "FAIL: 缺 code=NO_AGENT"; exit 1; }
```

**404 work not found**:
```bash
HTTP404=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/s6r1.cookies \
  -X POST "$API/api/works/00000000-0000-0000-0000-000000000000/publish")
[ "$HTTP404" = "404" ] || { echo "FAIL: 不存在 work 应返 404, got $HTTP404"; exit 1; }
```

**403 task-ack cross-tenant forbidden（task 属于其他 tenant 的 agent）**:
```bash
# userA 注册 + 心跳 + 创建 work + publish → 得到 TASK_ID
EMAIL_A="s6-a-$(date +%s)@test.dev"
curl -fsS -c /tmp/s6a.cookies -X POST "$API/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"Pass1234!\",\"name\":\"userA\"}" > /dev/null
LK_A=$(curl -fsS -b /tmp/s6a.cookies "$API/api/account/me" | jq -r '.license.license_key')
curl -fsS -X POST "$API/api/agent/heartbeat" \
  -H "x-license-key: $LK_A" -H 'content-type: application/json' \
  -d '{"hostname":"agent-a"}' > /dev/null
WORK_A=$(curl -fsS -b /tmp/s6a.cookies -X POST "$API/api/works" \
  -H 'content-type: application/json' \
  -d '{"title":"cross-tenant work","content_type":"video","body":"b"}' | jq -r '.id')
TASK_A=$(curl -f -b /tmp/s6a.cookies -X POST "$API/api/works/$WORK_A/publish" \
  -H 'content-type: application/json' | jq -r '.task_id')

# userB 注册 + 心跳（不同 tenant）
EMAIL_B="s6-b-$(date +%s)@test.dev"
curl -fsS -c /tmp/s6b.cookies -X POST "$API/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_B\",\"password\":\"Pass1234!\",\"name\":\"userB\"}" > /dev/null
LK_B=$(curl -fsS -b /tmp/s6b.cookies "$API/api/account/me" | jq -r '.license.license_key')
curl -fsS -X POST "$API/api/agent/heartbeat" \
  -H "x-license-key: $LK_B" -H 'content-type: application/json' \
  -d '{"hostname":"agent-b"}' > /dev/null

# userB 尝试 ack userA 的 task → 必须返 403
HTTP403=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API/api/agent/task-ack" \
  -H "x-license-key: $LK_B" -H 'content-type: application/json' \
  -d "{\"task_id\":\"$TASK_A\",\"result\":\"x\"}")
[ "$HTTP403" = "403" ] || { echo "FAIL: 跨 tenant ack 应返 403, got $HTTP403"; exit 1; }
```

**publish_status=null（未发布 work GET 验证）**:
```bash
EMAIL_NULL="s6-null-$(date +%s)@test.dev"
curl -fsS -c /tmp/s6null.cookies -X POST "$API/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_NULL\",\"password\":\"Pass1234!\",\"name\":\"nulltest\"}" > /dev/null
WORK_NEW=$(curl -fsS -b /tmp/s6null.cookies -X POST "$API/api/works" \
  -H 'content-type: application/json' \
  -d '{"title":"unpublished","content_type":"video","body":"b"}' | jq -r '.id')
WORK_RESP=$(curl -f -b /tmp/s6null.cookies "$API/api/works/$WORK_NEW")
echo "$WORK_RESP" | jq -e '.publish_status == null' \
  || { echo "FAIL: 未发布 work publish_status 应为 null"; exit 1; }
```

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: windows_cloud

> 以下 PowerShell 脚本保存到 `sprints/step6-dispatch-chain/e2e-verify.ps1`，
> 由 `e2e-windows.yml` 在 GitHub Actions windows-latest runner 上执行，
> 模拟 Windows Agent 全程调用 staging API。

```powershell
#!/usr/bin/env pwsh
# e2e-verify.ps1 — Step 6 Dispatch Chain 全链路验证（Windows Agent 模拟）
# target_environment: windows_cloud | 由 .github/workflows/e2e-windows.yml 调用
param(
  [string]$ApiBase = $Env:ZENITHJOY_API_BASE
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ApiBase) {
  Write-Error "ZENITHJOY_API_BASE 未设置（GitHub Variable 或 -ApiBase 参数必须提供）"
  exit 1
}

$Ts = [System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$Email = "e2e-s6-${Ts}@zenithjoy.test"
$Password = "Pass1234!"
$ContentType = "application/json"

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body, [hashtable]$Headers = @{}, [hashtable]$Session = $null)
  $uri = "$ApiBase$Path"
  $params = @{ Method = $Method; Uri = $uri; ContentType = $ContentType; Headers = $Headers; UseBasicParsing = $true }
  if ($Body) { $params.Body = ($Body | ConvertTo-Json -Depth 5) }
  if ($Session) { $params.WebSession = $Session }
  return Invoke-RestMethod @params
}

# 1. 注册并取 license_key
Write-Host "Step 1: 注册测试用户 $Email"
$ws = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method POST -Uri "$ApiBase/api/auth/sign-up/email" `
  -ContentType $ContentType -SessionVariable 'ws' `
  -Body (@{email=$Email; password=$Password; name="e2e-s6"} | ConvertTo-Json) | Out-Null
$me = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/account/me" `
  -ContentType $ContentType -WebSession $ws
$LicenseKey = $me.license.license_key
if (-not $LicenseKey) { Write-Error "FAIL: license_key 未返回"; exit 1 }

# 2. 心跳注册 Agent（模拟 Windows Agent 启动）
Write-Host "Step 2: Agent 心跳 (Windows Agent 模拟)"
$hb1 = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/heartbeat" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{hostname="e2e-windows-agent-$Ts"; version="1.0.0"} | ConvertTo-Json)
if (-not $hb1.agent_id) { Write-Error "FAIL: heartbeat 未返回 agent_id"; exit 1 }
$AgentId = $hb1.agent_id
Write-Host "  agent_id=$AgentId"

# 3. 创建 work
Write-Host "Step 3: 创建测试 work"
$work = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/works" `
  -ContentType $ContentType -WebSession $ws `
  -Body (@{title="e2e-s6-test-$Ts"; content_type="video"; body="body"} | ConvertTo-Json)
$WorkId = $work.id
if (-not $WorkId) { Write-Error "FAIL: work 创建失败"; exit 1 }

# 4. 调用 POST /api/works/:id/publish
Write-Host "Step 4: POST /api/works/$WorkId/publish"
$pub = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/works/$WorkId/publish" `
  -ContentType $ContentType -WebSession $ws
if ($pub.status -ne "queued") { Write-Error "FAIL: status=$($pub.status), 期望 queued"; exit 1 }
$taskIdType = $pub.task_id.GetType().Name
if (-not ($pub.task_id -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) {
  Write-Error "FAIL: task_id 不是 UUID: $($pub.task_id)"; exit 1
}
$pubKeys = ($pub | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($pubKeys -ne "status,task_id") { Write-Error "FAIL: publish response keys=$pubKeys, 期望 status,task_id"; exit 1 }
$TaskId = $pub.task_id
Write-Host "  task_id=$TaskId ✅"

# 5. 验证 works.publish_status = queued
$workAfterPub = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/works/$WorkId" `
  -ContentType $ContentType -WebSession $ws
if ($workAfterPub.publish_status -ne "queued") {
  Write-Error "FAIL: works.publish_status=$($workAfterPub.publish_status), 期望 queued"; exit 1
}

# 6. 心跳二次拉取任务队列（模拟 Windows Agent 心跳）
Write-Host "Step 5: 心跳拉取 queued_tasks"
$hb2 = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/heartbeat" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{hostname="e2e-windows-agent-$Ts"} | ConvertTo-Json)
$queuedTaskIds = $hb2.queued_tasks | ForEach-Object { $_.task_id }
if ($TaskId -notin $queuedTaskIds) {
  Write-Error "FAIL: heartbeat queued_tasks 未含 task_id=$TaskId"; exit 1
}
Write-Host "  queued_tasks 含 task_id=$TaskId ✅"

# 7. task-ack 确认执行
Write-Host "Step 6: POST /api/agent/task-ack"
$ack = Invoke-RestMethod -Method POST -Uri "$ApiBase/api/agent/task-ack" `
  -ContentType $ContentType `
  -Headers @{"x-license-key"=$LicenseKey} `
  -Body (@{task_id=$TaskId; result="dryrun ok"} | ConvertTo-Json)
if ($ack.ok -ne $true) { Write-Error "FAIL: ack.ok=$($ack.ok), 期望 true"; exit 1 }
$ackKeys = ($ack | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name | Sort-Object) -join ","
if ($ackKeys -ne "ok") { Write-Error "FAIL: task-ack response keys=$ackKeys, 期望 ok"; exit 1 }
Write-Host "  ok=true ✅"

# 8. 验证最终状态 works.publish_status = success
Write-Host "Step 7: GET /api/works/$WorkId → publish_status=success"
$workFinal = Invoke-RestMethod -Method GET -Uri "$ApiBase/api/works/$WorkId" `
  -ContentType $ContentType -WebSession $ws
if ($workFinal.publish_status -ne "success") {
  Write-Error "FAIL: works.publish_status=$($workFinal.publish_status), 期望 success"; exit 1
}
Write-Host "  publish_status=success ✅"

Write-Host ""
Write-Host "✅ Step 6 Dispatch Chain E2E 全链路验证通过 (windows_cloud)"
exit 0
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 4

### Workstream 1: works.publish_status Migration

**范围**: 新建 Migration SQL，为 `zenithjoy.works` 加 `publish_status TEXT CHECK(IN('queued','success','failed'))` 列
**大小**: S(<100行), 1文件
**依赖**: 无

### Workstream 2: Service 层 — dispatchPublishTask + ackPublishTask

**范围**: `walking-skeleton.service.ts` 新增 `findActiveAgentByTenantId` / `dispatchPublishTask` / `ackPublishTask` 三个函数
**大小**: M(100-200行), 1文件
**依赖**: Workstream 1（需 publish_status 列存在）

### Workstream 3: 路由层 — POST works/:id/publish + POST agent/task-ack

**范围**: `works.ts` 加 publish endpoint；`walking-skeleton.ts` 加 task-ack endpoint
**大小**: M(100-200行), 2文件
**依赖**: Workstream 2

### Workstream 4: Smoke 扩展 + e2e-verify.ps1

**范围**: 扩展 `golden-path-1-smoke.sh` Step 6 覆盖完整 dispatch chain；新增 `e2e-verify.ps1`
**大小**: S(<100行), 2文件
**依赖**: Workstream 3

---

## Risks

### Risk 1: findActiveAgentByTenantId 活跃窗口定义模糊

**描述**: "最近活跃 agent" 未定义 heartbeat 有效期，若查询不加时间窗口，离线 agent 也会被选中，导致 dispatch 成功但 agent 永远不来 ack。

**缓解**:
- `findActiveAgentByTenantId` SQL 必须含 `last_heartbeat_at > NOW() - INTERVAL '10 minutes'`
- WS2 DoD 的 [BEHAVIOR] `test_no_agent_422` 验证超时 agent 不被选中（注册后不心跳则 422）

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!c.match(/last_heartbeat_at.*INTERVAL/))process.exit(1);console.log('OK')"
```

---

### Risk 2: dispatch DB 事务 cascade 失败补偿

**描述**: `dispatchPublishTask` 需同时 `INSERT publish_tasks` + `UPDATE works.publish_status`。若前者成功后者失败（DB 故障、约束违反），状态不一致：publish_tasks 有记录但 works 仍 null，heartbeat 返任务但 GET /works/:id 不反映 queued。

**缓解**:
- `dispatchPublishTask` 必须在单一 DB 事务内执行两步操作
- WS2 DoD 的 [BEHAVIOR] `test_dispatch_sets_queued` 已验证 works.publish_status = queued（间接验证事务完整性）
- 若实现不含 `BEGIN`/`COMMIT` 或 Prisma transaction，WS2 ARTIFACT `test_dispatch_inserts_task` 仍可能造假通过；需补 [BEHAVIOR] 验证 `publish_tasks` 和 `works` 状态同时一致

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/dispatch-migration.test.ts` | migration 文件存在 + SQL 内容 | 文件不存在 → 4 failures |
| WS2 | `tests/ws2/dispatch-service.test.ts` | dispatchPublishTask/ackPublishTask 导出 | 函数未定义 → 4 failures |
| WS3 | `tests/ws3/dispatch-routes.test.ts` | routes 文件含 publish/task-ack 处理 | 代码不含目标字符串 → 4 failures |
| WS4 | `tests/ws4/smoke-step6.test.ts` | smoke script + e2e ps1 含新内容 | 脚本未扩展 → 4 failures |
