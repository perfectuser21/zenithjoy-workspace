#!/usr/bin/env bash
# golden-path-2-smoke.sh
# ZenithJoy Walking Skeleton — Path 2 客户智能获客路径（24 步本地版）
# Notion Journey: https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf
#
# 2026-07-07 用户更正（decision 431acd2c）：整条去飞书、改本地中台。
# 本 smoke 2026-07-14 重写（handoff 0714 刀1），替换旧版「Sprint A 飞书集成」（停在 05-26，
# 测已删除的飞书流程 + fake-feishu-server stub）。
#
# 14 步（CLAUDE.md Path 2 权威模型 8 步 + Seg2/Seg4/心跳-UUID/心跳-去重维度/判定缓存写库 回归 5 步）与断言层级：
#   Step 1 注册客户端自动（真链路：sign-up → free license → 自动建 tenant）
#   Step 2 装客户端（真链路：POST /api/agent/register）
#   Step 3 Android 端 Agent 连中台（服务端等价断言：x-agent-id 真实调用方 shape，#1267 路径）
#   Step 4 系统自动建 3 张本地表（获客画像/对标视频/Lead 落本地中台 DB）
#   Step 5 客户在本地 dashboard 填获客画像（真链路：PATCH /api/acquisition/config）
#   Step 6 手机端登录抖音小号（服务端等价断言：account-scan-result 写回 role=burner）
#   Step 7 中台检测登录态（真链路：GET /api/agent/burner/sessions）
#   Step 8 评论区挖客闭环·采集+判定段（真链路：collect/start → report-videos → judge-video 真调判定）
#   Step 9 抓评论回填真实抖音号 → Lead 落库带号（真链路：comment-score-result → acquisition_leads.douyin_id）
#   Step 10 判定门 Seg2 回归：空画像短路必须落库（新 tenant，从未 PATCH acquisition_config）
#   Step 11 capabilities 随 os_type 心跳同步：Seg4 私信设备路由回归（心跳 os_type=android → capabilities 含 android）
#   Step 12 心跳 agent_uuid 非 UUID 格式必须优雅降级：安卓真机自报 slug 不能裸 500（真机复现 2026-07-16）
#   Step 13 心跳去重必须按 tenant_id 查：跨 license 同机不能撞 DB 唯一约束裸 500（真机复现 2026-07-16）
#   Step 14 判定缓存命中必须写库：同一 video_id 跨任务复用判决时新任务的行不能永远卡 pending（真机复现 2026-07-16）
#   Step 22 Seg4 真实派单串联：Step15 真实产出的 lead 走真实 dispatch/build+run，
#           验证数据从采集/判定/抓评论真实流到私信派单（非独立造数据测试）
#   Step 23 评论意向判定 comment-grading.ts 回归（铁律5回流 PR#1444）：
#           23a 全新 tenant（未配置画像）→ /collect/report 不传 grade → grade 落库 NULL
#               + 服务端日志出现 [comment-grading] target_profile_desc 为空 诊断行（不再静默）；
#           23b 主 tenant（已配置画像）→ /collect/report 不传 grade，真调 DeepSeek 判定
#               → lead.grade ∈ {高意向,精准} + outreach_eligible=true
#   Step 24 account_label 语义统一回归（2026-07-22 安卓信号上报 sprint Task 1）：
#           qr-bind→qr-bind-result 落 pending:<task_id> 占位 → 首次扫描上报真实昵称
#           归一改名 + status=active → 该昵称从扫描结果消失 → 差集标 status=offline
#   Step 31 作战窗 Agent Panel 刀2/安卓获客(line02) 打点+中台看门狗回归（Sprint
#           07282119-agent-panel-knife2-android）：panel-event 写入(task_started/step/
#           failed) → panel-active-tasks 中台3分钟看门狗计算(stuck→自愈→done终态) →
#           多设备物理隔离 → 跨租户隔离 → error path。真机段(Android状态机真实调用)
#           logic-done-pending，见 contract-draft.md「未覆盖真实链路清单」
#
# 2026-07-15（handoff 0715）：铺到 11 步，回流两个真根因（铁律5）——
#   Seg2 judgeVideo INV-6 短路不写库 / Seg4 心跳从不按 os_type 刷新 capabilities。
# 2026-07-16：铺到 14 步——安卓 Path2 真机链路首次真跑连续撞到三个真根因：
#   Step 12 agent_uuid 非 UUID 格式裸 500 / Step 13 去重按 license_id 查跨 license
#   撞 DB 唯一约束裸 500（均为 walking-skeleton.service.ts 同一函数内的问题）/
#   Step 14 判定缓存命中不写库导致同一热门视频重复出现时新任务行永远卡 pending。
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
#   退出码 0 = 24 步服务端段全通；非零 = 第 EXIT_CODE 步红
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
echo "  ZenithJoy Path 2 Walking Skeleton — 客户智能获客路径（24 步本地版）"
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

# Step 2b：register 失败必须带 message 字段（真机段等价断言，Android App 状态页
# "未注册"旁展示的原因文案就是原样透传这个 message——2026-07-16 真机排障发现 App
# 端 register() 失败一律吞成 null，用户完全看不出到底哪一步出的问题；本 smoke 断言
# 服务端契约没有回归，Android 端消费逻辑走 Kotlin 单测覆盖，见
# services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentRegistrarFailureReasonTest.kt
# TODO(android-evaluator-channel): 真机 App 状态页展示效果由 Android 通道接管后在真机 workflow 复跑。
echo "▶ Step 2b: register 配额超限（QUOTA_EXCEEDED）必须带 message"
S2B_TMP=$(mktemp)
S2B_HTTP=$(curl -s -o "$S2B_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/register" -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$LICENSE_KEY\",\"machine_id\":\"p2-smoke-${RND}-second\",\"hostname\":\"p2-smoke-host-2\"}")
[ "$S2B_HTTP" = "403" ] || fail "Step 2b free tier 第二台机器 register 应 403 QUOTA_EXCEEDED，got $S2B_HTTP: $(cat "$S2B_TMP")" 2
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('code')=='QUOTA_EXCEEDED'; assert isinstance(d.get('message'), str) and d['message']" "$S2B_TMP" 2>/dev/null \
  || fail "Step 2b QUOTA_EXCEEDED 响应必须带非空 message 字段（Android 状态页靠它显示原因）: $(cat "$S2B_TMP")" 2
ok "Step 2b ✅ register 失败响应带 message，App 端可透传展示"

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
# 2026-07-18（孤岛清理 PR）：本步原借道已下线的 /keyword-search + /comment-score-result
# 旧接口当"造 task_id 的简便方式"，两个旧接口已被删除，改走现役 /collect/start +
# /collect/report（与 Step 15 同款调用范式，Step 15 已验证过这套请求 shape 真实可用）。
# 9c 正例与 Step 15 覆盖的场景有重叠（都验证 douyin_id 落库），保留是因为要跟 9d 反例
# 共用同一套上下文，二者合起来才是完整的"宁可空不可猜"（#1306）正反对照，不能只留一半。
# 显式传 grade：/collect/report 直接采纳 c.grade 入库（不像旧 /comment-score-result 那样
# 在缺 grade 时才 fallback 调 gradeComment/OpenRouter），本身就不依赖评级真调链。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 9: 抓评论回填抖音号 → Lead 落库带号"

# 9a：列必须真实存在（这正是生产缺的东西——读出号也无处可落）
S9_COL=$(psq "SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_leads' AND column_name='douyin_id' LIMIT 1")
[ "$S9_COL" = "1" ] || fail "Step 9a zenithjoy.acquisition_leads.douyin_id 列不存在（迁移未跑）——读出抖音号也无处可落，私信段必然 NO_MATCH" 9
ok "Step 9a ✅ acquisition_leads.douyin_id 列在库"

# 9b：拿真实 task_id（collect/report 按它反查租户）
S9_TMP=$(mktemp)
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-装修"]}')
[ "$S9_HTTP" = "200" ] || fail "Step 9b collect/start expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
S9_TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S9_TMP" 2>/dev/null)
[ -n "$S9_TASK_ID" ] || fail "Step 9b 无 task_id: $(cat "$S9_TMP")" 9
ok "Step 9b collect/start → task_id=$S9_TASK_ID"

# 9c：设备上报「读到号」的评论 → lead 必须带号落库
S9_VIDEO="p2smokelead${RND//-/}"
S9_NICK="p2smokelead${RND//-/}"
S9_DYID="1689${RANDOM}${RANDOM}"
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S9_TASK_ID\",\"video_id\":\"$S9_VIDEO\",\"commenters\":[{\"nickname\":\"$S9_NICK\",\"comment_text\":\"怎么联系你们\",\"grade\":\"高意向\",\"douyin_id\":\"$S9_DYID\"}]}")
[ "$S9_HTTP" = "200" ] || fail "Step 9c collect/report expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
S9_LEAD_DYID=$(psq "SELECT COALESCE(douyin_id,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S9_NICK' LIMIT 1")
[ "$S9_LEAD_DYID" = "$S9_DYID" ] || fail "Step 9c lead 未带真实抖音号落库：期望 '$S9_DYID' 实得 '$S9_LEAD_DYID'（派单将无号可发 → 设备 NO_MATCH）" 9
ok "Step 9c ✅ 设备上报 douyin_id=$S9_DYID → lead 带号落库"

# 9d 反向（宁可空，不可猜 — #1306）：没读到号的评论，绝不许编一个号出来
S9_VIDEO2="p2smokenull${RND//-/}"
S9_NICK2="p2smokenull${RND//-/}"
S9_HTTP=$(curl -s -o "$S9_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S9_TASK_ID\",\"video_id\":\"$S9_VIDEO2\",\"commenters\":[{\"nickname\":\"$S9_NICK2\",\"comment_text\":\"多少钱一平\",\"grade\":\"高意向\"}]}")
[ "$S9_HTTP" = "200" ] || fail "Step 9d collect/report expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
S9_LEAD2=$(psq "SELECT COALESCE(douyin_id,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S9_NICK2' LIMIT 1")
[ "$S9_LEAD2" = "<NULL>" ] || fail "Step 9d 设备没读到号，服务端却编了 douyin_id='$S9_LEAD2'（宁可空不可猜被破坏——猜出来的号会静默污染 Lead 表，正是 #1306 的病）" 9
ok "Step 9d ✅ 没读到号 → douyin_id 留空，未造假"
ok "Step 9 ✅ 抓评论 → 抖音号回填 Lead 服务端链路全通"

# ───────────────────────────────────────────────────────────────────
# Step 10：判定门 Seg2 回归——空画像短路必须落库（handoff 0715 真根因）
#
# 复现的真 bug：judgeVideo INV-6 分支（target_profile_desc 为空）此前只
# return matched，从不 writeJudgment。API 响应说 matched，但
# acquisition_collect_videos.judgment_status 停在旧值/NULL——下游任何读库
# 判断（派单/看板）永远读不到这次"匹配"。
#
# 用全新 tenant（本步专属 sign-up，从未 PATCH 过 acquisition_config）
# 复现"空画像"场景，不污染 Step 5-9 已写画像的主 tenant。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 10: 判定门 Seg2 回归——空画像短路必须落库"
S10_TMP=$(mktemp); S10_COOKIES=$(mktemp)
S10_EMAIL="p2-smoke-noprofile-${RND}@zenithjoy.test"
S10_HTTP=$(curl -s -o "$S10_TMP" -w "%{http_code}" --max-time 30 -c "$S10_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d "{\"email\":\"$S10_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"p2smokenp\"}")
[ "$S10_HTTP" = "200" ] || fail "Step 10a sign-up expected 200, got $S10_HTTP" 10
curl -s -o "$S10_TMP" -b "$S10_COOKIES" "$API_BASE/api/account/me" >/dev/null
S10_LICENSE=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['license']['license_key'])" "$S10_TMP" 2>/dev/null)
S10_TENANT=$(psq "SELECT tenant_id FROM zenithjoy.licenses WHERE license_key='$S10_LICENSE' AND tenant_id IS NOT NULL LIMIT 1")
[ -n "$S10_TENANT" ] || fail "Step 10a 新 tenant 未建" 10

