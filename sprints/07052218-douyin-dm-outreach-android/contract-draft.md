# Sprint Contract Draft (Round 1)

## 已知约束（来自回归测试）

- `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DouyinCollectServiceStateTest.kt` → `debounced when event arrives within settle window` / `not debounced when event arrives after settle window` / `boundary at exactly settle window is still debounced` / `allows entering submitting only from TYPING_KEYWORD` / `rejects entering submitting from any other state` — 状态机去抖/防重复触发纪律，本 sprint 新代码不得破坏
- `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（真机注释，PR #1119/#1120 教训）→ "点击后必须重新抓取 root，不能用点击前的旧快照" 是本 line 已验证过的真机根因修复模式，本 sprint 的私信发送流程必须复用同一纪律（对应 Golden Path Step 4）
- `services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts`（路径为 `services/agent`，非 `apps/api`）→ Windows 路径三态判定（sent/limited/failed，气泡出现才算 sent，不可点私信按钮=limited 不可假 sent）— Android 判定送达真相的标准必须与此一致，不得对 Android 单独放宽
- `sprints/06131229-path2-douyin-dm-outreach/contract-dod.md` → dm-outreach-result 已有响应 schema 约定（`data` 顶层 keys 严格匹配、禁止 `id`/`ok`/`negation` 等混入字段），本 sprint 新增 `device_platform` 字段须遵循同一 schema 纪律，不得引入禁用字段名

## Response Schema（推导来源: api_registry 推导 — apps/api/src/routes/agent-burner.ts 现有 `/dm-outreach-result` 端点扩展）

### Endpoint: POST /api/agent/burner/dm-outreach-result（扩展现有端点，新增 `device_platform` 字段，非新建端点）

**Request body 新增字段**：
- `device_platform` (string，可选，默认 `"windows"`): 上报设备执行通道，本 sprint 新增合法值 `"android"`；来源——PRD Golden Path Step 6"带 platform=android"字面要求，字段名对齐仓库既有命名（`account_label`/`error_code`/`profile_url` 均下划线风格）
- `dm_assignment_id` (string/uuid，必填，用于幂等去重键): 来源——`apps/api/src/services/acquisition-dispatch.ts:644` 派单时已把 `dm_assignment_id` 写入 `publish_tasks.payload`，Android agent 回传时必须原样带回，proposer 直接复用已有字段名，不新造 `assignment_id`

**Success (HTTP 200) `data` 新增字段**：
```json
{"device_platform": "android"}
```
- `device_platform` (string, 必填仅当请求带了该字段): 回显请求的 `device_platform`，无该字段时不出现在响应（保持与现有 sent/limited/failed 三态 schema 向后兼容，见已知约束段 06131229 sprint 的严格 keys 断言）
- 其余字段沿用现有响应（`task_id`/`status`/`lead_write_status`/`feishu_bitable_url`/`session_disabled`(仅 failed)）不变

**禁用字段名**（沿用 06131229 sprint 既有红线，本 sprint 不得引入）: `id`、`ok`、`negation`、`taskId`、`dm_id`、`assignmentId`（驼峰变体，本仓一律下划线）

**幂等**（PRD 显式要求，Response Schema 之外的行为契约）：同一 `dm_assignment_id` 重复 POST 两次 → 第二次调用**不得**重复写 `dm_outreach_log`/不得重复触发飞书写入计数/`zenithjoy.dm_assignments.status` 不因重复回传而抖动。

**Error (HTTP 4xx)**: 沿用现有 `{"success":false,"error":{"code":"...","message":"..."}}` 结构，不变。

若 Generator 现状核查后发现需要新增独立端点而非扩展现有端点，须在 PR 描述中说明理由；本合同按"扩展现有端点"给出验证命令，Generator 如采用新端点须保持字段名/幂等语义一致。

**`device_platform` 与既有 `agents.os_type` 关系澄清**（Reviewer 问题 3 第 2 点）：`device_platform` 是本次派单时写入 `publish_tasks.payload` 的**执行通道标记**，取值来自派单当下对 `agents.capabilities` 的判定（含 `"android"` → `"android"`，否则 `"windows"`）；`agents.os_type`（`20260529_100000_add_os_type_to_agents.sql`）是**设备操作系统上报**，由 Android agent 心跳时上报（见 `AgentRegistrar.kt:40`）。两者是两条独立信号线，当前语义大概率一致但不保证——未来同一台 Android 设备的 capability 也可能被运营侧临时关闭/切换为非 `android` 执行通道（如设备转做纯采集不做触达），此时 `os_type='android'` 但 `device_platform` 不应为 `android`。因此**不派生、不合并**，Generator 按 `agents.capabilities` 独立判定 `device_platform`，不得直接 `SELECT os_type AS device_platform` 偷懒复用。

## Risk

1. **`dm_outreach_log.assignment_id` 迁移对既有 Windows 触达记录的影响**：迁移用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS assignment_id uuid`，幂等、不改动已有行的既有列值；新增列对历史行默认 `NULL`，不影响历史行既有查询路径（Windows 路径回归测试 `services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts` 不依赖该列）。Mitigation：Generator 迁移文件必须用 `IF NOT EXISTS` + 不设 `NOT NULL` 约束，避免对已有行触发迁移失败。
2. **outreach-history 从"永远空列表"变"有数据"后，前端可能有未处理过的非空分支**：`AcquisitionOutreachPage`（Dashboard）此前该查询长期因 catch 吞异常返回空列表，其"有数据"渲染分支（表格行/状态徽标）在生产环境从未被真实数据触发过，存在未验证的风险（如渲染 `sent`/`limited`/`failed` 状态徽标的映射是否完整、空字段兜底是否健壮）。Mitigation：本 sprint 不改动前端代码；Generator 需在 PR 描述中显式标注"该端点修复后 Dashboard 前端首次收到非空数据，前端渲染分支未在此 sprint 验证，建议 staging 人工过一遍该页面"，若发现前端报错需登记独立 Issue 而非在本 sprint 顺手改前端。
3. **`device_platform` 与既有 `agents.os_type` 语义重复的技术债**：见上方"关系澄清"段——两者独立维护存在字段语义漂移风险（未来可能出现不一致但无人发现）。Mitigation：不在本 sprint 合并两字段（会扩大 scope 且违反 Windows 兼容性），仅在合同与代码注释中明确记录两者关系与差异场景，留给后续技术债清理 sprint 处理；本 sprint 验收命令（Step 2）显式断言 `device_platform` 取自 `capabilities` 判定而非 `os_type`，防止 Generator 图省事直接复用 `os_type`。

