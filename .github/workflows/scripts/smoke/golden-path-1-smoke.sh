#!/usr/bin/env bash
# golden-path-1-smoke.sh
# ZenithJoy Walking Skeleton — 客户首次成功路径（B 形态，6 步）
# Notion Journey: https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29
#
# 这是这个产品的"用户路径"金标准 smoke。
# 每个 PR 推进的 step 必须让 smoke 多过一关。
# Feature 0（端到端 gating）= 整条 smoke 全绿才算 sprint 成功，单 step 通不算。
#
# 当前状态：全红骨架。每个 step 都 EXIT_AT_STEP_X，等待 PR 把 step N 从红推到绿。
#
# 用法：
#   bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh
#   退出码 0 = 端到端全通；非零 = 第 EXIT_CODE 步红
#
# 升级 Feature thickness 时记得同步 .replaces_old_thin（删 mock/hardcode）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
DASHBOARD_BASE="${DASHBOARD_BASE:-http://localhost:5173}"
TEST_EMAIL="${TEST_EMAIL:-smoke-$(date +%s)@zenithjoy.test}"
TEST_PASSWORD="${TEST_PASSWORD:-Smoke!Test2026}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }
todo() { echo "🔴 $1 — TODO（未实现）"; exit "$2"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Path 1 Walking Skeleton — 客户首次成功路径"
echo "  6 步：注册 → 装客户端 → 画像诊断 → 绑平台 → AI生成 → 发布回执"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ───────────────────────────────────────────────────────────────────
# Step 1：注册自动登录（含 free license 自动创建）
# Notion Feature: 358c40c2-ba63-8102-a531-f49111b8832e
# DoD：POST /api/auth/sign-up/email 200 + 自动建 free license + cookie 可访问 /me
# 现状：✅ PR #239-244 已合并
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 1: 注册自动登录"

S1_COOKIES=$(mktemp)
S1_TMP=$(mktemp)
S1_EMAIL="smoke-$(date +%s)@zenithjoy.test"

# 1.1 POST sign-up/email → 200 + user.id
S1_HTTP=$(curl -s -o "$S1_TMP" -w "%{http_code}" --max-time 30 \
  -c "$S1_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$S1_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"smoke\"}")
[ "$S1_HTTP" = "200" ] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.1 sign-up expected 200, got $S1_HTTP" 1; }
S1_USER_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['user']['id'])" "$S1_TMP" 2>/dev/null)
[ -n "$S1_USER_ID" ] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.1 no user.id in response" 1; }
ok "Step 1.1 sign-up → user.id=$S1_USER_ID"

# 1.2 cookie session → /api/account/me 返回 user + free license
S1_HTTP=$(curl -s -o "$S1_TMP" -w "%{http_code}" --max-time 15 \
  -b "$S1_COOKIES" "$API_BASE/api/account/me")
[ "$S1_HTTP" = "200" ] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.2 /me expected 200, got $S1_HTTP" 1; }
S1_TIER=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['license']['tier'])" "$S1_TMP" 2>/dev/null)
[ "$S1_TIER" = "free" ] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.2 license.tier='$S1_TIER' expected 'free'" 1; }
ok "Step 1.2 /me → license.tier=free ✓"

# 1.3 license_key 格式 ZJ-F-XXXXXXXX（free tier 前缀）
S1_LK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['license']['license_key'])" "$S1_TMP" 2>/dev/null)
[[ "$S1_LK" == ZJ-F-* ]] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.3 license_key='$S1_LK' expected ZJ-F-* prefix" 1; }
ok "Step 1.3 license_key=$S1_LK ✓"

# 1.4 license 未过期（expires_at > now）
S1_EXP=$(python3 -c "import json,sys,datetime; d=json.load(open(sys.argv[1])); exp=d['license']['expires_at']; now=datetime.datetime.now(datetime.timezone.utc).isoformat(); print('ok' if exp > now else 'expired')" "$S1_TMP" 2>/dev/null)
[ "$S1_EXP" = "ok" ] || { rm -f "$S1_TMP" "$S1_COOKIES"; fail "Step 1.4 license expired or parse error" 1; }
ok "Step 1.4 license not expired ✓"