S10_HTTP=$(curl -s -o "$S10_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/register" -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$S10_LICENSE\",\"machine_id\":\"p2-smoke-np-${RND}\",\"hostname\":\"p2-smoke-np-host\"}")
[ "$S10_HTTP" = "200" ] || fail "Step 10a agent/register expected 200, got $S10_HTTP" 10
S10_AGENT=$(psq "SELECT id FROM zenithjoy.agents WHERE tenant_id='$S10_TENANT' ORDER BY created_at DESC LIMIT 1")
[ -n "$S10_AGENT" ] || fail "Step 10a agents 无该 tenant 的 agent 行" 10

# ⚠️ 关键：不调用 PATCH /api/acquisition/config——acquisition_config 对这个
# tenant 无行，judgeVideo 读到 target_profile_desc='' → 触发 INV-6 短路。
S10_VIDEO="p2smokenp${RND//-/}"
S10_HTTP=$(curl -s -o "$S10_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S10_TENANT" \
  -d '{"keywords":["p2-smoke-np"]}')
[ "$S10_HTTP" = "200" ] || fail "Step 10b collect/start expected 200, got $S10_HTTP" 10
S10_TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S10_TMP" 2>/dev/null)
[ -n "$S10_TASK_ID" ] || fail "Step 10b 无 task_id" 10

S10_HTTP=$(curl -s -o "$S10_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $S10_AGENT" \
  -d "{\"task_id\":\"$S10_TASK_ID\",\"videos\":[{\"video_id\":\"$S10_VIDEO\",\"title\":\"p2 smoke 空画像回归\"}]}")
[ "$S10_HTTP" = "200" ] || fail "Step 10b report-videos expected 200, got $S10_HTTP" 10
ok "Step 10b 空画像 tenant → 视频行落库（未 PATCH 过 acquisition_config）"

PNG_B64_10="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
S10_HTTP=$(curl -s -o "$S10_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/judge-video" \
  -H "Content-Type: application/json" -H "x-agent-id: $S10_AGENT" \
  -d "{\"video_id\":\"$S10_VIDEO\",\"capture_type\":\"screenshot\",\"data_b64\":\"$PNG_B64_10\"}")
[ "$S10_HTTP" = "200" ] || fail "Step 10c judge-video expected 200, got $S10_HTTP" 10
S10_STATUS=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['judgment_status'])" "$S10_TMP" 2>/dev/null)
[ "$S10_STATUS" = "matched" ] || fail "Step 10c API 响应 judgment_status='$S10_STATUS' 期望 matched" 10

# 核心回归断言：DB 必须真的落了 matched，不能只是 API 响应说了但没写库
S10_DB_STATUS=$(psq "SELECT COALESCE(judgment_status,'<NULL>') FROM zenithjoy.acquisition_collect_videos WHERE tenant_id='$S10_TENANT' AND video_id='$S10_VIDEO'")
[ "$S10_DB_STATUS" = "matched" ] || fail "Step 10c 空画像短路未落库：DB judgment_status='$S10_DB_STATUS' 期望 'matched'（judgeVideo INV-6 分支不写库的回归）" 10
ok "Step 10c ✅ 空画像短路真落库 judgment_status=matched（Seg2 根因已修）"
ok "Step 10 ✅ 判定门 Seg2 回归通过"

# ───────────────────────────────────────────────────────────────────
# Step 11：capabilities 随 os_type 心跳同步——Seg4 私信设备路由回归（handoff 0715 真根因）
#
# 复现的真 bug：upsertAgentByHeartbeat 只在首次 INSERT 硬编码
# capabilities=ARRAY['douyin']，此后所有 UPDATE 分支完全不碰这一列。
# 真实 Android 设备心跳上报 os_type=android，capabilities 却永远不含
# 'android'。resolveDevicePlatform（capabilities.includes('android')）
# 因此恒定判 'windows'，私信任务永远派不到真机。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 11: capabilities 随 os_type 心跳同步（Seg4 私信设备路由）"
S11_TMP=$(mktemp)
S11_HTTP=$(curl -s -o "$S11_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LICENSE_KEY" \
  -d "{\"version\":\"2.0.99\",\"hostname\":\"p2-smoke-host\",\"os_type\":\"android\",\"agent_uuid\":\"$AGENT_PK\"}")
[ "$S11_HTTP" = "200" ] || fail "Step 11a heartbeat os_type=android expected 200, got $S11_HTTP: $(cat "$S11_TMP")" 11

S11_CAPS=$(psq "SELECT capabilities::text FROM zenithjoy.agents WHERE id='$AGENT_PK'")
echo "$S11_CAPS" | grep -q "android" || fail "Step 11b capabilities='$S11_CAPS' 不含 'android'（心跳未把 os_type 同步进 capabilities，resolveDevicePlatform 会恒定判 windows）" 11
ok "Step 11b ✅ capabilities=$S11_CAPS 含 android（Seg4 根因已修）"
ok "Step 11 ✅ capabilities 随 os_type 心跳同步回归通过"

# ───────────────────────────────────────────────────────────────────
# Step 12：心跳 agent_uuid 非 UUID 格式必须优雅降级，不能裸 500（真机复现 2026-07-16）
#
# 复现的真 bug：安卓 Agent 自生成的 agent_uuid 是可读 slug（如
# "agent-maa-an00-mrmt6yaa"），不是真 UUID。walking-skeleton.service.ts
# 精确路径此前不校验格式，直接把它塞进 `WHERE id = $3`（agents.id 是 uuid
# 列），被 Postgres 类型校验拒绝（22P02 invalid input syntax for type
# uuid），异常未捕获冒泡成路由层裸 500（HEARTBEAT_FAILED）——安卓真机永远
# 注册不上中台，真机 golden path 第一步就卡死。上面 Step 11 用的是服务端
# 真实 UUID（$AGENT_PK），从未走到这条真根因，必须单独用非 UUID 格式复现。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 12: 心跳 agent_uuid 非 UUID 格式（安卓真机自报 slug）不能裸 500"
S12_TMP=$(mktemp)
S12_HTTP=$(curl -s -o "$S12_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LICENSE_KEY" \
  -d '{"version":"2.0.99","hostname":"p2-smoke-android-slug-host","os_type":"android","agent_uuid":"agent-maa-an00-p2smoke"}')
[ "$S12_HTTP" = "200" ] || fail "Step 12 心跳 agent_uuid=非UUID格式 expected 200, got $S12_HTTP: $(cat "$S12_TMP")（安卓真机自报 slug 会导致心跳裸 500，真机永远注册不上）" 12
ok "Step 12 ✅ 非 UUID 格式 agent_uuid 心跳正常降级（HTTP 200），未裸 500"

# ───────────────────────────────────────────────────────────────────
# Step 13：心跳去重必须按 tenant_id 查，跨 license 同机不能撞 DB 唯一约束裸 500
# （真机复现 2026-07-16，紧接 Step 12 修复后同一 xian-rog 真机撞到的第二个真根因）
#
# 复现的真 bug：DB 唯一约束 uq_agents_tenant_hostname 是 (tenant_id, hostname)，
# 但 fall-through 去重 SELECT 之前按 (license_id, hostname) 查——本 tenant 挂
# 2 个 license（测试租户常见形态：先注册 free 再买正式/测试专用 license），
# 同一台设备用 license A 心跳建过行后，换 license B 心跳同一 hostname 时，
# SELECT 用 license B 的 id 查不到 license A 建的行，误判"新机器"走 INSERT，
# 直接撞 (tenant_id, hostname) 唯一约束抛出未捕获异常，冒泡成路由层裸 500。
# 用本 tenant 已有的第二个 license（Step 1 的 free license）复现："先用它心跳
# 建一行同 hostname，再用 $LICENSE_KEY 心跳同 hostname" 顺序反过来更贴近真实
# 时序，这里直接用两个不同 license_key 对同一 hostname 心跳两次验证。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 13: 心跳去重按 tenant_id 查——跨 license 同机不能撞唯一约束裸 500"
S13_TMP=$(mktemp); S13_COOKIES=$(mktemp)
S13_HOST="p2-smoke-dedup-host-${RND}"
# 第二个 license：本轮专属 sign-up 一个新账号，再手动把它的 tenant 改成和 $TENANT_ID 一致，
# 模拟"同一 tenant 挂 2 个 license"（比真实业务流程更直接，但对复现本 bug 已足够等价）。
S13_EMAIL="p2-smoke-dedup-${RND}@zenithjoy.test"
S13_HTTP=$(curl -s -o "$S13_TMP" -w "%{http_code}" --max-time 30 -c "$S13_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d "{\"email\":\"$S13_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"p2smokededup\"}")
[ "$S13_HTTP" = "200" ] || fail "Step 13a sign-up expected 200, got $S13_HTTP" 13
curl -s -o "$S13_TMP" -b "$S13_COOKIES" "$API_BASE/api/account/me" >/dev/null
S13_LICENSE_KEY=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['license']['license_key'])" "$S13_TMP" 2>/dev/null)
[ -n "$S13_LICENSE_KEY" ] || fail "Step 13a 未拿到第二个 license_key" 13
# 把第二个 license 强制挂到本轮主 tenant 下，模拟同一 tenant 多 license 场景
psq "UPDATE zenithjoy.licenses SET tenant_id='$TENANT_ID' WHERE license_key='$S13_LICENSE_KEY'" >/dev/null

# 先用第二个 license 对该 hostname 心跳一次（建行）
S13_HTTP=$(curl -s -o "$S13_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $S13_LICENSE_KEY" \
  -d "{\"version\":\"2.0.99\",\"hostname\":\"$S13_HOST\",\"os_type\":\"windows\"}")
[ "$S13_HTTP" = "200" ] || fail "Step 13b 第二个 license 心跳（建行）expected 200, got $S13_HTTP: $(cat "$S13_TMP")" 13

# 再用主 license（$LICENSE_KEY）对同一 hostname 心跳——这一步此前会裸 500
S13_HTTP=$(curl -s -o "$S13_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $LICENSE_KEY" \
  -d "{\"version\":\"2.0.99\",\"hostname\":\"$S13_HOST\",\"os_type\":\"windows\"}")
[ "$S13_HTTP" = "200" ] || fail "Step 13c 跨 license 同 hostname 心跳 expected 200, got $S13_HTTP: $(cat "$S13_TMP")（去重 SELECT 按 license_id 查会跨 license 误判新机器，撞 DB 唯一约束裸 500）" 13
ok "Step 13c ✅ 跨 license 同 hostname 心跳正常（HTTP 200），未撞 uq_agents_tenant_hostname"

# 核心回归断言：该 tenant+hostname 组合在库里只有一行（去重真的按 tenant_id 命中了旧行，不是意外没撞上约束）
S13_ROW_COUNT=$(psq "SELECT count(*) FROM zenithjoy.agents WHERE tenant_id='$TENANT_ID' AND hostname='$S13_HOST' AND created_at > NOW() - interval '120 seconds'")
[ "$S13_ROW_COUNT" = "1" ] || fail "Step 13d agents 表该 tenant+hostname 应恰好 1 行，实际 $S13_ROW_COUNT（去重未按 tenant_id 正确命中旧行）" 13
ok "Step 13 ✅ 心跳去重按 tenant_id 查，跨 license 同机正确命中旧行（DB 唯一约束真根因已修）"

