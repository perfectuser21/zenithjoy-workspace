#!/usr/bin/env bash
# golden-path-2-smoke.sh
# ZenithJoy Walking Skeleton — Path 2 客户智能获客路径（9 步本地版）
# Notion Journey: https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf
#
# 2026-07-07 用户更正（decision 431acd2c）：整条去飞书、改本地中台。
# 本 smoke 2026-07-14 重写（handoff 0714 刀1），替换旧版「Sprint A 飞书集成」（停在 05-26，
# 测已删除的飞书流程 + fake-feishu-server stub）。
#
# 8 步（CLAUDE.md Path 2 权威模型）与断言层级：
#   Step 1 注册客户端自动（真链路：sign-up → free license → 自动建 tenant）
#   Step 2 装客户端（真链路：POST /api/agent/register）
#   Step 3 Android 端 Agent 连中台（服务端等价断言：x-agent-id 真实调用方 shape，#1267 路径）
#   Step 4 系统自动建 3 张本地表（获客画像/对标视频/Lead 落本地中台 DB）
#   Step 5 客户在本地 dashboard 填获客画像（真链路：PATCH /api/acquisition/config）
#   Step 6 手机端登录抖音小号（服务端等价断言：account-scan-result 写回 role=burner）
#   Step 7 中台检测登录态（真链路：GET /api/agent/burner/sessions）
#   Step 8 评论区挖客闭环·采集+判定段（真链路：collect/start → report-videos → judge-video 真调判定）
#   Step 9 抓评论回填真实抖音号 → Lead 落库带号（真链路：comment-score-result → acquisition_leads.douyin_id）
#
# ⚠️ 真机段等价断言说明（铁律 5）：
#   Step 3/6 的真机执行段（Android 真机装 APK、真机登录抖音小号）与 Step 8 的真机截图上报段
#   属 Android 真机通道，本 smoke 用「真实调用方 shape 的 API 层等价断言」覆盖服务端链路。
#   TODO(android-evaluator-channel): Android 真机 TARGET_ENV 通道落地后（另线建设中），
#   真机段在 xian-rog e2e-line02-android-collect.yml（nightly 04:00）复跑全链路；
#   届时本注释更新为真机 workflow 引用。
#
# 未覆盖真实链路清单（规则 C，proposer 9.10.0）：
#   - 对标视频手填 URL 的 dashboard 端点（Path2 Step 5 后半）尚未建设 → 本 smoke 未覆盖
#   - 回评+私信真发 → 企微 webhook（Lead 落表之后的触达段）尚未接入本 smoke
#     （Step 9 已覆盖到「抓评论 → 抖音号回填 Lead」为止；派单发号由
#      acquisition-dispatch-douyin-id.test.ts 的 dispatchDue payload 断言守）
#
# 用法：
#   API_BASE=http://localhost:5200 DB_URL=postgresql://... \
#     bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh
#   退出码 0 = 9 步服务端段全通；非零 = 第 EXIT_CODE 步红
#
# 真调判定依赖：API server 进程需带 TOAPIS_API_KEY（CI: secrets.TOAPIS_API_KEY 注入 job env）。
# 无 key 时 judge-video 落 pending/no_api_key → Step 8 真红（这是设计：#1269/#1271 就是全 mock 漏过的）。

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"

_UNIQ_N=0
uniq_token() { _UNIQ_N=$((_UNIQ_N+1)); echo "$(date +%s)-$$-${RANDOM}-${_UNIQ_N}"; }
RND=$(uniq_token)
TEST_PASSWORD="Smoke!Test2026"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