---

## Golden Path

Android 设备开无障碍权限 → 中台按能力派单 → 频控自检 → 无障碍打开主页(重抓快照纪律) → 输入话术发送 → 读回执幂等回传 → Dashboard 触达记录页显示 sent

### Step 1: Android agent 上报能力，中台按能力选择可承接 dm_outreach 的设备

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步"Android 设备开启无障碍服务权限 → Agent 上报 platform=android 能力 → 中台记录该设备可承接 dm_outreach 任务"

**可观测行为**: Android agent 已经通过现有心跳机制上报 `capabilities` 含 `"android"`（`services/agent-android/.../WsClient.kt:148` 现状即如此，非新增）；`dispatchDue` 派单时，只有 `agents.capabilities` 含 `"android"` 的 agent 才会被打上 `device_platform="android"` 标记写入 `publish_tasks.payload`。

**验证命令**:
```bash
# 直接查 agents 表 schema 支持 capabilities 数组含 'android'（现状已支持，回归断言不倒退）
psql "$DB" -c "SELECT capabilities FROM zenithjoy.agents WHERE 'android' = ANY(capabilities) LIMIT 1" 2>&1 | head -5
# 期望：查询不报字段不存在错误（capabilities 列类型为 text[] 现状已支持）
```

**硬阈值**: `capabilities` 列查询不报错（schema 现状兼容，不需要新迁移）

---

### Step 2: 派单按 agent 能力标记 `device_platform`，同一 lead 不被跨平台重复占用

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步"中台把 dm_assignments 派给绑定该 Android 小号的 agent（同一 lead_id 若已被其他平台未完成任务占用则跳过）"

**可观测行为**: 两个 agent（一个 capabilities 含 `android`，一个不含）各绑定一个 burner 小号；`dispatchDue` 执行后，指派给 android agent 的那条 `publish_tasks.payload->>'device_platform'` = `"android"`，指派给非 android agent 的那条为 `"windows"`（或缺省不含该字段，向后兼容）。

**验证命令**:
```bash
psql "$DB" -At -c "
  SELECT payload->>'device_platform'
    FROM zenithjoy.publish_tasks
   WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID'
   ORDER BY created_at DESC LIMIT 1"
# 期望：android
```