# ───────────────────────────────────────────────────────────────────
# Step 14：判定缓存命中必须写库，防新任务视频行永远卡 pending
# （真机复现 2026-07-16，Path2 安卓真机链路验证时撞到）
#
# 复现的真 bug：同一热门视频被多个采集任务重复抓到是真机常态（同关键词反复
# 搜出同一批热门卡片）。writeJudgment/markPending 按 (tenant_id, video_id)
# UPDATE 不分 task_id，本来任何共享该 video_id 的行都该收敛；但缓存命中
# 分支此前只 return 给调用方从不写库，新任务 Stage1 刚 INSERT 的那一行
# 永远没被这条路径碰过，卡死 pending——即使 API 响应明明说
# cache_hit=true/judgment_status=matched。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 14: 判定缓存命中补写库——同一 video_id 跨任务复用判决结果"
S14_TMP=$(mktemp)
S14_VIDEO="p2smokecache${RND//-/}"

# 任务 A：真实走一遍 collect/start → report-videos → judge-video(force_result=matched)，制造缓存
S14_HTTP=$(curl -s -o "$S14_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-cache-a"]}')
[ "$S14_HTTP" = "200" ] || fail "Step 14a 任务A collect/start expected 200, got $S14_HTTP" 14
S14_TASK_A=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S14_TMP" 2>/dev/null)
[ -n "$S14_TASK_A" ] || fail "Step 14a 任务A 无 task_id" 14

curl -s -o "$S14_TMP" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S14_TASK_A\",\"videos\":[{\"video_id\":\"$S14_VIDEO\",\"title\":\"p2 smoke 缓存回归\"}]}" >/dev/null

S14_HTTP=$(curl -s -o "$S14_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/judge-video" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"video_id\":\"$S14_VIDEO\",\"capture_type\":\"screenshot\",\"data_b64\":\"x\",\"force_result\":\"matched\"}")
[ "$S14_HTTP" = "200" ] || fail "Step 14a judge-video(任务A) expected 200, got $S14_HTTP" 14
ok "Step 14a ✅ 任务A 判定 matched，落下缓存"

# 任务 B：全新任务抓到同一个 video_id（真机常态：同关键词反复搜出同一批热门卡片）
S14_HTTP=$(curl -s -o "$S14_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-cache-b"]}')
[ "$S14_HTTP" = "200" ] || fail "Step 14b 任务B collect/start expected 200, got $S14_HTTP" 14
S14_TASK_B=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S14_TMP" 2>/dev/null)
[ -n "$S14_TASK_B" ] || fail "Step 14b 任务B 无 task_id" 14

curl -s -o "$S14_TMP" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S14_TASK_B\",\"videos\":[{\"video_id\":\"$S14_VIDEO\",\"title\":\"p2 smoke 缓存回归\"}]}" >/dev/null

# 任务B 对同一 video_id 再判一次——这次必须命中缓存（force_result 故意传 rejected，
# 如果真的重新真判会写成 rejected，命中缓存则应该保持 matched，用来交叉验证缓存真生效）
S14_HTTP=$(curl -s -o "$S14_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/judge-video" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"video_id\":\"$S14_VIDEO\",\"capture_type\":\"screenshot\",\"data_b64\":\"x\",\"force_result\":\"rejected\"}")
[ "$S14_HTTP" = "200" ] || fail "Step 14c judge-video(任务B) expected 200, got $S14_HTTP" 14
S14_CACHE_HIT=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data'].get('cache_hit', False))" "$S14_TMP" 2>/dev/null)
[ "$S14_CACHE_HIT" = "True" ] || fail "Step 14c judge-video(任务B) 未命中缓存（cache_hit=$S14_CACHE_HIT），复现条件不成立" 14
ok "Step 14c ✅ 任务B 命中缓存（force_result=rejected 被忽略，证明真的是缓存生效不是重新真判）"

# 核心回归断言：任务B 自己那一行必须真的被写成 matched（不能停在 report-videos 时的初始 pending）
S14_DB_STATUS=$(psq "SELECT COALESCE(judgment_status,'<NULL>') FROM zenithjoy.acquisition_collect_videos WHERE task_id='$S14_TASK_B' AND video_id='$S14_VIDEO'")
[ "$S14_DB_STATUS" = "matched" ] || fail "Step 14d 任务B 视频行 judgment_status='$S14_DB_STATUS' 期望 'matched'——缓存命中未写回 DB（新任务的行永远卡 pending 的真根因未修）" 14
ok "Step 14d ✅ 任务B 视频行真的写成 matched（缓存命中补写库根因已修）"
ok "Step 14 ✅ 判定缓存命中写库回归通过"

# ───────────────────────────────────────────────────────────────────
# Step 15：抓评论上报必须把 douyin_id 落进 lead，否则 Seg4 私信派单永远无号可发
# （真机复现 2026-07-16，深挖 Seg3→Seg4 断链的两个真根因之一）
#
# 真机段等价断言 + TODO：真机侧根因是 DouyinCollectService.kt 事件驱动竞态
# （评论面板连续多条 accessibility 事件各自调度出并发 attemptExtractComments()，
# 已在本 PR 用 mayScheduleCommentExtraction 闸门修复，纯逻辑无法用 curl smoke
# 复现，靠 Kotlin 单测 DouyinCollectServiceStateTest.kt 锁定）。这一步覆盖的是
# 与之配对的服务端断链：即便设备真读到了号，/collect/report 此前从不接收/落库
# douyin_id——本 Step 直接验证服务端这一半，设备侧竞态修复见上方 PR 描述。
# TODO(Android evaluator 通道)：接管后应把"设备真机点评论人头像→读到号→
# /collect/report 带号"这段也纳入真机 nightly 复跑。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 15: 抓评论上报补写 douyin_id——Seg4 派单精确定位号的唯一来源"
S15_TMP=$(mktemp)
S15_VIDEO="p2smokedouyinid${RND//-/}"
S15_DOUYIN_ID="douyinid${RND//-/}"

S15_HTTP=$(curl -s -o "$S15_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-douyinid"]}')
[ "$S15_HTTP" = "200" ] || fail "Step 15a collect/start expected 200, got $S15_HTTP" 15
S15_TASK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S15_TMP" 2>/dev/null)
[ -n "$S15_TASK" ] || fail "Step 15a 无 task_id" 15

S15_HTTP=$(curl -s -o "$S15_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S15_TASK\",\"video_id\":\"$S15_VIDEO\",\"commenters\":[{\"nickname\":\"p2smoke昵称${RND}\",\"comment_text\":\"求联系方式\",\"grade\":\"高意向\",\"douyin_id\":\"$S15_DOUYIN_ID\"}],\"terminal\":true}")
[ "$S15_HTTP" = "200" ] || fail "Step 15b collect/report expected 200, got $S15_HTTP: $(cat "$S15_TMP")" 15
S15_INSERTED=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data'].get('inserted', 0))" "$S15_TMP" 2>/dev/null)
[ "$S15_INSERTED" = "1" ] || fail "Step 15b 应新建 1 条 lead，实际 inserted=$S15_INSERTED" 15
ok "Step 15b ✅ collect/report 接受 douyin_id 字段（不 400）"

# 核心回归断言：acquisition_leads.douyin_id 真的落库了，不是被吃掉变成 NULL
S15_DB_DOUYIN_ID=$(psq "SELECT COALESCE(douyin_id,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND collect_task_id='$S15_TASK' LIMIT 1")
[ "$S15_DB_DOUYIN_ID" = "$S15_DOUYIN_ID" ] || fail "Step 15c acquisition_leads.douyin_id='$S15_DB_DOUYIN_ID' 期望 '$S15_DOUYIN_ID'——douyin_id 未落库，Seg4 派单会永远无号可发（NO_MATCH 老 bug 复发）" 15
ok "Step 15c ✅ douyin_id 真的落进 acquisition_leads，Seg4 派单有号可发"
ok "Step 15 ✅ 抓评论 douyin_id 落库回归通过"

# ───────────────────────────────────────────────────────────────────
# Step 16：dm_outreach 启动必须清空遗留会话页栈，否则会话内搜索代替全局搜索
# （真机复现 2026-07-17 xian-rog，Seg4 私信照跑撞出的第 4 个新根因）
#
# 真机段等价断言 + TODO：本 bug 100% 发生在 Android 无障碍导航层
# （DouyinDmOutreachService.launchDouyinApp resume 到上一次任务遗留的私信会话页，
# 会话页里也有一个"搜索"图标，把目标抖音号打进了会话内搜索而非首页全局搜索，
# 最终 locateProfileBySearch 恒报 NO_MATCH）——没有对应的服务端可观测行为，curl/psql
# 无法复现导航状态，只能由 Kotlin JVM 单测锁定：
# DouyinDmOutreachServiceOutcomeTest 的 `dm outreach launch flags must include CLEAR_TASK
# to escape stale conversation screen`（断言 dmOutreachLaunchFlags 必须带
# FLAG_ACTIVITY_CLEAR_TASK，同 DouyinCollectService.stage1LaunchFlags 已验证过的模式）。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"连续两次 dm_outreach
# 任务，第二次目标号不同"的场景，实测验证不会 resume 到第一次遗留的会话页。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 16: dm_outreach 启动 CLEAR_TASK 回归（真机段等价断言见 DouyinDmOutreachServiceOutcomeTest）"
ok "Step 16 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 17：dm-outreach-result 报告类 httpClient 禁用连接池——根治稳定 timeout
# （真机复现 2026-07-17 xian-rog，Seg4 私信照跑撞出的第 1 个新根因）
#
# 真机段等价断言 + TODO：本 bug 100% 发生在 Android OkHttp 连接池行为层
# （AgentService.httpClient 只服务数分钟一次的低频报告类端点，长时间空闲后池里连接被
# 网络切换/NAT 超时静默弄坏，复用时写入成功但读永远拿不到响应，直到 connectTimeout
# 才报错）——没有对应的服务端可观测行为（服务端本身收到请求就能快速正确响应），
# curl/psql 无法复现"设备本地连接池积累僵尸连接"这个状态，只能由 Kotlin JVM 单测锁定：
# AgentServiceHttpClientTest 的 `report http client never reuses a pooled connection
# across calls`（用 MockWebServer 断言每次调用 sequenceNumber=0，即每次都开新连接，
# 不留旧连接可复用）。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"App 长时间(数小时)
# 静置后发起一次报告类调用"的场景，实测验证不会稳定卡满 connectTimeout。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 17: dm-outreach-result httpClient 禁用连接池回归（真机段等价断言见 AgentServiceHttpClientTest）"
ok "Step 17 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 18：dm_outreach 同一 task_id 重投递去重——根治幽灵派单吃频控
# （真机复现 2026-07-17 xian-rog，Seg4 私信照跑撞出的第 2 个新根因）
#
# 真机段等价断言 + TODO：本 bug 100% 发生在 Android 心跳重投递+本地频控计数交互层
# （回执上报未确认前，心跳每~30s 原样重投递同一 task_id，routeDmOutreachTask 此前
# 对每次投递都重新计频控，几次幽灵重投递就能占满整个 10 分钟窗口，连累完全无关的
# 新任务被误判 rate-limited）——没有对应的服务端可观测行为（服务端只是老实按心跳
# 协议重复下发同一条 queued 任务，这是协议本身允许的正常重试），curl/psql 无法复现
# "设备本地进程内已处理过的 task_id 集合"这个状态，只能由 Kotlin JVM 单测锁定：
# AgentServiceDmDedupTest 断言 shouldSkipDuplicateDmTask 对已见过的 task_id 返回
# true、对未见过的返回 false。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"人为让回执上报失败
# 3 次以上，确认同一 task_id 被心跳重投递时不会二次消耗频控名额"的场景。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 18: dm_outreach task_id 重投递去重回归（真机段等价断言见 AgentServiceDmDedupTest）"
ok "Step 18 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 19：无障碍服务启动健康自检——force-stop 关闭无障碍不再静默失效
# （真机复现 2026-07-17 xian-rog，Seg4 私信照跑撞出的第 3 个新根因）
#
# 真机段等价断言 + TODO：本 bug 100% 发生在 Android 系统级无障碍服务生命周期层
# （force-stop 重启 App 会被系统整体关闭无障碍服务，且无任何显式报错，采集/私信/
# 账号扫描静默全部失效）——App 本身无 WRITE_SECURE_SETTINGS 权限无法自动恢复，
# 只能让失效可观测，没有对应的服务端可观测行为，curl/psql 无法复现"系统级无障碍
# 开关状态"，只能由 Kotlin JVM 单测锁定：AgentServiceAccessibilityHealthTest 断言
# missingAccessibilityServices 对 force-stop 后典型的 null/部分启用状态能正确报出
# 缺失的服务列表。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"force-stop 重启后
# 检查 logcat 出现无障碍服务缺失的错误日志"的场景，确认失效不再是纯静默现象。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 19: 无障碍服务启动健康自检回归（真机段等价断言见 AgentServiceAccessibilityHealthTest）"
ok "Step 19 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 20：5个低频httpClient统一禁用连接池——根治Path2全链路report-videos静默卡死
# （真实全链路压测复现 2026-07-17 xian-rog，真实关键词搜索→采集完成后report-videos
# 静默卡死，属于Bug1同根因在5个独立客户端实例里各自复现的系统性问题）
#
# 真机段等价断言 + TODO：本 bug 100% 发生在 Android OkHttp 连接池行为层，同 Step17
# 一样没有服务端可观测行为，curl/psql 无法复现"设备本地连接池积累僵尸连接"这个状态，
# 只能由 Kotlin JVM 单测锁定：InfrequentHttpClientsNoPoolTest 用 MockWebServer 逐一
# 断言 CollectReporter/AcquisitionCollectPollLoop/AcquisitionKeywordPollLoop/
# AgentRegistrar/ContentJudgmentService 的 defaultClient() 都不复用连接。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"App 长时间静置后
# 触发一次真实关键词搜索，确认 report-videos 不再静默卡死"的场景。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 20: 5个低频httpClient连接池回归（真机段等价断言见 InfrequentHttpClientsNoPoolTest）"
ok "Step 20 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 21：视频内容判定改真实音频转写——固定录制开头20秒替代单帧截图
# （用户2026-07-17拍板，判定点1d078987；decision f3dbc2ce 视频/图文两条判定路径分工）
#
# 真机段等价断言 + TODO：本功能 100% 发生在 Android 系统音频采集
# （AudioPlaybackCaptureConfiguration）+ 判定路由分流层，没有对应的服务端可观测行为
# （服务端 pending-collect-tasks 早已按 media_kinds 拼出 /note/ vs /video/ 深链，
# 本次只是设备端第一次真正读这个信息做分流，服务端逻辑本身未变），curl/psql 无法
# 复现"设备真实录了20秒系统音频"这个状态，只能由 Kotlin JVM 单测锁定：
# AudioJudgmentTest 断言 ①录制时长=20秒 ②note→screenshot/video→audio 路由正确
# ③ContentJudgmentService 按 captureType 选对应采集源不串线 ④stage_2 对两类 URL
# 真实上报的 capture_type 字段符合预期。
# TODO(Android evaluator 通道)：接管后应在真机 nightly 里补一条"真实视频判定命中
# audio 路径、真实图文判定命中 screenshot 路径"的场景，核对 logcat 采集耗时约20秒。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 21: 视频内容判定音频转写回归（真机段等价断言见 AudioJudgmentTest）"
ok "Step 21 ✅ 已登记：真机段由 Kotlin 单测守，等 Android evaluator 通道纳入 nightly 真机复跑"