rm -f "$S1_TMP"
# 保留 $S1_COOKIES 供后续 step 复用（Step 6 有自己的注册，不依赖这个）
ok "Step 1 ✅ 注册自动登录 + free license 全通"

# ───────────────────────────────────────────────────────────────────
# Step 2：装客户端 + Agent 自动连中台
# Notion Feature: 358c40c2-ba63-81d1-94e5-eb08a6f8b9f6
# DoD：Dashboard 暴露下载链接 + Agent .exe/.dmg 启动后能用 license 注册回中台
# 现状：Agent 代码完整（services/agent），但 Dashboard 没下载页 + 缺 release 自动发
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 2: 装客户端 + Agent 连中台"

# 2.1 install-pack manifest 可访问（客户下载入口）
S2_TMP=$(mktemp)
S2_HTTP=$(curl -s -o "$S2_TMP" -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/agent/install-pack/manifest")
[ "$S2_HTTP" = "200" ] || { rm -f "$S2_TMP"; fail "Step 2.1 manifest expected 200, got $S2_HTTP" 2; }
S2_VERSION=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$S2_TMP" 2>/dev/null)
S2_SHA=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sha256'])" "$S2_TMP" 2>/dev/null)
[ -n "$S2_VERSION" ] || { rm -f "$S2_TMP"; fail "Step 2.1 manifest 没 version" 2; }
[ ${#S2_SHA} -eq 64 ] || { rm -f "$S2_TMP"; fail "Step 2.1 sha256 长度不对(${#S2_SHA})" 2; }
ok "Step 2.1 install-pack manifest v$S2_VERSION ✓"

# 2.2 Agent 用 Step 1 的 license_key 注册（heartbeat）→ 拿到 agent_id
# 这是"客户端装好后自动连中台"的 API 层验证（含 AI 视频流水线 agent v$S2_VERSION）
S2_HB=$(curl -s -o "$S2_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "content-type: application/json" \
  -H "x-license-key: $S1_LK" \
  -d '{"machine_id":"smoke-step2","agent_version":"'"$S2_VERSION"'"}')
[ "$S2_HB" = "200" ] || { rm -f "$S2_TMP"; fail "Step 2.2 heartbeat expected 200, got $S2_HB" 2; }
AGENT_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['agent_id'])" "$S2_TMP" 2>/dev/null)
[ -n "$AGENT_ID" ] || { rm -f "$S2_TMP"; fail "Step 2.2 no agent_id in heartbeat response" 2; }
rm -f "$S2_TMP"
ok "Step 2.2 heartbeat → agent_id=$AGENT_ID ✓"

ok "Step 2 ✅ install-pack manifest + Agent 注册中台（含 AI 视频流水线）"

# ───────────────────────────────────────────────────────────────────
# Step 3：填画像诊断（行业 / 受众 / 风格 3 字段）
# Notion Feature: 358c40c2-ba63-812c-88e8-c1db0d5e31db
# DoD：POST /api/profile → UPSERT user_profiles → GET /api/profile 读回一致
# 现状：✅ 本 PR 新增
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 3: 填画像诊断"

S3_TMP=$(mktemp)

# 3.1 POST /api/profile — 写 3 字段（用 Step 1 的 cookie session）
S3_HTTP=$(curl -s -o "$S3_TMP" -w "%{http_code}" --max-time 15 \
  -b "$S1_COOKIES" \
  -X POST "$API_BASE/api/profile" \
  -H "Content-Type: application/json" \
  -d '{"industry":"短视频电商","audience":"25-35岁女性","style":"活泼励志"}')
[ "$S3_HTTP" = "201" ] || { rm -f "$S3_TMP"; fail "Step 3.1 POST /api/profile expected 201, got $S3_HTTP" 3; }
S3_IND=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['industry'])" "$S3_TMP" 2>/dev/null)
[ "$S3_IND" = "短视频电商" ] || { rm -f "$S3_TMP"; fail "Step 3.1 industry='$S3_IND' mismatch" 3; }
ok "Step 3.1 POST /api/profile → industry 已写入 ✓"

# 3.2 GET /api/profile — 读回，三字段一致
S3_HTTP=$(curl -s -o "$S3_TMP" -w "%{http_code}" --max-time 15 \
  -b "$S1_COOKIES" "$API_BASE/api/profile")
[ "$S3_HTTP" = "200" ] || { rm -f "$S3_TMP"; fail "Step 3.2 GET /api/profile expected 200, got $S3_HTTP" 3; }
S3_AUD=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['audience'])" "$S3_TMP" 2>/dev/null)
S3_STY=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['style'])" "$S3_TMP" 2>/dev/null)
rm -f "$S3_TMP"
[ "$S3_AUD" = "25-35岁女性" ] || fail "Step 3.2 audience='$S3_AUD' mismatch" 3
[ "$S3_STY" = "活泼励志" ] || fail "Step 3.2 style='$S3_STY' mismatch" 3
ok "Step 3.2 GET /api/profile → 三字段读回一致 ✓"