**硬阈值**: 指派给 android agent 的任务 `device_platform='android'`；指派给非 android agent 的任务不为 `'android'`

---

### Step 3: 发送前频控自检 — 10 分钟窗口内已发 ≥3 条本次不发

**来源**: `[FROM_PRD]` — PRD NFR 约束"频控: 10 分钟窗口内 ≤3 条，超限本次不发，等下一个时间窗"

**可观测行为**: Android 端本地频控计数器纯函数：给定过去发送时间戳列表 + 当前时刻，10 分钟窗口内已有 ≥3 条则判定"本次不发"；窗口外的历史时间戳不计入。

**验证命令**:
```bash
cd services/agent-android && gradle :app:testDebugUnitTest --tests "*DmOutreachRateLimiterTest*" --rerun 2>&1 | tail -30
grep -o 'tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' \
  app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachRateLimiterTest.xml
```

**硬阈值**: `failures="0" errors="0"`，`tests` ≥ 4（空列表允许/窗口内2条允许/窗口内3条拒绝/窗口外历史不计入）

---

### Step 4: 无障碍操作后必须重新抓取快照，不得复用旧引用（复用 PR #1119/#1120 同一纪律）

**来源**: `[FROM_PRD]` — PRD NFR 约束"快照纪律: 每次无障碍操作后必须重新抓取 UI 快照，不得复用旧快照（同 PR #1119/#1120 模式）"

**可观测行为**: 每次点击操作（打开主页/点私信入口）后，下一步读取的快照 token/计数必须与点击前不同（视为"重新抓取过"），不能拿点击前的旧快照直接往下走。

**验证命令**:
```bash
cd services/agent-android && gradle :app:testDebugUnitTest --tests "*DmOutreachSnapshotDisciplineTest*" --rerun 2>&1 | tail -30
grep -o 'tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' \
  app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachSnapshotDisciplineTest.xml
```

**硬阈值**: `failures="0" errors="0"`，`tests` ≥ 3（点击后快照计数递增判定为真/复用同一快照判定为假/连续两次点击各自重抓）

---

### Step 5: 话术复用 `acquisition_config.dm_message`，Android/Windows 不新增独立字段

**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 步"按 acquisition_config.dm_message（Android/Windows 共用）输入话术并发送"

**可观测行为**: Android 任务 payload 里的话术字段名与 Windows 路径一致（`message`，参见 `acquisition-dispatch.ts:641` `message: cfg.dm_message`），不新增 `android_message`/`dm_text` 等平行字段。

**验证命令**:
```bash
psql "$DB" -At -c "
  SELECT (payload ? 'message') AND NOT (payload ? 'android_message') AND NOT (payload ? 'dm_text')
    FROM zenithjoy.publish_tasks
   WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID'
   ORDER BY created_at DESC LIMIT 1"
# 期望：t
```

**硬阈值**: 结果为 `t`（payload 含 `message` 字段且不含平行新字段）

---

### Step 6: 读回执确认真送达 → 按 `dm_assignment_id` 幂等回传，重复回传不重复计数

**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 步 + NFR"幂等: 按 assignment_id 去重，重复回传不重复计数/不重复触发下游"

**可观测行为**: 同一 `dm_assignment_id` 携带 `device_platform=android` 连续 POST 两次 `/dm-outreach-result`：第一次真实写 `dm_outreach_log` + 更新 `dm_assignments.status='sent'`；第二次调用 HTTP 200 幂等返回但 `dm_outreach_log` 计数不增加、`dm_assignments.updated_at` 不因重复调用而再次刷新（或刷新但状态值不变——以"不重复计数"为准绳）。

**验证命令**:
```bash
BEFORE=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$T' AND account_label='$LABEL' AND status='sent'")
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"sent\",\"profile_url\":\"$URL\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
# 重复回传（同一 dm_assignment_id）
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL\",\"status\":\"sent\",\"profile_url\":\"$URL\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$T' AND account_label='$LABEL' AND status='sent'")
[ "$AFTER" = "$((BEFORE + 1))" ] || { echo "FAIL: 重复回传多计数了 before=$BEFORE after=$AFTER"; exit 1; }
# 硬断言（次要建议：补 dm_assignments.status 未被第二次调用重置的 psql 断言，替换原模糊文字表述）
FINAL_STATUS=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.dm_assignments WHERE id='$ASSIGN_ID'")
[ "$FINAL_STATUS" = "sent" ] || { echo "FAIL: dm_assignments.status 被第二次回传重置，当前=$FINAL_STATUS 期望=sent"; exit 1; }
```