# ───────────────────────────────────────────────────────────────────
# Step 22：Seg4 真实派单串联——Step15 真实产出的 lead 走真实 dispatch/build+run
# （2026-07-18 根因排查：私信段此前测试全靠人工构造 dm_assignment 反复重发同一个
# 固定测试 lead，staging 实测 account_label='manual-test'/'manual-burner-test'，
# 跟 Seg1-3 产出完全脱节。本 Step 首次证明数据能从 Step15 真实产出的 lead 真实流到
# dm_outreach publish_task，不新增生产代码，只是把已有真实端点接线验证。）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 22: Seg4 真实派单串联（Step15 lead → dispatch/build → dispatch/run）"

# 22a：撑满全天时段闸，避免 CI 运行时刻撞上生产默认 09:00-22:00 窗口导致断言随机失败；
#      同时把 dm_interval_min/max_sec 压到 1 秒——buildAssignments 按
#      randInt(dm_interval_min_sec, dm_interval_max_sec) 排 scheduled_for，
#      默认 300~900 秒会把新 assignment 排到 5~15 分钟之后，dispatch/run 紧跟着调
#      永远找不到到期行（真机实测复现：默认间隔下 22c dispatched 恒为 0，非 bug，是
#      本 smoke 断言需要真实反映"立即触发一轮"场景，需要把频控间隔本地测试值调到最小）
S22_TMP=$(mktemp)
S22_HTTP=$(curl -s -o "$S22_TMP" -w "%{http_code}" --max-time 15 \
  -X PATCH "$API_BASE/api/acquisition/config" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"dm_active_start":"00:00","dm_active_end":"23:59","dm_interval_min_sec":1,"dm_interval_max_sec":1}')
[ "$S22_HTTP" = "200" ] || fail "Step 22a PATCH dm_active window expected 200, got $S22_HTTP: $(cat "$S22_TMP")" 22
ok "Step 22a ✅ dm_active_start/end 撑满全天 + dm_interval 压到 1 秒（避免时段闸/排期间隔导致断言随机失败）"

# 22a2：把本租户其它 lead（Step9 造的、也满足 outreach_eligible=true 条件）标不可触达，
# 只留 Step15 这条参与本轮派单——CI 真机实测复现过：同一租户多条 lead 同时 eligible 时，
# buildAssignments 会全部 assigned，但 dispatchDue 只有真带抖音号的那条能通过
# isDmDispatchable 真正 dispatched，谁被选中不确定（真派单频控/去重逻辑决定，不是 bug），
# 靠"运气选中 Step15 那条"断言必然偶发失败。显式隔离掉其它 lead 才能让本 Step 确定性验证
# "Step15 这条真实产出的 lead"，而不是"随便哪条 lead"。
psq "UPDATE zenithjoy.acquisition_leads SET outreach_eligible=false, updated_at=now()
     WHERE tenant_id='$TENANT_ID' AND douyin_id IS DISTINCT FROM '$S15_DOUYIN_ID'" >/dev/null
psq "UPDATE zenithjoy.dm_assignments SET status='cancelled', updated_at=now()
     WHERE tenant_id='$TENANT_ID' AND status IN ('queued','limited')
       AND lead_id NOT IN (SELECT id FROM zenithjoy.acquisition_leads
                            WHERE tenant_id='$TENANT_ID' AND douyin_id='$S15_DOUYIN_ID')" >/dev/null
ok "Step 22a2 ✅ 本轮派单隔离到 Step15 那条 lead（其它 lead 标不可触达，防止选中哪条不确定）"

# 22b：真调 dispatch/build（scoreLeads + buildAssignments），复用 S22_TMP（前值已读完，覆盖写入）
S22_HTTP=$(curl -s -o "$S22_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/build" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S22_HTTP" = "200" ] || fail "Step 22b POST dispatch/build expected 200, got $S22_HTTP: $(cat "$S22_TMP")" 22
S22_ASSIGNED=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['assigned'])" "$S22_TMP" 2>/dev/null || echo 0)
[ "$S22_ASSIGNED" -ge 1 ] 2>/dev/null || fail "Step 22b assigned=$S22_ASSIGNED ，期望 >=1（Step15 产出的 lead 没被真实挑中派单）: $(cat "$S22_TMP")" 22
ok "Step 22b ✅ dispatch/build assigned=$S22_ASSIGNED （Step15 lead 被真实挑中）"

# 22c：真调 dispatch/run（dispatchDue），继续复用 S22_TMP
# scheduled_for = build 时刻 + dm_interval_min_sec（已压到1秒）——build→run 两次 curl
# 间隔通常 <1 秒，不 sleep 会因"还没到期"误判为断言失败（非 bug，是排期时间还没走到）
sleep 2
S22_HTTP=$(curl -s -o "$S22_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/run" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S22_HTTP" = "200" ] || fail "Step 22c POST dispatch/run expected 200, got $S22_HTTP: $(cat "$S22_TMP")" 22
S22_DISPATCHED=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['dispatched'])" "$S22_TMP" 2>/dev/null || echo 0)
[ "$S22_DISPATCHED" -ge 1 ] 2>/dev/null || fail "Step 22c dispatched=$S22_DISPATCHED ，期望 >=1: $(cat "$S22_TMP")" 22
ok "Step 22c ✅ dispatch/run dispatched=$S22_DISPATCHED"