psq() { psql "$DB_URL" -At -c "$1"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Path 2 Walking Skeleton — 客户智能获客路径（8 步本地版）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ───────────────────────────────────────────────────────────────────
# Step 1：注册客户端自动（sign-up → free license → 自动建 tenant）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 1: 注册客户端自动"
S1_TMP=$(mktemp); S1_COOKIES=$(mktemp)
S1_EMAIL="p2-smoke-${RND}@zenithjoy.test"
S1_HTTP=$(curl -s -o "$S1_TMP" -w "%{http_code}" --max-time 30 -c "$S1_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d "{\"email\":\"$S1_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"p2smoke\"}")
[ "$S1_HTTP" = "200" ] || fail "Step 1 sign-up expected 200, got $S1_HTTP: $(cat "$S1_TMP")" 1
S1_HTTP=$(curl -s -o "$S1_TMP" -w "%{http_code}" --max-time 15 -b "$S1_COOKIES" "$API_BASE/api/account/me")
[ "$S1_HTTP" = "200" ] || fail "Step 1 /me expected 200, got $S1_HTTP" 1
LICENSE_KEY=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['license']['tier']=='free'; print(d['license']['license_key'])" "$S1_TMP" 2>/dev/null)
[[ "$LICENSE_KEY" == ZJ-F-* ]] || fail "Step 1 license_key='$LICENSE_KEY' expected ZJ-F-*" 1
TENANT_ID=$(psq "SELECT tenant_id FROM zenithjoy.licenses WHERE license_key='$LICENSE_KEY' AND tenant_id IS NOT NULL LIMIT 1")
[ -n "$TENANT_ID" ] || fail "Step 1 注册未自动建 tenant（licenses.tenant_id 空）" 1
ok "Step 1 ✅ 注册 → license=$LICENSE_KEY tenant=$TENANT_ID"

# ───────────────────────────────────────────────────────────────────
# Step 2：装客户端（Agent 注册连中台）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 2: 装客户端（Agent register）"
S2_TMP=$(mktemp)
S2_HTTP=$(curl -s -o "$S2_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/register" -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"p2-smoke-${RND}\",\"hostname\":\"p2-smoke-host\"}")
[ "$S2_HTTP" = "200" ] || fail "Step 2 agent/register expected 200, got $S2_HTTP: $(cat "$S2_TMP")" 2
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('ok') is True or d.get('success') is True" "$S2_TMP" 2>/dev/null \
  || fail "Step 2 register 响应无 ok/success: $(cat "$S2_TMP")" 2
AGENT_PK=$(psq "SELECT id FROM zenithjoy.agents WHERE tenant_id='$TENANT_ID' ORDER BY created_at DESC LIMIT 1")
[ -n "$AGENT_PK" ] || fail "Step 2 agents 表无该 tenant 的 agent 行" 2
ok "Step 2 ✅ agent 注册 → agents.id=${AGENT_PK}（tenant 已关联）"

# ───────────────────────────────────────────────────────────────────
# Step 3：Android 端 Agent 连中台 — 真实调用方 shape 等价断言（#1267 路径）
# 生产 Android agent 用 x-agent-id header（服务端反查真 tenant），不是 body/X-Tenant-Id。
# TODO(android-evaluator-channel): 真机段由 Android 通道接管后在真机 workflow 复跑。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 3: Android Agent 连中台（x-agent-id shape）"
S3_TMP=$(mktemp)
S3_HTTP=$(curl -s -o "$S3_TMP" -w "%{http_code}" --max-time 15 \
  -H "x-agent-id: $AGENT_PK" "$API_BASE/api/acquisition/pending-collect-tasks")
[ "$S3_HTTP" = "200" ] || fail "Step 3 pending-collect-tasks（带 x-agent-id）expected 200, got $S3_HTTP: $(cat "$S3_TMP")" 3
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert isinstance(d.get('tasks'), list)" "$S3_TMP" 2>/dev/null \
  || fail "Step 3 响应无 tasks 数组: $(cat "$S3_TMP")" 3
# 反向：judge-video 不带 x-agent-id 必须 401 MISSING_AGENT_ID（防两条代码路径分叉——#1267 的病根；
# pending-collect-tasks 无 header 按设计软返回空列表，不作反向断言对象）
S3_NEG=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/judge-video" -H "Content-Type: application/json" -d '{}')
[ "$S3_NEG" = "401" ] || fail "Step 3 judge-video 无 x-agent-id 应 401，got ${S3_NEG}（调用方 shape 校验被绕过）" 3
ok "Step 3 ✅ x-agent-id 真实调用方 shape 通 + 无 header 401"

# ───────────────────────────────────────────────────────────────────
# Step 4：系统自动建 3 张本地表（获客画像 / 对标视频 / Lead — 本地中台 DB，不再是飞书）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 4: 3 张本地表存在"
for T in acquisition_config acquisition_collect_videos acquisition_leads; do
  EXISTS=$(psq "SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='$T' LIMIT 1")
  [ "$EXISTS" = "1" ] || fail "Step 4 本地表 zenithjoy.$T 不存在" 4
done
ok "Step 4 ✅ acquisition_config / acquisition_collect_videos / acquisition_leads 三表在库"

# ───────────────────────────────────────────────────────────────────
# Step 5：客户在本地 dashboard 填获客画像（PATCH /api/acquisition/config）
# 未覆盖（规则C清单）：对标视频手填 URL 端点尚未建设。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 5: 本地画像写入"
S5_TMP=$(mktemp)
S5_HTTP=$(curl -s -o "$S5_TMP" -w "%{http_code}" --max-time 15 \
  -X PATCH "$API_BASE/api/acquisition/config" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"target_profile_desc":"p2-smoke 装修行业获客画像：目标受众为准备装修的业主，钩子为免费量房报价"}')
[ "$S5_HTTP" = "200" ] || fail "Step 5 PATCH config expected 200, got $S5_HTTP: $(cat "$S5_TMP")" 5
S5_ROW=$(psq "SELECT count(*) FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID' AND target_profile_desc <> '' AND updated_at > NOW() - interval '120 seconds'")
[ "$S5_ROW" = "1" ] || fail "Step 5 acquisition_config 无本轮时间窗内写入" 5
ok "Step 5 ✅ 画像已落本地 acquisition_config（时间窗验证）"

# ───────────────────────────────────────────────────────────────────
# Step 6：手机端登录抖音小号 — 服务端等价断言（DeviceAccountScanService 写回路径）
# TODO(android-evaluator-channel): 真机登录段由 Android 通道接管。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 6: 小号扫描写回（role=burner）"
S6_TMP=$(mktemp)
BURNER_LABEL="p2-smoke-burner-${RND}"
S6_HTTP=$(curl -s -o "$S6_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/account-scan-result" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"ok\":true,\"account_ids\":[\"$BURNER_LABEL\"]}")
[ "$S6_HTTP" = "200" ] || fail "Step 6 account-scan-result expected 200, got $S6_HTTP: $(cat "$S6_TMP")" 6
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['data']['written'] >= 1" "$S6_TMP" 2>/dev/null \
  || fail "Step 6 written < 1: $(cat "$S6_TMP")" 6
S6_ROW=$(psq "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND role='burner' AND status='active' AND account_label='$BURNER_LABEL' AND bound_at > NOW() - interval '120 seconds'")
[ "$S6_ROW" = "1" ] || fail "Step 6 agent_platform_sessions 无 role=burner 时间窗行" 6
ok "Step 6 ✅ 小号 $BURNER_LABEL 落库 role=burner（main/burner 物理隔离字段验证）"

# ───────────────────────────────────────────────────────────────────
# Step 7：中台检测登录态（GET /api/agent/burner/sessions）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 7: 中台读到已登录小号"
S7_TMP=$(mktemp)
S7_HTTP=$(curl -s -o "$S7_TMP" -w "%{http_code}" --max-time 15 \
  -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/sessions")
[ "$S7_HTTP" = "200" ] || fail "Step 7 burner/sessions expected 200, got $S7_HTTP: $(cat "$S7_TMP")" 7
grep -q "$BURNER_LABEL" "$S7_TMP" || fail "Step 7 sessions 列表未出现 $BURNER_LABEL: $(cat "$S7_TMP")" 7
ok "Step 7 ✅ 登录态检测通（中台能看到小号）"

# ───────────────────────────────────────────────────────────────────
# Step 8：评论区挖客闭环 · 采集+判定服务端真断言
# collect/start → agent report-videos（x-agent-id）→ judge-video 真调一次判定（#1267/#1271 修好的路径）
# 禁止 force_result/force_timeout：全 mock 零真调正是 #1269/#1271 漏过的根因。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 8: 采集派单 → 视频回报 → 真调内容判定"
S8_TMP=$(mktemp)
S8_HTTP=$(curl -s -o "$S8_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-装修"]}')
[ "$S8_HTTP" = "200" ] || fail "Step 8a collect/start expected 200, got $S8_HTTP: $(cat "$S8_TMP")" 8
TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S8_TMP" 2>/dev/null)
[ -n "$TASK_ID" ] || fail "Step 8a 无 task_id: $(cat "$S8_TMP")" 8
ok "Step 8a collect/start → task_id=$TASK_ID"

VIDEO_ID="p2smoke${RND//-/}"
S8_HTTP=$(curl -s -o "$S8_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$TASK_ID\",\"videos\":[{\"video_id\":\"$VIDEO_ID\",\"title\":\"p2 smoke 对标视频\"}]}")
[ "$S8_HTTP" = "200" ] || fail "Step 8b report-videos expected 200, got $S8_HTTP: $(cat "$S8_TMP")" 8
S8_ROW=$(psq "SELECT count(*) FROM zenithjoy.acquisition_collect_videos WHERE tenant_id='$TENANT_ID' AND video_id='$VIDEO_ID' AND created_at > NOW() - interval '120 seconds'")
[ "$S8_ROW" = "1" ] || fail "Step 8b acquisition_collect_videos 无本轮视频行" 8
ok "Step 8b report-videos（x-agent-id 真实调用方 shape）→ 视频行落库"

# 1x1 PNG（合法图片，多模态判定最小输入）
PNG_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
# 真调重试：LLM 上游偶发 >20s（服务端 JUDGMENT_TIMEOUT_MS）→ pending/gemini_timeout；
# 重试仍是真请求真响应（judgeVideo 对 pending 不缓存，每次重新真调）。禁止改用 force_*。
JUDGE_STATUS=""; JUDGE_REASON=""
for S8_TRY in 1 2 3; do
  S8_HTTP=$(curl -s -o "$S8_TMP" -w "%{http_code}" --max-time 60 \
    -X POST "$API_BASE/api/acquisition/judge-video" \
    -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
    -d "{\"video_id\":\"$VIDEO_ID\",\"capture_type\":\"screenshot\",\"data_b64\":\"$PNG_B64\"}")
  [ "$S8_HTTP" = "200" ] || fail "Step 8c judge-video expected 200, got $S8_HTTP: $(cat "$S8_TMP")" 8
  JUDGE_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['judgment_status'])" "$S8_TMP" 2>/dev/null)
  JUDGE_REASON=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data'].get('judgment_reason') or '')" "$S8_TMP" 2>/dev/null)
  case "$JUDGE_REASON" in
    force_result|no_api_key) fail "Step 8c reason=$JUDGE_REASON 不是真调（禁止 mock 顶替）" 8 ;;
  esac
  case "$JUDGE_STATUS" in
    matched|rejected) break ;;
    *) echo "  ↻ Step 8c 第 ${S8_TRY} 次真调未出结果（status=$JUDGE_STATUS reason=$JUDGE_REASON），5s 后重试"; sleep 5 ;;
  esac