**硬阈值**: `AFTER == BEFORE + 1`（只计一次，不因重复回传翻倍）；`dm_assignments.status == 'sent'`（两次回传都成功后，第二次调用不把状态重置回非终态，用 psql 直接查最终值断言，不用模糊文字描述）

---

### Step 7: Dashboard 触达记录页正确显示 `sent`（修复既有 `dm_outreach_log.assignment_id` 缺列断点）

**来源**: `[AI_ADDED]` — GAN 阶段核查发现 `apps/api/src/routes/acquisition-dispatch.ts` 的 `GET /outreach-history` 查询已经在 JOIN `ol.assignment_id = a.id`（`acquisition-dispatch.ts:124`），但所有既有迁移文件（`20260626_214500_acquisition_dispatch.sql` 等）里 `dm_outreach_log` 表**从未建过 `assignment_id` 列**，该查询命中 catch 分支静默吞掉异常返回空列表（`acquisition-dispatch.ts:138-140`）。这是所有平台（含 Windows）触达记录页面长期返回空列表的既有断点，不修复 PRD 定义的 Step 7 无法被验证为真，因此纳入本 sprint 一并补齐（迁移文件 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS assignment_id uuid` 幂等安全，不影响其他 sprint）。

**⚠️ scope 边界声明（Reviewer 问题 2，采用方案 a）**：本 Step 是为了让 PRD Step 7（"用户在 Dashboard 触达记录页看到该记录状态变为 `sent`"）可被验证而做的**必要前置修复**，不是"Android 私信发送"主线 feature 的一部分——它是跨平台（含 Windows）的既有生产断点，本可独立成一个 bugfix task，只是因为不修就无法验证 PRD Step 7 才纳入本 sprint。**Generator 在 PR 描述中必须显式声明**："本 PR 除 Android 私信发送主线功能外，额外修复既有断点：`dm_outreach_log` 缺 `assignment_id` 列导致 outreach-history 长期返回空列表（跨平台既有 bug，非 Android 专属），理由：不修复无法验证 PRD Step 7"，并与主线功能改动在 commit 粒度上尽量分开，方便未来单独 revert。

**可观测行为**: 派单 → 回传 sent 后，`GET /api/acquisition/dispatch/outreach-history` 返回的 `items` 中能找到该条记录且 `status='sent'`。

**验证命令**:
```bash
# 1. 确认列已存在（Generator 迁移生效）
psql "$DB" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='dm_outreach_log' AND column_name='assignment_id'"
# 期望：assignment_id

# 2. 端点真返回该记录
R=$(curl -sf -H "X-Tenant-Id: $T" "$API_BASE/api/acquisition/dispatch/outreach-history")
echo "$R" | jq -e "[.data.items[] | select(.id==\"$ASSIGN_ID\")] | any(.status==\"sent\")"
```

**硬阈值**: 列存在 + `items` 中能查到 `status="sent"` 的对应记录（非空列表）

---

## E2E 验收（最终 final-e2e 跑 — local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 涉及两类执行环境：Android 端纯逻辑（频控计数器/快照重抓纪律）用 gradle 本地单元测试验证（真机 UIA 操作/真发部分按 PRD `target_environment_reason` 显式声明，仅人工在 adb+Tailscale 环境补验，不入自动裁决）；中台派单/回传/去重逻辑用 curl+psql 对本地 `apps/api`（`localhost:5200`）+ 本地 Postgres（`zenithjoy_test`）验证，复用 `acquisition-dispatch-smoke.sh` 既有种子数据模式。

```bash
#!/bin/bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB="${DB_URL:-${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/zenithjoy_test}}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "${2:-1}"; }

# ══ Part A: Android 端纯逻辑单元测试（Step 3 + Step 4）══════════════════════
if [ -d services/agent-android ] && [ -n "${ANDROID_HOME:-}" ]; then
  pushd services/agent-android >/dev/null
  gradle :app:testDebugUnitTest --tests "*DmOutreachRateLimiterTest*" --tests "*DmOutreachSnapshotDisciplineTest*" --rerun
  for f in app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachRateLimiterTest.xml \
           app/build/test-results/testDebugUnitTest/TEST-com.zenithjoy.agent.collect.DmOutreachSnapshotDisciplineTest.xml; do
    grep -q 'failures="0" errors="0"' "$f" || fail "Android 单测未全绿: $f"
  done
  popd >/dev/null
  ok "Android 频控 + 快照重抓纪律单测全绿"