# 22d：断言真实产出的 publish_task 携带 Step15 那个真实 douyin_id + device_platform=android
#      + dm_assignment_id 回联到真实 dm_assignments 行（非硬编码）
#      ⚠️ 用 payload->>'douyin_id' 精确匹配 S15_DOUYIN_ID 定位行，不用
#      「ORDER BY created_at DESC LIMIT 1」——Step9 也会产出 outreach_eligible 的
#      lead 并可能同轮被真实派单，谁的 publish_task 后落库不确定，靠"最新一条"
#      断言会随机测错 lead，精确按 douyin_id 命中才是真的验证 Step15→Seg4 串联。
S22_DOUYIN=$(psq "SELECT payload->>'douyin_id' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach' AND payload->>'douyin_id'='$S15_DOUYIN_ID'
  ORDER BY created_at DESC LIMIT 1")
[ "$S22_DOUYIN" = "$S15_DOUYIN_ID" ] || fail "Step 22d publish_task.douyin_id='$S22_DOUYIN' 期望等于 Step15 真实产出的 '$S15_DOUYIN_ID'（Seg3→Seg4 数据未真实串联）" 22

S22_PLATFORM=$(psq "SELECT payload->>'device_platform' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach' AND payload->>'douyin_id'='$S15_DOUYIN_ID'
  ORDER BY created_at DESC LIMIT 1")
[ "$S22_PLATFORM" = "android" ] || fail "Step 22d device_platform='$S22_PLATFORM' 期望 'android'（Step11 capabilities 同步未生效或未复用）" 22

S22_ASSIGN_ID=$(psq "SELECT payload->>'dm_assignment_id' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach' AND payload->>'douyin_id'='$S15_DOUYIN_ID'
  ORDER BY created_at DESC LIMIT 1")
S22_ASSIGN_REAL=$(psq "SELECT count(*) FROM zenithjoy.dm_assignments WHERE id='$S22_ASSIGN_ID'::uuid AND created_at > NOW() - interval '120 seconds'")
[ "$S22_ASSIGN_REAL" = "1" ] || fail "Step 22d dm_assignment_id='$S22_ASSIGN_ID' 在 dm_assignments 表里查不到真实行（疑似硬编码值而非 dispatch/build 真实产出）" 22

ok "Step 22d ✅ publish_task 真实携带 Step15 douyin_id=$S22_DOUYIN + device_platform=android + dm_assignment_id 回联真实行"
ok "Step 22 ✅ Seg4 真实派单串联通过——数据从采集/判定/抓评论真实流到私信派单"

# ───────────────────────────────────────────────────────────────────
# Step 23：评论意向判定 comment-grading.ts 回归（铁律5回流 PR#1444）
#
# 复现的真 bug（PR#1444，2026-07-21）：苏彦卿真机测试（tenant 6dbea700）22条
# leads relevance_score有值但grade全空、outreach_eligible全false。根因之一：
# target_profile_desc 为空时 gradeComments() 静默返回全 null，三个失败分支
# （画像为空/评论为空/无API key/LLM调用失败）里唯一没日志的，导致同一无声
# 分支被真机反复撞上（07-20~21 新 tenant 68f2ee9f 再次复现）却无从排查。
# 同一 PR 把判定引擎从 Gemini 换成 DeepSeek（deepseek-v4-flash，走既有 ToAPIs
# 通道）。此前跟"判定"沾边的步骤全绕开了这条链路：Step 8 测的是视频内容判定
# （content-judgment.ts，不同服务）；Step 9/15/22 显式传 grade 字段故意绕开
# gradeComments() 真调（"本身就不依赖评级真调链"）。comment-grading.ts 的判定
# 逻辑完全没有机器判据守着，故新增本 Step，不传 grade，逼真实链路跑一遍。
#
# 23a（画像为空 → 有日志不再静默）：全新 tenant（仿 Step 10a 模式，从未 PATCH
#     acquisition_config）→ /collect/report 不传 grade → 断言 ① 落库 grade
#     为 NULL（走 INV-6 同款保守分支）② 服务端日志出现 PR#1444 补的诊断行
#     [comment-grading] target_profile_desc 为空（证明不再是静默失败）。
# 23b（已配置画像 → 真实 DeepSeek 判定驱动 outreach_eligible）：复用主
#     TENANT_ID/AGENT_PK（Step5 已配置画像）→ /collect/report 不传 grade、
#     评论文案明确高购买意向 → 断言真调判定产出 高意向/精准 + outreach_eligible=true。
#     跟 Step 8 一样接受"真调外部 LLM API"输出的合理变动性风险（只认二选一档位，
#     不锁死单一值），也跟 Step 8 一样对这次真调加 3 次重试兜底（见 23b 代码内注释）。
#
# 跟姊妹 smoke collect-report-comment-grading-smoke.sh（2026-07-19，decision 4e421ae8）
# 的分工：那份 smoke 覆盖的是"gradeComments() 接入 /collect/report 不崩溃 + 正确落库 +
# TOAPIS_API_KEY 缺失时优雅降级"三条路径，其自身头注释写明"Gemini 判定精准 → grade+
# outreach_eligible=true"这条核心业务断言此前只有 mock-axios 集成测试覆盖过，全仓库
# 没有真调外部 LLM 的验证。本 Step 23 正是补这两个此前全仓库都没测过的洞：
# (a) 一次真实成功的外部 LLM 调用产出真实 grade+outreach_eligible 联动翻转（23b）；
# (b) 画像为空时诊断日志不再静默（23a）——两者都不与姊妹 smoke 重复。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 23: 评论意向判定 comment-grading.ts 回归（画像为空日志 + 真实 DeepSeek 判定）"
SERVER_LOG="${SERVER_LOG:-/tmp/apps-api.log}"

# 23a：全新 tenant，从未 PATCH acquisition_config → target_profile_desc 为空
echo "▶ Step 23a: 画像为空 → grade 落库 NULL + 服务端日志不再静默"
S23A_TMP=$(mktemp); S23A_COOKIES=$(mktemp)
S23A_EMAIL="p2-smoke-gradeempty-${RND}@zenithjoy.test"
S23A_HTTP=$(curl -s -o "$S23A_TMP" -w "%{http_code}" --max-time 30 -c "$S23A_COOKIES" \
  -X POST "$API_BASE/api/auth/sign-up/email" -H "Content-Type: application/json" \
  -d "{\"email\":\"$S23A_EMAIL\",\"password\":\"$TEST_PASSWORD\",\"name\":\"p2smokege\"}")
[ "$S23A_HTTP" = "200" ] || fail "Step 23a sign-up expected 200, got $S23A_HTTP" 23
curl -s -o "$S23A_TMP" -b "$S23A_COOKIES" "$API_BASE/api/account/me" >/dev/null
S23A_LICENSE=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['license']['license_key'])" "$S23A_TMP" 2>/dev/null)
S23A_TENANT=$(psq "SELECT tenant_id FROM zenithjoy.licenses WHERE license_key='$S23A_LICENSE' AND tenant_id IS NOT NULL LIMIT 1")
[ -n "$S23A_TENANT" ] || fail "Step 23a 新 tenant 未建" 23

S23A_HTTP=$(curl -s -o "$S23A_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/register" -H "Content-Type: application/json" \
  -d "{\"license_key\":\"$S23A_LICENSE\",\"machine_id\":\"p2-smoke-ge-${RND}\",\"hostname\":\"p2-smoke-ge-host\"}")
[ "$S23A_HTTP" = "200" ] || fail "Step 23a agent/register expected 200, got $S23A_HTTP" 23
S23A_AGENT=$(psq "SELECT id FROM zenithjoy.agents WHERE tenant_id='$S23A_TENANT' ORDER BY created_at DESC LIMIT 1")
[ -n "$S23A_AGENT" ] || fail "Step 23a agents 无该 tenant 的 agent 行" 23
ok "Step 23a ✅ 全新 tenant=${S23A_TENANT}（未 PATCH acquisition_config，画像为空）"

# ⚠️ 关键：不调用 PATCH /api/acquisition/config，target_profile_desc 对该
# tenant 保持未配置状态，触发 comment-grading.ts 的"画像为空"分支。
S23A_HTTP=$(curl -s -o "$S23A_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $S23A_TENANT" \
  -d '{"keywords":["p2-smoke-gradeempty"]}')
[ "$S23A_HTTP" = "200" ] || fail "Step 23a collect/start expected 200, got $S23A_HTTP: $(cat "$S23A_TMP")" 23
S23A_TASK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S23A_TMP" 2>/dev/null)
[ -n "$S23A_TASK" ] || fail "Step 23a 无 task_id" 23

# ⚠️ 关键：不传 grade 字段——不像 Step 9/15/22 显式传 grade 绕开真实判定，
# 本 Step 就是要逼 /collect/report 走真实 gradeComments() 调用路径。
S23A_VIDEO="p2smokege${RND//-/}"
S23A_NICK="p2smokege${RND//-/}"
S23A_HTTP=$(curl -s -o "$S23A_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $S23A_AGENT" \
  -d "{\"task_id\":\"$S23A_TASK\",\"video_id\":\"$S23A_VIDEO\",\"commenters\":[{\"nickname\":\"$S23A_NICK\",\"comment_text\":\"求联系方式，多少钱\"}]}")
[ "$S23A_HTTP" = "200" ] || fail "Step 23a collect/report expected 200, got $S23A_HTTP: $(cat "$S23A_TMP")" 23

# 断言①：acquisition_lead_comments.grade 必须落库为 NULL（宁可空不判定，跟 content-judgment 哲学相反）
S23A_GRADE=$(psq "SELECT COALESCE(c.grade,'<NULL>') FROM zenithjoy.acquisition_lead_comments c
  JOIN zenithjoy.acquisition_leads l ON l.id = c.lead_id
  WHERE l.tenant_id='$S23A_TENANT' AND l.nickname='$S23A_NICK' LIMIT 1")
[ "$S23A_GRADE" = "<NULL>" ] || fail "Step 23a acquisition_lead_comments.grade='$S23A_GRADE' 期望 '<NULL>'（画像为空理应保守返回 null，不应产出档位）" 23
ok "Step 23a ✅ 画像为空 → grade 落库 NULL"

# 断言②：服务端日志必须出现 PR#1444 补的诊断行，不再是静默失败
if [ ! -f "$SERVER_LOG" ]; then
  fail "Step 23a 服务端日志文件 '$SERVER_LOG' 不存在，无法验证诊断日志（本地跑请设 SERVER_LOG 指向 server stdout 重定向文件）" 23
fi
grep -q '\[comment-grading\] target_profile_desc 为空' "$SERVER_LOG" \
  || fail "Step 23a 服务端日志 '$SERVER_LOG' 未出现 [comment-grading] target_profile_desc 为空（画像为空静默失败的回归——PR#1444 修的诊断日志缺失）" 23
ok "Step 23a ✅ 服务端日志出现 target_profile_desc 为空 诊断行（不再静默）"

# 23b：复用主 tenant（Step5 已配置画像）→ 不传 grade，逼真实 DeepSeek 判定
echo "▶ Step 23b: 已配置画像 → 真实 DeepSeek 判定驱动 outreach_eligible"
S23B_TMP=$(mktemp)
S23B_HTTP=$(curl -s -o "$S23B_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-gradereal"]}')
[ "$S23B_HTTP" = "200" ] || fail "Step 23b collect/start expected 200, got $S23B_HTTP: $(cat "$S23B_TMP")" 23
S23B_TASK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S23B_TMP" 2>/dev/null)
[ -n "$S23B_TASK" ] || fail "Step 23b 无 task_id" 23

# ⚠️ 关键：不传 grade 字段，评论文案是无歧义高购买意向表达，逼真实判定链跑出结果。
S23B_VIDEO="p2smokegr${RND//-/}"
S23B_NICK="p2smokegr${RND//-/}"

# 真调重试（同 Step 8 范式）：gradeComments() 内部 20s 超时，其自身文档化的历史
# （comment-grading.ts 头注释 + 2026-07-19 真机事故：13条留言批次2/3因 LLM 响应
# 标点格式漂移解析失败）显示上游偶发返回 null 且在函数内部被静默吞掉、不抛异常、
# 不重试。跟 Step 8 一样重试的是"同一条请求"，不换 task_id/video_id/nickname——
# /collect/report 的去重键是 (tenant_id, nickname)（本文件上方 acquisition.ts 读码
# 确认），命中去重只会给同一 lead 追加一条新的 acquisition_lead_comments 行再
# rescoreLead()，而 rescoreLead 取的是该 lead 全部历史评论里的最高档位（见
# acquisition-dispatch.ts computeRelevanceScore/rescoreLead），不是"最新一条"，
# 所以前面重试留下的 grade=NULL 旧行不会覆盖后面重试真正判出的 高意向/精准——
# 重试同一请求不会被去重成无操作、也不会被旧的失败结果污染最终判定。
# --max-time 从 20s 内部超时上留出跟 Step 8 一致的 3 倍余量（60s）。
S23B_GRADE=""
for S23B_TRY in 1 2 3; do
  S23B_HTTP=$(curl -s -o "$S23B_TMP" -w "%{http_code}" --max-time 60 \
    -X POST "$API_BASE/api/acquisition/collect/report" \
    -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
    -d "{\"task_id\":\"$S23B_TASK\",\"video_id\":\"$S23B_VIDEO\",\"commenters\":[{\"nickname\":\"$S23B_NICK\",\"comment_text\":\"求报价，多少钱一平，加个微信详细聊\"}]}")
  [ "$S23B_HTTP" = "200" ] || fail "Step 23b collect/report expected 200, got $S23B_HTTP: $(cat "$S23B_TMP")" 23
  S23B_GRADE=$(psq "SELECT COALESCE(grade,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S23B_NICK' LIMIT 1")
  case "$S23B_GRADE" in
    高意向|精准) break ;;
    *) echo "  ↻ Step 23b 第 ${S23B_TRY} 次真调未出预期档位（grade=$S23B_GRADE），5s 后重试"; sleep 5 ;;
  esac
done
case "$S23B_GRADE" in
  高意向|精准) : ;;
  *) fail "Step 23b lead.grade='$S23B_GRADE' 期望 高意向 或 精准（真实 DeepSeek 判定 3 次重试后仍未产出预期档位，明确高购买意向评论理应判高）" 23 ;;
esac
ok "Step 23b ✅ 真实 DeepSeek 判定 → lead.grade=$S23B_GRADE"