done
case "$JUDGE_STATUS" in
  matched|rejected) : ;;
  *) fail "Step 8c 真调判定 3 次未出结果：status=$JUDGE_STATUS reason=${JUDGE_REASON}（no_api_key=API 进程缺 TOAPIS_API_KEY；pending=上游超时）" 8 ;;
esac
S8_ROW=$(psq "SELECT count(*) FROM zenithjoy.acquisition_collect_videos WHERE tenant_id='$TENANT_ID' AND video_id='$VIDEO_ID' AND judgment_status IN ('matched','rejected') AND updated_at > NOW() - interval '300 seconds'")
[ "$S8_ROW" = "1" ] || fail "Step 8c 判定结果未落库 acquisition_collect_videos.judgment_status" 8
ok "Step 8c judge-video 真调 → judgment_status=$JUDGE_STATUS 已落库（LLM 真请求真响应）"
ok "Step 8 ✅ 采集+判定服务端链路全通"

# ───────────────────────────────────────────────────────────────────
# Step 9：抓评论回填真实抖音号 → Lead 落库带号（铁律 5 回流：Seg3 私信 0 送达 bug）
#
# 复现的真 bug（2026-07-15 staging）：acquisition_leads 根本没有 douyin_id 列，
# 派单侧只能发 profile_url，而 Android 端 DouyinDmOutreachService:151-153 把收到的字段
# 【当抖音号往搜索框里搜】→ 拿 URL 搜必然 NO_MATCH → 私信段 0 送达。
#
# ⚠️ 真机段等价断言说明（铁律 5）：
#   「点评论人头像进主页读出抖音号」是 Android 真机 UIA 动作，本 smoke 不可及，
#   由 DouyinIdEnrichTest（extractDouyinId/enrichEntries/isBackAtCommentPanel/看门狗预算）
#   在 JVM 单测层守。此处守【真机之后的整条服务端链】：设备把号 POST 上来 → 落库 → 可派。
#   TODO(android-evaluator-channel): Android 真机通道落地后，由 xian-rog
#   e2e-line02-android-collect.yml（nightly 04:00）复跑「真机读号 → 上报」全链路。
#
# 注：本步显式传 grade，把 LLM 评级（gradeComment → OpenRouter）隔离在外——评级失败会
# 让 lead 整行不写入，掩盖本步真正要守的 douyin_id 判据。评级真调链由 Step 8c 覆盖。
# 显式 grade 是路由本就支持的入参（routes/acquisition.ts `c.grade || await gradeComment(...)`），
# 不改变 lead 落库路径本身。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 9: 抓评论回填抖音号 → Lead 落库带号"