ok "Step 3 ✅ 画像诊断 UPSERT + 读回全通"

# ───────────────────────────────────────────────────────────────────
# Step 4：扫码绑定快手（Agent 弹登录窗）
# Notion Feature: 358c40c2-ba63-813d-9500-c5f24ddb6d7e
# DoD：Agent 弹 Electron BrowserWindow → 用户扫码 → cookie 存本地 → 上报 ready
# 现状：🟡 8 平台 handler 都在（services/agent/src/handlers），但缺登录弹窗
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 4: 绑定平台（thin：验证 Agent 已注册 + 中台可派任务）"
# thin 说明：QR 扫码是客户在真机上完成的人工步骤，CI 不可自动化。
# thin smoke 验证前提条件：Agent 已注册到中台（heartbeat），中台能向它派 publish_task。
# 实际扫码绑定由 lead 自验（xian-rog 真机）覆盖。

# 4.1 Agent 心跳仍活跃（Step 2 已注册的 agent_id 可查询）
S4_TMP=$(mktemp)
S4_HB=$(curl -s -o "$S4_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "content-type: application/json" \
  -H "x-license-key: $S1_LK" \
  -d "{\"machine_id\":\"smoke-step4\",\"agent_version\":\"$S2_VERSION\"}")
[ "$S4_HB" = "200" ] || { rm -f "$S4_TMP"; fail "Step 4.1 heartbeat expected 200, got $S4_HB" 4; }
S4_AID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['agent_id'])" "$S4_TMP" 2>/dev/null)
[ -n "$S4_AID" ] || { rm -f "$S4_TMP"; fail "Step 4.1 no agent_id" 4; }
ok "Step 4.1 Agent 已注册中台 agent_id=$S4_AID ✓"

# 4.2 Agent 心跳带回 queued_tasks 字段（证明中台认识这个 agent，随时可派任务）
S4_TASKS=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(type(d.get('queued_tasks','MISSING')).__name__)" "$S4_TMP" 2>/dev/null)
rm -f "$S4_TMP"
[ "$S4_TASKS" = "list" ] || fail "Step 4.2 heartbeat.queued_tasks 不是 list (got: $S4_TASKS)" 4
ok "Step 4.2 heartbeat.queued_tasks 字段存在（中台可随时派任务）✓"

ok "Step 4 ✅ Agent 已注册中台（thin：QR扫码绑定由lead自验在xian-rog真机覆盖）"

# ───────────────────────────────────────────────────────────────────
# Step 5：AI 视频流水线（本地优先）
# Notion Feature: 358c40c2-ba63-8110-b3c5-d55c7f015000
# DoD：POST /api/ai-video/jobs (JSON local_path) → Agent PATCH progress → PUT complete
#       → 中台 status=completed + output_dir 已记录
# 现状：✅ PR #296 + #297 已合并
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 5: AI 视频流水线（create → progress → complete → status=completed）"

S5_TMP=$(mktemp)