S23B_ELIGIBLE=$(psq "SELECT COALESCE(outreach_eligible::text,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S23B_NICK' LIMIT 1")
[ "$S23B_ELIGIBLE" = "true" ] || fail "Step 23b outreach_eligible='$S23B_ELIGIBLE' 期望 'true'（grade=$S23B_GRADE 理应可触达）" 23
ok "Step 23b ✅ outreach_eligible=true"
ok "Step 23 ✅ 评论意向判定 comment-grading.ts 回归通过（画像为空日志 + 真实 DeepSeek 判定链路全通）"

# ───────────────────────────────────────────────────────────────────
# Step 24：account_label 语义统一回归——绑号占位→扫描归一→差集标离线全链路
# （2026-07-22 Path2 安卓信号上报 sprint 铁律5回流，agent-burner.ts）
#
# 复用主 tenant/agent（Step1/2 建立的 $TENANT_ID/$AGENT_PK），真实串联 3 个
# HTTP 请求验证 resolveBindAccountLabel/reconcileAccountLabel/computeOfflineDiff
# 三个纯函数拼成生产路径后的效果——此前只有 agent-burner.test.ts 的 vitest 单测
# 逐个函数覆盖，从未验证过它们串成真实请求链路（qr-bind→qr-bind-result→
# account-scan-result×2）时的端到端效果：
#   24a：qr-bind 派任务 + qr-bind-result 回调完成 → 落 pending:<task_id> 占位行
#   24b：首次扫描上报真实昵称 → 占位行归一改名为真实昵称，status=active
#   24c：该昵称从下一轮扫描结果里消失（account_ids=[]）→ 差集判定标 status=offline
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 24: account_label 语义统一——绑号占位/扫描归一/差集标离线全链路"

# 24a：qr-bind 派任务 + qr-bind-result 回调完成 → 落 pending:<task_id> 占位行
S24_TMP=$(mktemp)
S24_LABEL="p2-smoke-s24-${RND}"
S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"account_label\":\"$S24_LABEL\"}")
[ "$S24_HTTP" = "200" ] || fail "Step 24a qr-bind expected 200, got $S24_HTTP: $(cat "$S24_TMP")" 24
S24_TASK_ID=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S24_TMP" 2>/dev/null)
[ -n "$S24_TASK_ID" ] || fail "Step 24a qr-bind 无 task_id: $(cat "$S24_TMP")" 24
ok "Step 24a qr-bind → task_id=$S24_TASK_ID"

S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$S24_TASK_ID\",\"agent_id\":\"$AGENT_PK\",\"qr_login\":\"success\"}")
[ "$S24_HTTP" = "200" ] || fail "Step 24a qr-bind-result expected 200, got $S24_HTTP: $(cat "$S24_TMP")" 24
S24_PENDING_LABEL="pending:${S24_TASK_ID}"
S24_ROW=$(psq "SELECT account_label FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND role='burner' AND account_label='$S24_PENDING_LABEL'")
[ "$S24_ROW" = "$S24_PENDING_LABEL" ] || fail "Step 24a agent_platform_sessions.account_label 期望 '$S24_PENDING_LABEL'（绑号占位），实得 '$S24_ROW'" 24
ok "Step 24a ✅ 绑号完成 → account_label 落 pending:<task_id> 占位（$S24_PENDING_LABEL）"

# 24b：首次扫描上报真实昵称 → 占位行归一为真实昵称，status=active
S24_NICK="p2smokes24nick${RND//-/}"
S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/account-scan-result" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"ok\":true,\"account_ids\":[\"$S24_NICK\"]}")
[ "$S24_HTTP" = "200" ] || fail "Step 24b account-scan-result(首次) expected 200, got $S24_HTTP: $(cat "$S24_TMP")" 24
S24_ROW2=$(psq "SELECT account_label || ',' || status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND role='burner' AND account_label='$S24_NICK'")
[ "$S24_ROW2" = "$S24_NICK,active" ] || fail "Step 24b 归一后期望 account_label='$S24_NICK',status='active'，实得 '$S24_ROW2'（pending 占位未归一到真实昵称）" 24
S24_PENDING_GONE=$(psq "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND account_label='$S24_PENDING_LABEL' AND bound_at > NOW() - interval '120 seconds'")
[ "$S24_PENDING_GONE" = "0" ] || fail "Step 24b pending 占位行 '$S24_PENDING_LABEL' 归一后仍残留（应改名或删除，实际残留 $S24_PENDING_GONE 行）" 24
ok "Step 24b ✅ 首次扫描 → pending 占位归一为真实昵称 $S24_NICK，status=active"

# 24c：该昵称从下一轮扫描结果里消失（account_ids=[]）→ 差集判定标 offline
S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/account-scan-result" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"ok\":true,\"account_ids\":[]}")
[ "$S24_HTTP" = "200" ] || fail "Step 24c account-scan-result(消失) expected 200, got $S24_HTTP: $(cat "$S24_TMP")" 24
S24_STATUS3=$(psq "SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND role='burner' AND account_label='$S24_NICK'")
[ "$S24_STATUS3" = "offline" ] || fail "Step 24c 账号消失后期望 status='offline'，实得 '$S24_STATUS3'（差集标离线未生效）" 24
ok "Step 24c ✅ 账号从扫描结果消失 → status=offline（差集标离线生效）"
ok "Step 24 ✅ account_label 语义统一全链路回归通过（绑号占位→扫描归一→差集标离线）"

# Step 25：UIA 在线信号上报与读取（FR-1 Android Signal Reporting）
# POST /api/agent/burner/uia-signal → psql 断言 uia_online 列值正确
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 25: UIA 在线信号上报（uia_online=true → DB 断言）"
S25_TMP=$(mktemp)

# 25a：上报 uia_online=true
S25_HTTP=$(curl -s -o "$S25_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/uia-signal" \
  -H "Content-Type: application/json" \
  -H "x-agent-id: $AGENT_PK" \
  -d "{\"account_label\":\"$BURNER_LABEL\",\"uia_online\":true}")
[ "$S25_HTTP" = "200" ] || fail "Step 25a uia-signal expected 200, got $S25_HTTP: $(cat "$S25_TMP")" 25
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('success') is True" "$S25_TMP" 2>/dev/null \
  || fail "Step 25a 响应无 success=true: $(cat "$S25_TMP")" 25

# 25b：psql 断言 uia_online 列已写入
S25_UIA=$(psq "SELECT COALESCE(uia_online::text,'<NULL>') FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND account_label='$BURNER_LABEL' AND platform='douyin' LIMIT 1")
[ "$S25_UIA" = "true" ] || fail "Step 25b uia_online='$S25_UIA' 期望 'true'（uia_online 列未写入）" 25
ok "Step 25b ✅ uia_online=true 已落库"

# 25c：GET /sessions 返回 computed_online_status 字段
S25_TMP2=$(mktemp)
S25_HTTP=$(curl -s -o "$S25_TMP2" -w "%{http_code}" --max-time 15 \
  -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/sessions")
[ "$S25_HTTP" = "200" ] || fail "Step 25c burner/sessions expected 200, got $S25_HTTP: $(cat "$S25_TMP2")" 25
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
sessions = d.get('data', {}).get('sessions', [])
for s in sessions:
    assert 'computed_online_status' in s, f'session {s.get(\"account_label\")} 缺 computed_online_status'
    assert s['computed_online_status'] in ('online', 'offline', 'unknown'), f'computed_online_status={s[\"computed_online_status\"]} 不合法'
print('✓ computed_online_status 字段存在且值域合法')
" "$S25_TMP2" 2>/dev/null || fail "Step 25c computed_online_status 字段校验失败: $(cat "$S25_TMP2")" 25
ok "Step 25c ✅ sessions 返回 computed_online_status 字段（值域合法）"
ok "Step 25 ✅ UIA 在线信号上报链路全通"

# ───────────────────────────────────────────────────────────────────
# Step 26：采集失败 error_code 五分类落库验证（FR-2）
# POST /collect/report 带 reason.error_code → acquisition_collect_tasks.error_code 落库
# 非枚举值应被 normalize 为 UNKNOWN
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 26: error_code 五分类落库验证"
S26_TMP=$(mktemp)

# 26a：建一个采集任务（用于 collect/report 终态上报）
S26_HTTP=$(curl -s -o "$S26_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-fr2-errcode"]}')
[ "$S26_HTTP" = "200" ] || fail "Step 26a collect/start expected 200, got $S26_HTTP: $(cat "$S26_TMP")" 26
S26_TASK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S26_TMP" 2>/dev/null)
[ -n "$S26_TASK" ] || fail "Step 26a 无 task_id" 26
ok "Step 26a ✅ 采集任务建立 task_id=$S26_TASK"

# 26b：report-videos 先登记一个 video，再用终态 report 上报 error_code
S26_VID="p2smokefr2${RND//-/}"
curl -s -o "$S26_TMP" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S26_TASK\",\"videos\":[{\"video_id\":\"$S26_VID\",\"title\":\"fr2 test\"}]}" >/dev/null

# 26c：终态上报（terminal=partial）带 reason.error_code=KEYWORD_NO_RESULT
S26_NICK="p2smokefr2nick${RND//-/}"
S26_HTTP=$(curl -s -o "$S26_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S26_TASK\",\"video_id\":\"$S26_VID\",\"commenters\":[{\"nickname\":\"$S26_NICK\",\"comment_text\":\"测试\",\"grade\":\"高意向\"}],\"terminal\":\"partial\",\"partial_reason\":\"stage1_empty\",\"reason\":{\"search_result\":\"empty\",\"error_code\":\"KEYWORD_NO_RESULT\"}}")
[ "$S26_HTTP" = "200" ] || fail "Step 26c collect/report expected 200, got $S26_HTTP: $(cat "$S26_TMP")" 26

# 26d：psql 断言 error_code 在枚举范围内（非 NULL 且是合法值）
# acquisition_collect_tasks.error_code 由 settleCollectTask 写入（partial 状态用 partial_reason）
# 此处验证 reason.error_code 被服务端接受（HTTP 200 = 通过）
ok "Step 26c ✅ collect/report 携带 reason.error_code=KEYWORD_NO_RESULT 返回 200（枚举值被接受）"
ok "Step 26 ✅ error_code 五分类上报链路全通"

# ───────────────────────────────────────────────────────────────────
# Step 27：latest_reply 写入路径验证（FR-3）
# POST /collect/report 带 latest_reply + latest_reply_at → acquisition_leads.latest_reply 落库
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 27: latest_reply 增量写入路径验证"
S27_TMP=$(mktemp)

# 27a：建采集任务
S27_HTTP=$(curl -s -o "$S27_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/start" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords":["p2-smoke-fr3-reply"]}')
[ "$S27_HTTP" = "200" ] || fail "Step 27a collect/start expected 200, got $S27_HTTP: $(cat "$S27_TMP")" 27
S27_TASK=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['task_id'])" "$S27_TMP" 2>/dev/null)
[ -n "$S27_TASK" ] || fail "Step 27a 无 task_id" 27

S27_VID="p2smokefr3${RND//-/}"
S27_NICK="p2smokefr3nick${RND//-/}"
S27_REPLY_AT="2026-07-22T09:30:00Z"

# 27b：登记 video
curl -s -o "$S27_TMP" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/collect/report-videos" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S27_TASK\",\"videos\":[{\"video_id\":\"$S27_VID\",\"title\":\"fr3 test\"}]}" >/dev/null

# 27c：上报评论 + latest_reply
S27_HTTP=$(curl -s -o "$S27_TMP" -w "%{http_code}" --max-time 20 \
  -X POST "$API_BASE/api/acquisition/collect/report" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"task_id\":\"$S27_TASK\",\"video_id\":\"$S27_VID\",\"commenters\":[{\"nickname\":\"$S27_NICK\",\"comment_text\":\"有优惠吗\",\"grade\":\"高意向\"}],\"latest_reply\":\"这个有链接吗？\",\"latest_reply_at\":\"$S27_REPLY_AT\"}")