# 9a：列必须真实存在（这正是生产缺的东西——读出号也无处可落）
S9_COL=$(psq "SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_leads' AND column_name='douyin_id' LIMIT 1")
[ "$S9_COL" = "1" ] || fail "Step 9a zenithjoy.acquisition_leads.douyin_id 列不存在（迁移未跑）——读出抖音号也无处可落，私信段必然 NO_MATCH" 9
ok "Step 9a ✅ acquisition_leads.douyin_id 列在库"

# 9b：拿真实 keyword_task_id（comment-score-result 按它反查租户）
S9_TMP=$(mktemp)
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/keyword-search" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keyword":"p2-smoke-装修"}')
[ "$S9_HTTP" = "200" ] || fail "Step 9b keyword-search expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
KW_TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['task_id'])" "$S9_TMP" 2>/dev/null)
[ -n "$KW_TASK_ID" ] || fail "Step 9b 无 task_id: $(cat "$S9_TMP")" 9
ok "Step 9b keyword-search → keyword_task_id=$KW_TASK_ID"

# 9c：设备上报「读到号」的评论 → lead 必须带号落库
S9_NICK="p2smokelead${RND//-/}"
S9_DYID="1689${RANDOM}${RANDOM}"
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$KW_TASK_ID\",\"video_url\":\"https://www.douyin.com/video/$VIDEO_ID\",\"comments\":[{\"commenter_id\":\"$S9_NICK\",\"text\":\"怎么联系你们\",\"grade\":\"高意向\",\"douyin_id\":\"$S9_DYID\"}]}")
[ "$S9_HTTP" = "200" ] || fail "Step 9c comment-score-result expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
S9_LEAD_DYID=$(psq "SELECT COALESCE(douyin_id,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S9_NICK' LIMIT 1")
[ "$S9_LEAD_DYID" = "$S9_DYID" ] || fail "Step 9c lead 未带真实抖音号落库：期望 '$S9_DYID' 实得 '$S9_LEAD_DYID'（派单将无号可发 → 设备 NO_MATCH）" 9
ok "Step 9c ✅ 设备上报 douyin_id=$S9_DYID → lead 带号落库"