else
  echo "⚠️  ANDROID_HOME 未配置，跳过本地 gradle 验证（CI windows/linux runner 上必须跑）"
fi

# ══ Part B: 中台派单 + 回传 + 幂等 + Dashboard 联表（Step 1/2/5/6/7）══════════
TENANT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('dmand-smoke-${RANDOM}-$$', 'dmand-tkey-${RANDOM}-$$', 'free') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$TENANT_ID" ] || fail "前置：建 tenant 失败" 99
H_TENANT=(-H "X-Tenant-Id: $TENANT_ID")

ANDROID_AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, status) VALUES ('$TENANT_ID', 'dmand-android-$$', ARRAY['android'], 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
WIN_AGENT_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, status) VALUES ('$TENANT_ID', 'dmand-win-$$', ARRAY[]::text[], 'online') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$ANDROID_AGENT_ID" ] && [ -n "$WIN_AGENT_ID" ] || fail "前置：建双 agent 失败" 99

LABEL_A="andr-号1"; LABEL_W="win-号1"
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, bound_at) VALUES
  ('$ANDROID_AGENT_ID','douyin','$LABEL_A','burner','active', NOW()),
  ('$WIN_AGENT_ID','douyin','$LABEL_W','burner','active', NOW())" >/dev/null

LEAD_A=$(psql "$DB" -At -c "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, profile_url, relevance_score) VALUES ('$TENANT_ID','sec_and','客户Android','https://www.douyin.com/user/sec_and', 90) RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)

curl -fsS -X PUT "${H_TENANT[@]}" -H "Content-Type: application/json" \
  -d '{"dm_per_day":30,"dm_per_hour":10,"burner_count":2,"dm_active_start":"00:00","dm_active_end":"23:59","dm_interval_min_sec":1,"dm_interval_max_sec":2}' \
  "$API_BASE/api/acquisition/config" >/dev/null

ASSIGN_ID=$(psql "$DB" -At -c "INSERT INTO zenithjoy.dm_assignments (tenant_id, lead_id, account_label, status, scheduled_for) VALUES ('$TENANT_ID', '$LEAD_A', '$LABEL_A', 'queued', NOW() - interval '1 minute') RETURNING id" | grep -oE '[0-9a-f-]{36}' | head -1)
[ -n "$ASSIGN_ID" ] || fail "前置：建 dm_assignment 失败" 99

curl -fsS -X POST "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/run" >/dev/null || fail "dispatch/run 调用失败"

# Step 2: device_platform 标记
DEVICE_PLATFORM=$(psql "$DB" -At -c "SELECT payload->>'device_platform' FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")
[ "$DEVICE_PLATFORM" = "android" ] || fail "Step2: device_platform 应为 android，实得 $DEVICE_PLATFORM"
ok "Step2: 派单正确标记 device_platform=android"

# Step 5: message 字段复用，不新增平行字段
MSG_CHECK=$(psql "$DB" -At -c "SELECT (payload ? 'message') AND NOT (payload ? 'android_message') AND NOT (payload ? 'dm_text') FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")
[ "$MSG_CHECK" = "t" ] || fail "Step5: message 字段复用检查失败 got=$MSG_CHECK"
ok "Step5: 话术复用 acquisition_config.dm_message，未新增平行字段"

TASK_ID=$(psql "$DB" -At -c "SELECT id FROM zenithjoy.publish_tasks WHERE task_type='dm_outreach' AND agent_id='$ANDROID_AGENT_ID' ORDER BY created_at DESC LIMIT 1")

# Step 6: 幂等回传
BEFORE=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$TENANT_ID' AND account_label='$LABEL_A' AND status='sent'")
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL_A\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/sec_and\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
curl -sf -X POST "$API_BASE/api/agent/burner/dm-outreach-result" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID\",\"agent_id\":\"$ANDROID_AGENT_ID\",\"account_label\":\"$LABEL_A\",\"status\":\"sent\",\"profile_url\":\"https://www.douyin.com/user/sec_and\",\"device_platform\":\"android\",\"dm_assignment_id\":\"$ASSIGN_ID\"}" >/dev/null
AFTER=$(psql "$DB" -At -c "SELECT count(*) FROM zenithjoy.dm_outreach_log WHERE tenant_id='$TENANT_ID' AND account_label='$LABEL_A' AND status='sent'")
[ "$AFTER" = "$((BEFORE + 1))" ] || fail "Step6: 幂等失败 before=$BEFORE after=$AFTER"
FINAL_STATUS=$(psql "$DB" -At -c "SELECT status FROM zenithjoy.dm_assignments WHERE id='$ASSIGN_ID'")
[ "$FINAL_STATUS" = "sent" ] || fail "Step6: dm_assignments.status 被第二次回传重置，当前=$FINAL_STATUS"
ok "Step6: 重复回传不重复计数 (before=$BEFORE after=$AFTER)，dm_assignments.status 未被重置=$FINAL_STATUS"

# Step 7: outreach-history 联表可见 sent（修复 assignment_id 缺列断点后）
COL=$(psql "$DB" -At -c "SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='dm_outreach_log' AND column_name='assignment_id'")
[ "$COL" = "assignment_id" ] || fail "Step7: dm_outreach_log.assignment_id 列未补齐"
HIST=$(curl -sf "${H_TENANT[@]}" "$API_BASE/api/acquisition/dispatch/outreach-history")
echo "$HIST" | jq -e "[.data.items[] | select(.id==\"$ASSIGN_ID\")] | any(.status==\"sent\")" >/dev/null \
  || fail "Step7: outreach-history 未见 $ASSIGN_ID status=sent — $HIST"
ok "Step7: Dashboard 触达记录页可见该记录 status=sent"

echo "✅ Golden Path 验证通过（Android dm_outreach 执行路径）"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 中台派单按能力标记 device_platform + 幂等判定 | `sprints/07052218-douyin-dm-outreach-android/tests/device-platform.test.ts` | `capabilities 含 android → 返回 android` / `capabilities 不含 android → 返回 windows（默认执行通道，向后兼容）` / `capabilities 为 null/undefined → 返回 windows（不抛异常）` / `同一 dm_assignment_id 已经是终态(sent/limited/failed) → 判定为重复，不应再计数` / `dm_assignment 当前仍是 queued/dispatched（未终态）→ 判定非重复，允许正常写入` / `dm_assignment 状态为 null（未找到该 assignment）→ 判定非重复（交给上层报 404/正常处理，不是幂等短路）` | → import 报 `ERR_MODULE_NOT_FOUND`（`apps/api/src/services/device-platform` 不存在），已本地跑 `npx vitest run` 确认 |
| Android 频控计数器 | `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DmOutreachRateLimiterTest.kt`（同内容副本存于 `sprints/07052218-douyin-dm-outreach-android/tests/android/`）| `empty history allows send` / `2 sends within 10min window still allows send (would be 3rd)` / `3 sends within 10min window rejects 4th send` / `sends outside 10min window are not counted` / `boundary exactly at window edge is still counted (inclusive)` | → `DmOutreachRateLimiter` 未定义，编译期 unresolved reference（本地无 `ANDROID_HOME`，Red 待 CI `android-agent-ci.yml` 或人工配置 SDK 后确认；`SnapshotDiscipline`/`DmOutreachRateLimiter` 均为全新类名，仓库内 grep 无命中，可断定为真红） |
| Android 无障碍点击后重抓快照纪律 | `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/DmOutreachSnapshotDisciplineTest.kt`（同内容副本存于 `sprints/07052218-douyin-dm-outreach-android/tests/android/`）| `fetch count increases after click means fresh snapshot was taken` / `same fetch count after click means snapshot was reused (violation)` / `two consecutive clicks must each trigger their own refetch` / `requireFresh throws when snapshot token has not advanced` | → `SnapshotDiscipline` 未定义，编译期 unresolved reference（同上，本地无 SDK 无法跑 gradle 确认，CI 上必真红） |

> **Red 证据说明**：TS 测试（`device-platform.test.ts`）已在本地用 `npx vitest run` 实跑确认 `ERR_MODULE_NOT_FOUND`，真红。Kotlin 两个测试文件本地环境缺 `ANDROID_HOME`（`gradle :app:testDebugUnitTest` 报 `SDK location not found`，与代码是否实现无关），无法在本轮本地确认 Red；但引用的 `DmOutreachRateLimiter`/`SnapshotDiscipline` 两个类名在仓库内检索无任何现存定义（`grep -rl` 无命中），可合理判定 Generator 未实现前必为编译失败（真红），CI（`.github/workflows/android-agent-ci.yml` 走 `gradle :app:testDebugUnitTest`）会在 push 后给出确定性红证据。