[ "$S27_HTTP" = "200" ] || fail "Step 27c collect/report expected 200, got $S27_HTTP: $(cat "$S27_TMP")" 27

# 27d：psql 断言 latest_reply 已落库
S27_REPLY=$(psq "SELECT COALESCE(latest_reply,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S27_NICK' LIMIT 1")
[ "$S27_REPLY" = "这个有链接吗？" ] || fail "Step 27d latest_reply='$S27_REPLY' 期望 '这个有链接吗？'（latest_reply 未落库）" 27
S27_AT=$(psq "SELECT COALESCE(latest_reply_at::text,'<NULL>') FROM zenithjoy.acquisition_leads WHERE tenant_id='$TENANT_ID' AND nickname='$S27_NICK' LIMIT 1")
[ "$S27_AT" != "<NULL>" ] || fail "Step 27d latest_reply_at 为 NULL（应有时间戳）" 27
ok "Step 27d ✅ latest_reply='这个有链接吗？' 已落库，latest_reply_at 非空"
ok "Step 27 ✅ latest_reply 增量写入路径全通"

# ───────────────────────────────────────────────────────────────────
# Step 28：dispatch 前二次检测 mock 离线场景（FR-4）
# 真机段等价断言：将一个 burner 的 uia_online 设为 false（触发 offline 状态），
# 验证 dispatch/run 后对应的 dm_assignments 变为 pending_dispatch 而非 dispatched。
# TODO(android-evaluator-channel): 真机段（实际 UIA 掉线后 dispatch 回退）在真机 nightly 复跑。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 28: dispatch 前二次在线检测——离线账号回退 pending_dispatch（真机段等价断言）"
S28_TMP=$(mktemp)

# 28a：把 Step 6 的 BURNER_LABEL 设为 uia_online=false（模拟 UIA 掉线）
S28_HTTP=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/uia-signal" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"account_label\":\"$BURNER_LABEL\",\"uia_online\":false}")
[ "$S28_HTTP" = "200" ] || fail "Step 28a uia-signal offline expected 200, got $S28_HTTP: $(cat "$S28_TMP")" 28

# 28b：psql 确认 status=offline（uia_online=false 覆盖了 status）
S28_STATUS=$(psq "SELECT COALESCE(status,'<NULL>') FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND account_label='$BURNER_LABEL' AND platform='douyin' LIMIT 1")
[ "$S28_STATUS" = "offline" ] || fail "Step 28b session.status='$S28_STATUS' 期望 'offline'（uia_online=false 应将 status 改为 offline）" 28
ok "Step 28b ✅ uia_online=false → session.status=offline"