# 9d 反向（宁可空，不可猜 — #1306）：没读到号的评论，绝不许编一个号出来
S9_NICK2="p2smokenull${RND//-/}"
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H "Content-Type: application/json" \
  -d "{\"keyword_task_id\":\"$KW_TASK_ID\",\"video_url\":\"https://www.douyin.com/video/$VIDEO_ID\",\"comments\":[{\"commenter_id\":\"$S9_NICK2\",\"text\":\"多少钱一平\",\"grade\":\"高意向\"}]}")
[ "$S9_HTTP" = "200" ] || fail "Step 9d comment-score-result expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
S9_LEAD2=$(psq "SELECT COALESCE(douyin_id,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S9_NICK2' LIMIT 1")
[ "$S9_LEAD2" = "<NULL>" ] || fail "Step 9d 设备没读到号，服务端却编了 douyin_id='$S9_LEAD2'（宁可空不可猜被破坏——猜出来的号会静默污染 Lead 表，正是 #1306 的病）" 9
ok "Step 9d ✅ 没读到号 → douyin_id 留空，未造假"
ok "Step 9 ✅ 抓评论 → 抖音号回填 Lead 服务端链路全通"

rm -f "$S1_TMP" "$S1_COOKIES" "$S2_TMP" "$S3_TMP" "$S5_TMP" "$S6_TMP" "$S7_TMP" "$S8_TMP" "$S9_TMP" 2>/dev/null
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Path 2 9 步本地版 smoke 全绿（服务端段）"
echo "  真机段：等 Android evaluator 通道（xian-rog nightly）接管复跑"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