# 5.1 createJob — JSON body local_path（非文件上传，本地优先架构）
S5_HTTP=$(curl -s -o "$S5_TMP" -w "%{http_code}" --max-time 30 \
  -X POST "$API_BASE/api/ai-video/jobs" \
  -H "Content-Type: application/json" \
  -d '{"local_path":"C:\\Users\\smoke\\video.mp4","topic":"golden-path-step5-smoke"}')
[ "$S5_HTTP" = "201" ] || { rm -f "$S5_TMP"; fail "Step 5.1 createJob expected 201, got $S5_HTTP" 5; }
S5_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['id'])" "$S5_TMP" 2>/dev/null)
[ -n "$S5_ID" ] || { rm -f "$S5_TMP"; fail "Step 5.1 no job id in response" 5; }
ok "Step 5.1 createJob → id=$S5_ID"

# 5.2 src_video 存本地路径（含文件名）
S5_SRC=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['src_video'])" "$S5_TMP" 2>/dev/null)
[[ "$S5_SRC" == *"video.mp4"* ]] || { rm -f "$S5_TMP"; fail "Step 5.2 src_video 不含文件名 (got: $S5_SRC)" 5; }
ok "Step 5.2 src_video=本地路径 ✓"

# 5.3 旧文件传输端点已删除（/source 必须 404）
S5_DEL=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "$API_BASE/api/ai-video/jobs/$S5_ID/source")
[ "$S5_DEL" = "404" ] || { rm -f "$S5_TMP"; fail "Step 5.3 /source 应已删除(404)，got $S5_DEL" 5; }
ok "Step 5.3 /source 已删除(404) ✓"

# 5.4 Agent 模拟：PATCH progress（中间状态）
S5_PATCH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -X PATCH "$API_BASE/api/ai-video/jobs/$S5_ID/progress" \
  -H "Content-Type: application/json" \
  -d '{"progress":50,"status":"processing"}')
[ "$S5_PATCH" = "200" ] || { rm -f "$S5_TMP"; fail "Step 5.4 PATCH progress expected 200, got $S5_PATCH" 5; }
ok "Step 5.4 PATCH progress=50 ✓"

# 5.5 Agent 完成：PUT /complete → status 必须变 completed（不能是 processing）
S5_HTTP=$(curl -s -o "$S5_TMP" -w "%{http_code}" --max-time 15 \
  -X PUT "$API_BASE/api/ai-video/jobs/$S5_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{\"output_dir\":\"C:\\\\Users\\\\smoke\\\\zenithjoy-output\\\\$S5_ID\"}")
[ "$S5_HTTP" = "200" ] || { rm -f "$S5_TMP"; fail "Step 5.5 completeJob expected 200, got $S5_HTTP" 5; }
S5_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['status'])" "$S5_TMP" 2>/dev/null)
rm -f "$S5_TMP"
[ "$S5_STATUS" = "completed" ] || fail "Step 5.5 status='$S5_STATUS' expected 'completed' (redundant-progress bug?)" 5
ok "Step 5.5 completeJob → status=completed ✓"

ok "Step 5 ✅ AI 视频流水线 API 全通（PR #296 #297）"

# ───────────────────────────────────────────────────────────────────
# Step 6：中台派任务 + dryrun 发布 + 回执显示
# Notion Feature: 358c40c2-ba63-81c5-a956-cf0d8f3a9499
# DoD：POST /api/works/:id/publish → sendToAgent → kuaishou-publish dryrun
#       → 回写 work.publish_status=success + Dashboard 显示回执
# 现状：🟡 表单/api/works 在，但缺中台→Agent 任务派发链路
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 6: 中台派任务 + Agent 路由 + dryrun 发布抖音 video（WS2 Sprint 2.1a 加固）"

# 6.1 注册 + 拿 license_key
SK_EMAIL="${TEST_EMAIL}"
SIGNUP=$(curl -fsS -c /tmp/sk-step6.cookies -X POST "$API_BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$SK_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"smoke\"}" 2>/dev/null) \
  || fail "Step 6.1 sign-up failed" 6
ME=$(curl -fsS -b /tmp/sk-step6.cookies "$API_BASE/api/account/me" 2>/dev/null) \
  || fail "Step 6.1 /api/account/me failed" 6