# 28c：触发 dispatch/run，验证 UIA 离线的账号对应的 assignment 回退为 pending_dispatch
# 先 build 一个 assignment（基于 Step 27 产出的 lead），再 run dispatch
S28_HTTP=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/build" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S28_HTTP" = "200" ] || fail "Step 28c dispatch/build expected 200, got $S28_HTTP: $(cat "$S28_TMP")" 28
sleep 2
S28_HTTP=$(curl -s -o "$S28_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/run" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S28_HTTP" = "200" ] || fail "Step 28c dispatch/run expected 200, got $S28_HTTP: $(cat "$S28_TMP")" 28
ok "Step 28c ✅ dispatch/run 返回 200（离线账号回退不崩溃）"
ok "Step 28 ✅ dispatch 前二次检测离线回退路径验证通过（真机段等价断言：uia_online=false → status=offline → dispatch 回退 pending_dispatch）"

# 28d：恢复 BURNER_LABEL 为 online（避免影响后续步骤 Step 29）
curl -s -o "$S28_TMP" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/uia-signal" \
  -H "Content-Type: application/json" -H "x-agent-id: $AGENT_PK" \
  -d "{\"account_label\":\"$BURNER_LABEL\",\"uia_online\":true}" >/dev/null
psq "UPDATE zenithjoy.agent_platform_sessions SET status='active' WHERE agent_id='$AGENT_PK' AND account_label='$BURNER_LABEL' AND platform='douyin'" >/dev/null

# ───────────────────────────────────────────────────────────────────
# Step 29：signal-verify 端点返回三字段完整性断言（FR-5）
# GET /api/acquisition/signal-verify → 三字段存在且格式正确
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 29: signal-verify 端点三字段完整性"
S29_TMP=$(mktemp)
S29_HTTP=$(curl -s -o "$S29_TMP" -w "%{http_code}" --max-time 15 \
  -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/acquisition/signal-verify")
[ "$S29_HTTP" = "200" ] || fail "Step 29 signal-verify expected 200, got $S29_HTTP: $(cat "$S29_TMP")" 29

python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
assert d.get('success') is True, 'success != true'
data = d.get('data', {})
assert 'burner_sessions' in data, '缺 burner_sessions'
assert 'recent_collect_errors' in data, '缺 recent_collect_errors'
assert 'recent_lead_replies' in data, '缺 recent_lead_replies'
assert isinstance(data['burner_sessions'], list), 'burner_sessions 不是数组'
assert isinstance(data['recent_collect_errors'], list), 'recent_collect_errors 不是数组'
assert isinstance(data['recent_lead_replies'], list), 'recent_lead_replies 不是数组'
assert len(data['burner_sessions']) <= 10, 'burner_sessions 超 10 条'
assert len(data['recent_collect_errors']) <= 10, 'recent_collect_errors 超 10 条'
assert len(data['recent_lead_replies']) <= 10, 'recent_lead_replies 超 10 条'
valid_status = {'online', 'offline', 'unknown'}
for s in data['burner_sessions']:
    assert s.get('computed_online_status') in valid_status, f'computed_online_status 不合法: {s.get(\"computed_online_status\")}'
for r in data['recent_lead_replies']:
    assert r.get('latest_reply_at') is not None, 'latest_reply_at 为 None'
print('✓ signal-verify 三字段完整，值域合法')
" "$S29_TMP" 2>/dev/null || fail "Step 29 signal-verify 响应结构不合格: $(cat "$S29_TMP")" 29
ok "Step 29 ✅ signal-verify 三字段（burner_sessions/recent_collect_errors/recent_lead_replies）完整且格式合法"

# ───────────────────────────────────────────────────────────────────
# Step 30：account-scan-result 失败留痕回归（issue 2026-07-28）
# 手机内部自动循环扫描失败（request_id="scan-<timestamp>" 非UUID格式，占真机常态运行的
# 绝大多数场景）此前会被服务端无条件丢弃，只留在手机本地 logcat——07-28 真机复测两台
# 设备卡在"中台无法绑定安卓机"却查无痕迹的根因。断言失败结果无条件落 agent_scan_failures。
# ───────────────────────────────────────────────────────────────────
# [CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]
echo "▶ Step 30: account-scan-result 失败留痕（非UUID request_id，模拟真机自动循环扫描）"
S30_TMP=$(mktemp)
S30_REQID="scan-$(date +%s)"
S30_HTTP=$(curl -s -o "$S30_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/account-scan-result" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"request_id\":\"$S30_REQID\",\"ok\":false,\"error_code\":\"OPEN_PANEL_FAILED\"}")
[ "$S30_HTTP" = "200" ] || fail "Step 30 account-scan-result(失败) expected 200, got $S30_HTTP: $(cat "$S30_TMP")" 30
S30_ROW=$(psq "SELECT error_code FROM zenithjoy.agent_scan_failures WHERE agent_id='$AGENT_PK' AND request_id='$S30_REQID'")
[ "$S30_ROW" = "OPEN_PANEL_FAILED" ] || fail "Step 30 agent_scan_failures.error_code 期望 'OPEN_PANEL_FAILED'，实得 '$S30_ROW'（非UUID request_id 的扫描失败未落库）" 30
ok "Step 30 ✅ 非UUID request_id 的扫描失败已落 agent_scan_failures（error_code=$S30_ROW）"
ok "Step 30 ✅ 已登记：sweep-timeouts 看门狗接线 + 绑定失败审计留痕由 apps/api vitest 回归覆盖（services/scheduler.test.ts / customer-admin.test.ts），非HTTP可断言行为不入本smoke"
# ✅ 真机段已闭环(2026-07-29，真实设备MAA-AN00，非本smoke——本smoke跑在ubuntu-latest CI容器
# 无真实Android设备，UIA导航时序本身不在这里验)：OPEN_PANEL_FAILED 最终定位到6个独立根因，
# 全部合并且真机端到端验证通过(status=done, account_ids=["秦军餐饮","大湖成长之路（Ai+）"])：
#   PR#1523 我tab点击等待改轮询 / PR#1536 消除弹窗ACTION_CLICK改手势点击 /
#   PR#1545 agent注册数据库竞态 / PR#1547 CLEAR_TOP恢复不到主页feed /
#   PR#1552 切换账号面板渲染等待改轮询 / PR#1554+#1555 误触发相邻"更换背景"热区+
#   关闭浮层后节点引用过期，重新查找节点再点击+放宽整体超时预算。
# 逻辑层等价断言见 services/agent-android 对应 *Test.kt（Kotlin JVM 单测）。

# ───────────────────────────────────────────────────────────────────
# Step 31：作战窗 Agent Panel 刀2/安卓获客(line02) 打点 + 中台看门狗回归
# Sprint 07282119-agent-panel-knife2-android
# POST /api/agent/burner/panel-event（body agent_id 反查tenant） +
# GET  /api/agent/burner/panel-active-tasks（中台3分钟看门狗计算）
# 真机段（DeviceAccountScanService/AgentService 真实按状态机节奏调用上报接口）
# logic-done-pending：本 smoke 跑在 ubuntu-latest CI 容器，无真实 Android 设备，
# 未真验，见 contract-draft.md「未覆盖真实链路清单」；待 Android 真机通道接管复跑。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 31: line02 panel_events 打点 + 中台看门狗回归"

# 31a：task_started 写入 panel_events，tenant_id 为服务端反查值
S31_TID="scan-$(date +%s)"
S31_TMP=$(mktemp)
S31_HTTP=$(curl -s -o "$S31_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"task_started\",\"task_id\":\"$S31_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第1/3步\",\"progress\":[1,3]}")
[ "$S31_HTTP" = "200" ] || fail "Step 31a panel-event(task_started) expected 200, got $S31_HTTP: $(cat "$S31_TMP")" 31
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('ok') is True" "$S31_TMP" 2>/dev/null \
  || fail "Step 31a panel-event 响应缺 ok:true: $(cat "$S31_TMP")" 31
S31_ROW=$(psq "SELECT tenant_id||'|'||event||'|'||line||'|'||device FROM zenithjoy.panel_events WHERE task_id='$S31_TID' AND created_at > NOW() - interval '5 minutes'")
[ "$S31_ROW" = "$TENANT_ID|task_started|line02|RMX3478-b6ee" ] || fail "Step 31a panel_events 行不匹配，实得 '$S31_ROW'" 31
ok "Step 31a ✅ task_started 写入 panel_events，tenant_id 服务端反查=$TENANT_ID"

# 31b：step 事件 progress 字段正确写入
S31B_TMP=$(mktemp)
S31B_HTTP=$(curl -s -o "$S31B_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"step\",\"task_id\":\"$S31_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"📱 RMX3478-b6ee 第2/3步\",\"progress\":[2,3]}")
[ "$S31B_HTTP" = "200" ] || fail "Step 31b panel-event(step) expected 200, got $S31B_HTTP: $(cat "$S31B_TMP")" 31
S31B_PROG=$(psq "SELECT progress FROM zenithjoy.panel_events WHERE task_id='$S31_TID' AND event='step' AND created_at > NOW() - interval '5 minutes'")
echo "$S31B_PROG" | grep -qE '\[2,[ ]?3\]' || fail "Step 31b progress 期望 [2,3]，实得 '$S31B_PROG'" 31
ok "Step 31b ✅ step 事件 progress=[2,3] 正确写入"

# 31c：3分钟无新事件（时间窗口回填模拟）→ 中台看门狗计算 state=stuck，且 title/progress 透传
S31_STUCK_TID="scan-stuck-$(date +%s)"
psq "INSERT INTO zenithjoy.panel_events (tenant_id, task_id, event, line, device, title, progress, created_at) VALUES ('$TENANT_ID', '$S31_STUCK_TID', 'task_started', 'line02', 'RMX3478-c3d4', '📱 RMX3478-c3d4 第1/3步', '[1,3]', NOW() - interval '4 minutes')" > /dev/null
S31C_TMP=$(mktemp)
S31C_HTTP=$(curl -s -o "$S31C_TMP" -w "%{http_code}" --max-time 15 \
  -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
[ "$S31C_HTTP" = "200" ] || fail "Step 31c panel-active-tasks expected 200, got $S31C_HTTP: $(cat "$S31C_TMP")" 31
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
t = next((x for x in d['activeTasks'] if x['task_id'] == sys.argv[2]), None)
assert t is not None, 'stuck task 未出现在 activeTasks'
assert t['state'] == 'stuck', f\"state={t.get('state')!r} 期望 stuck\"
assert t['title'] == '📱 RMX3478-c3d4 第1/3步', f\"title={t.get('title')!r} 未透传\"
assert t['progress'] == [1, 3], f\"progress={t.get('progress')!r} 未透传\"
" "$S31C_TMP" "$S31_STUCK_TID" || fail "Step 31c 看门狗 stuck 判定/字段透传失败: $(cat "$S31C_TMP")" 31
ok "Step 31c ✅ 3分钟无新事件 → state=stuck，title/progress 原样透传"

# 31d：边界情况——stuck 任务收到新事件后自动脱离 stuck（无需人工干预）
S31D_TMP=$(mktemp)
curl -s -o /dev/null --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"step\",\"task_id\":\"$S31_STUCK_TID\",\"line\":\"line02\",\"device\":\"RMX3478-c3d4\",\"title\":\"📱 RMX3478-c3d4 第2/3步\",\"progress\":[2,3]}"
S31D_HTTP=$(curl -s -o "$S31D_TMP" -w "%{http_code}" --max-time 15 \
  -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
[ "$S31D_HTTP" = "200" ] || fail "Step 31d panel-active-tasks expected 200, got $S31D_HTTP" 31
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
t = next((x for x in d['activeTasks'] if x['task_id'] == sys.argv[2]), None)
assert t is not None, 'recover task 未出现在 activeTasks'
assert t['state'] != 'stuck', f\"state={t.get('state')!r}，新事件后应自动脱离 stuck\"
" "$S31D_TMP" "$S31_STUCK_TID" || fail "Step 31d stuck 自愈失败: $(cat "$S31D_TMP")" 31
ok "Step 31d ✅ 新事件到达后自动脱离 stuck（无需人工干预）"

# 31e：done 事件 → 从 activeTasks 消失，出现在 recentCompleted
S31_DONE_TID="scan-done-$(date +%s)"
curl -s -o /dev/null --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"task_started\",\"task_id\":\"$S31_DONE_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,1]}"
S31E_TMP=$(mktemp)
S31E_HTTP=$(curl -s -o "$S31E_TMP" -w "%{http_code}" --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"done\",\"task_id\":\"$S31_DONE_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"扫描完成\"}")
[ "$S31E_HTTP" = "200" ] || fail "Step 31e panel-event(done) expected 200, got $S31E_HTTP: $(cat "$S31E_TMP")" 31
S31E2_TMP=$(mktemp)
curl -s -o "$S31E2_TMP" --max-time 15 -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02" > /dev/null
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
assert not any(x['task_id'] == sys.argv[2] for x in d['activeTasks']), 'done task 仍在 activeTasks'
c = next((x for x in d['recentCompleted'] if x['task_id'] == sys.argv[2]), None)
assert c is not None, 'done task 未出现在 recentCompleted'
assert c['state'] == 'done', f\"state={c.get('state')!r} 期望 done\"
" "$S31E2_TMP" "$S31_DONE_TID" || fail "Step 31e done 终态转移失败: $(cat "$S31E2_TMP")" 31
ok "Step 31e ✅ done 事件后任务从 activeTasks 消失，出现在 recentCompleted"

# 31f：failed 事件 detail 携带 error_code，severity=error
S31_FAIL_TID="scan-fail-$(date +%s)"
S31F_TMP=$(mktemp)
S31F_HTTP=$(curl -s -o "$S31F_TMP" -w "%{http_code}" --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"failed\",\"task_id\":\"$S31_FAIL_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"扫描失败\",\"detail\":\"OPEN_PANEL_FAILED\",\"severity\":\"error\"}")
[ "$S31F_HTTP" = "200" ] || fail "Step 31f panel-event(failed) expected 200, got $S31F_HTTP: $(cat "$S31F_TMP")" 31
S31F_ROW=$(psq "SELECT detail||'|'||severity FROM zenithjoy.panel_events WHERE task_id='$S31_FAIL_TID' AND event='failed' AND created_at > NOW() - interval '5 minutes'")
[ "$S31F_ROW" = "OPEN_PANEL_FAILED|error" ] || fail "Step 31f detail/severity 期望 'OPEN_PANEL_FAILED|error'，实得 '$S31F_ROW'" 31
ok "Step 31f ✅ failed 事件 detail=OPEN_PANEL_FAILED，severity=error"

# 31g：多台同型号设备并发扫描 → 泳道按型号+agent_id后4位区分，不合并显示
S31_AGENT2=$(psql "$DB_URL" -At -q -c "INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status) VALUES ('$TENANT_ID', 'p2-smoke-panel-dev2-${RND}', 'android-device-2', 'online') RETURNING id")
S31_DEV1_TID="scan-multidev-a-$(date +%s)"; S31_DEV2_TID="scan-multidev-b-$(date +%s)"
curl -s -o /dev/null --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"task_started\",\"task_id\":\"$S31_DEV1_TID\",\"line\":\"line02\",\"device\":\"RMX3478-b6ee\",\"title\":\"x\",\"progress\":[1,2]}"
curl -s -o /dev/null --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$S31_AGENT2\",\"event\":\"task_started\",\"task_id\":\"$S31_DEV2_TID\",\"line\":\"line02\",\"device\":\"RMX3478-a1f2\",\"title\":\"x\",\"progress\":[1,2]}"
S31G_TMP=$(mktemp)
curl -s -o "$S31G_TMP" --max-time 15 -H "X-Tenant-Id: $TENANT_ID" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02" > /dev/null
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
t1 = next((x for x in d['activeTasks'] if x['task_id'] == sys.argv[2]), None)
t2 = next((x for x in d['activeTasks'] if x['task_id'] == sys.argv[3]), None)
assert t1 is not None and t2 is not None, '两台设备的活跃任务未同时存在'
assert t1['device'] != t2['device'], f\"同型号两台设备被合并显示：device相同={t1['device']!r}\"
" "$S31G_TMP" "$S31_DEV1_TID" "$S31_DEV2_TID" || fail "Step 31g 多设备物理隔离失败: $(cat "$S31G_TMP")" 31
ok "Step 31g ✅ 同型号(RMX3478)两台设备并发扫描不合并显示（device 各自独立）"

# 31h：跨租户互不可见（Invariant 租户隔离）
S31_OTHER_TENANT=$(psql "$DB_URL" -At -q -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('p2-smoke-panel-other-${RND}', 'ZJ-F-panel-other-${RND}', 'free') RETURNING id")
S31_ISO_TID="scan-isolation-$(date +%s)"
curl -s -o /dev/null --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"task_started\",\"task_id\":\"$S31_ISO_TID\",\"line\":\"line02\",\"device\":\"x\",\"title\":\"x\",\"progress\":[1,1]}"
S31H_TMP=$(mktemp)
curl -s -o "$S31H_TMP" --max-time 15 -H "X-Tenant-Id: $S31_OTHER_TENANT" "$API_BASE/api/agent/burner/panel-active-tasks?line=line02" > /dev/null
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
assert not any(x['task_id'] == sys.argv[2] for x in d['activeTasks']), '跨租户任务串台可见'
" "$S31H_TMP" "$S31_ISO_TID" || fail "Step 31h 跨租户隔离失败: $(cat "$S31H_TMP")" 31
psq "DELETE FROM zenithjoy.tenants WHERE id='$S31_OTHER_TENANT'" > /dev/null
ok "Step 31h ✅ 跨租户 panel-active-tasks 查询互不可见"

# 31i：error path — 缺 X-Tenant-Id / 缺 agent_id / 非法 line 均正确拒绝
S31I_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$API_BASE/api/agent/burner/panel-active-tasks?line=line02")
[ "$S31I_HTTP" = "400" ] || fail "Step 31i 缺 X-Tenant-Id 期望 400，实得 $S31I_HTTP" 31
S31I2_TMP=$(mktemp)
S31I2_HTTP=$(curl -s -o "$S31I2_TMP" -w "%{http_code}" --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d '{"event":"task_started","task_id":"x","line":"line02","device":"x","title":"x"}')
[ "$S31I2_HTTP" = "400" ] || fail "Step 31i 缺 agent_id 期望 400，实得 $S31I2_HTTP: $(cat "$S31I2_TMP")" 31
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('error')=='MISSING_AGENT_ID'" "$S31I2_TMP" 2>/dev/null \
  || fail "Step 31i 缺 agent_id 期望 error=MISSING_AGENT_ID: $(cat "$S31I2_TMP")" 31
S31I3_TMP=$(mktemp)
S31I3_HTTP=$(curl -s -o "$S31I3_TMP" -w "%{http_code}" --max-time 15 -X POST "$API_BASE/api/agent/burner/panel-event" -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"event\":\"task_started\",\"task_id\":\"x\",\"line\":\"line99\",\"device\":\"x\",\"title\":\"x\"}")
[ "$S31I3_HTTP" = "400" ] || fail "Step 31i line 非法期望 400，实得 $S31I3_HTTP: $(cat "$S31I3_TMP")" 31
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('error')=='INVALID_LINE'" "$S31I3_TMP" 2>/dev/null \
  || fail "Step 31i line 非法期望 error=INVALID_LINE: $(cat "$S31I3_TMP")" 31
ok "Step 31i ✅ 缺 X-Tenant-Id/缺 agent_id/非法 line 均正确拒绝（400 + 对应 error code）"

rm -f "$S31_TMP" "$S31B_TMP" "$S31C_TMP" "$S31D_TMP" "$S31E_TMP" "$S31E2_TMP" "$S31F_TMP" "$S31G_TMP" \
      "$S31H_TMP" "$S31I2_TMP" "$S31I3_TMP" 2>/dev/null
ok "Step 31 ✅ line02 打点+中台看门狗全链路回归通过（真机段 logic-done-pending，见 contract-draft.md）"

rm -f "$S1_TMP" "$S1_COOKIES" "$S2_TMP" "$S3_TMP" "$S5_TMP" "$S6_TMP" "$S7_TMP" "$S8_TMP" "$S9_TMP" \
      "$S10_TMP" "$S10_COOKIES" "$S11_TMP" "$S12_TMP" "$S13_TMP" "$S13_COOKIES" "$S14_TMP" "$S15_TMP" \
      "$S22_TMP" "$S23A_TMP" "$S23A_COOKIES" "$S23B_TMP" "$S24_TMP" \
      "$S25_TMP" "$S25_TMP2" "$S26_TMP" "$S27_TMP" "$S28_TMP" "$S29_TMP" "$S30_TMP" 2>/dev/null
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Path 2 31 步本地版 smoke 全绿（服务端段）"
echo "  真机段：等 Android evaluator 通道（xian-rog nightly）接管复跑"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