LICENSE_KEY=$(echo "$ME" | python3 -c "import json,sys;print(json.load(sys.stdin)['license']['license_key'])" 2>/dev/null) \
  || fail "Step 6.1 license_key extract failed" 6

# 6.2 起 Agent + 上报 heartbeat 拿 agent_id
HB=$(curl -fsS -X POST "$API_BASE/api/agent/heartbeat" \
  -H 'content-type: application/json' \
  -H "x-license-key: $LICENSE_KEY" \
  -d '{"machine_id":"smoke-step6","agent_version":"0.1.8"}' 2>/dev/null) \
  || fail "Step 6.2 heartbeat failed" 6
AGENT_ID=$(echo "$HB" | python3 -c "import json,sys;print(json.load(sys.stdin)['agent_id'])" 2>/dev/null) \
  || fail "Step 6.2 agent_id extract failed" 6

# 6.3 中台创建 type=video publish_task（WS1 + WS2 修复后必须接 type）
VIDEO_TASK=$(curl -fsS -b /tmp/sk-step6.cookies -X POST "$API_BASE/api/publish/task" \
  -H 'content-type: application/json' \
  -d "{\"agent_id\":\"$AGENT_ID\",\"platform\":\"douyin\",\"type\":\"video\",\"payload\":{\"video_path\":\"/tmp/smoke.mp4\",\"title\":\"smoke-$(date +%s)\"}}" 2>/dev/null) \
  || fail "Step 6.3 create video task failed" 6
VIDEO_TYPE=$(echo "$VIDEO_TASK" | python3 -c "import json,sys;print(json.load(sys.stdin).get('type','?'))" 2>/dev/null)
if [ "$VIDEO_TYPE" != "video" ]; then
  fail "Step 6.3 response.type='$VIDEO_TYPE' expected 'video' (WS1 publish_tasks.type 字段未生效?)" 6
fi

# 6.4 Agent 路由必须按 type 真选 video 脚本（WS2 修硬编码 image bug 验证）
# 期望 agent.log 含 [type-route] type=video → publish-douyin-video（不是 image）
# CI 跑 dryrun mock 模式：ZENITHJOY_AGENT_DRYRUN_BROWSER=mock
ZENITHJOY_AGENT_REAL_PUBLISH=0 ZENITHJOY_AGENT_DRYRUN_BROWSER=mock \
  node -e "
    const { resolveDouyinScriptPath } = require('./services/agent/dist/handlers/douyin-publish.js');
    const p = resolveDouyinScriptPath({type:'video'}, {ZENITHJOY_AGENT_REAL_PUBLISH:'0'});
    if (!p.match(/publish-douyin-video-dryrun\\.cjs\$/)) { console.error('FAIL: route resolved to', p); process.exit(1); }
    console.log('[type-route] type=video → publish-douyin-video-dryrun.cjs OK');
  " 2>/dev/null \
  || fail "Step 6.4 type=video 路由验证失败 (P0 bug 防回归 — WS2)" 6

# 6.5 反向用例：type=article (无脚本) 必须显式失败，严禁 fallback image
ARTICLE_FAIL=$(node -e "
  const { resolveDouyinScriptPath } = require('./services/agent/dist/handlers/douyin-publish.js');
  try {
    resolveDouyinScriptPath({type:'article'}, {});
    console.error('FAIL: article 应抛错但 silent pass');
    process.exit(1);
  } catch (e) {
    if (!/no script for type article|unsupported type article/i.test(e.message)) {
      console.error('FAIL: 错误信息不规范:', e.message);
      process.exit(1);
    }
    console.log('OK: type=article 显式抛错（不 fallback image） →', e.message);
  }
" 2>/dev/null) \
  || fail "Step 6.5 type=article 反向用例失败 (P0 bug 防回归)" 6

ok "Step 6 ✅ video 路由通 + article 反向不 fallback (WS2 Sprint 2.1a)"

# ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Path 1 端到端全绿 ✅ — Journey 可升 skeleton（用 walking-skeleton skill thicken）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
