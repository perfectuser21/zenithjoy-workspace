#!/usr/bin/env bash
# Retained shared registration, heartbeat, safety and phone-controller contracts.
# Legacy Kotlin acquisition/model/dispatch checks are retired. This smoke does not
# validate current Skill execution, phone acceptance, or real model delivery.
# Independent Skill/ADB assertions below remain mandatory and can fail this job.

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
echo "  Shared API and phone-controller contracts (not Skill/device acceptance)"
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

# Step 5b：PUT partial patch 必须按数据库当前值校验 effective configuration。
# 先落合法边界，再只上调 min 使合并后 min > max；400 后数据库值必须保持不变。
echo "▶ Step 5b: partial PUT 合并后边界校验"
S5B_TMP=$(mktemp)
S5B_HTTP=$(curl -s -o "$S5B_TMP" -w "%{http_code}" --max-time 15 \
  -X PUT "$API_BASE/api/acquisition/config" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords_per_round_min":3,"keywords_per_round_max":5}')
[ "$S5B_HTTP" = "200" ] || fail "Step 5b 合法完整边界 PUT expected 200, got $S5B_HTTP: $(cat "$S5B_TMP")" 5
S5B_HTTP=$(curl -s -o "$S5B_TMP" -w "%{http_code}" --max-time 15 \
  -X PUT "$API_BASE/api/acquisition/config" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"keywords_per_round_min":10}')
[ "$S5B_HTTP" = "400" ] || fail "Step 5b 非法 effective config expected 400, got $S5B_HTTP: $(cat "$S5B_TMP")" 5
python3 -c "import json,sys; assert json.load(open(sys.argv[1]))['error']['code']=='INVALID_CONFIG'" "$S5B_TMP" 2>/dev/null \
  || fail "Step 5b expected error.code=INVALID_CONFIG: $(cat "$S5B_TMP")" 5
S5B_ROW=$(psq "SELECT keywords_per_round_min||'|'||keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID'")
[ "$S5B_ROW" = "3|5" ] || fail "Step 5b 非法 effective config 被持久化，数据库实得 '$S5B_ROW'" 5
ok "Step 5b ✅ 合并后非法返回 INVALID_CONFIG，合法边界 3|5 保持未改"

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

# 旧 Kotlin 视频模型检查已按业务决定退役。此处不验证新 Skill 或真实设备。
echo "SKILL_DEVICE_ACCEPTANCE=not_verified (legacy Kotlin model check retired)"

# Legacy Kotlin collection, model judgment and lead-report checks are retired.

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
[ "$S13_ROW_COUNT" = "1" ] || fail "Step 13d agents 表该 tenant+hostname 应恰好 1 行，实际 ${S13_ROW_COUNT}（去重未按 tenant_id 正确命中旧行）" 13
ok "Step 13 ✅ 心跳去重按 tenant_id 查，跨 license 同机正确命中旧行（DB 唯一约束真根因已修）"

# Legacy Kotlin collection, reporting and dispatch checks are retired.

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

# 24a：旧创建入口已退役；显式构造历史在途任务，真实 HTTP 验证回执和数据库。
S24_TMP=$(mktemp)
S24_LABEL="p2-smoke-s24-${RND}"
S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d "{\"agent_id\":\"$AGENT_PK\",\"account_label\":\"$S24_LABEL\"}")
[ "$S24_HTTP" = "410" ] || fail "Step 24a retired qr-bind expected 410, got $S24_HTTP: $(cat "$S24_TMP")" 24
python3 -c "import json,sys; assert json.load(open(sys.argv[1]))['error']['code']=='LEGACY_ACQUISITION_RETIRED'" "$S24_TMP" || fail 'Step 24a retired reason missing' 24
S24_TASK_ID=$(psq "INSERT INTO zenithjoy.publish_tasks (tenant_id,agent_id,platform,status,task_type,payload) VALUES ('$TENANT_ID','$AGENT_PK','douyin','queued','qr_bind/douyin_burner',jsonb_build_object('agent_id','$AGENT_PK','account_label','$S24_LABEL')) RETURNING id" | head -1 | tr -d '[:space:]')
[ -n "$S24_TASK_ID" ] || fail 'Step 24a historical fixture insert failed' 24
ok "Step 24a old creation refused; historical task seeded for callback"

S24_HTTP=$(curl -s -o "$S24_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$S24_TASK_ID\",\"agent_id\":\"$AGENT_PK\",\"qr_login\":\"success\"}")
[ "$S24_HTTP" = "200" ] || fail "Step 24a qr-bind-result expected 200, got $S24_HTTP: $(cat "$S24_TMP")" 24
S24_PENDING_LABEL="pending:${S24_TASK_ID}"
S24_ROW=$(psq "SELECT account_label FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_PK' AND platform='douyin' AND role='burner' AND account_label='$S24_PENDING_LABEL'")
[ "$S24_ROW" = "$S24_PENDING_LABEL" ] || fail "Step 24a agent_platform_sessions.account_label 期望 '$S24_PENDING_LABEL'（绑号占位），实得 '$S24_ROW'" 24
ok "Step 24a ✅ 绑号完成 → account_label 落 pending:<task_id> 占位（${S24_PENDING_LABEL}）"

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
ok "Step 24b ✅ 首次扫描 → pending 占位归一为真实昵称 ${S24_NICK}，status=active"

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

# Legacy Kotlin collection failure/reply and dispatch checks are retired.

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
ok "Step 30 ✅ 非UUID request_id 的扫描失败已落 agent_scan_failures（error_code=${S30_ROW}）"
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

# Step 32：不可逆取消链必须接入 Path2 canonical smoke；深层状态机由真 PG contract test
# 与 Android/Windows 双接缝 workflow 验证，此处锁住生产入口和五个持久化字段不被漏打包。
node - <<'NODE' || fail "Step 32 不可逆取消链产物缺失" 32
const fs = require('fs');
const migration = fs.readFileSync('apps/api/db/migrations/20260731_acquisition_cancel_lifecycle.sql', 'utf8');
const route = fs.readFileSync('apps/api/src/routes/acquisition.ts', 'utf8');
for (const field of ['cancel_requested_at', 'cancel_sent_at', 'cancelled_at', 'cancel_command_id', 'device_machine_id']) {
  if (!migration.includes(field)) process.exit(1);
}
for (const behavior of ["'/collect/cancel'", 'DEVICE_CANCEL_COOLDOWN', 'CANCEL_NOT_SENT']) {
  if (!route.includes(behavior)) process.exit(1);
}
NODE
ok "Step 32 ✅ Path2 不可逆取消入口、稳定设备冷却与回执闸已接入"

# ───────────────────────────────────────────────────────────────────
# Step 33：取完作品链接后必须验真回到视频详情页（step3「Lead 表出现潜在客户」的命门）
#
# 0921 夜批 auto09212230 整批 0 LEAD 的根因回流：current_video_link 用 deep link
# 重开视频后，收尾守卫只验包名。deep link 没生效时人还停在暂存解析页——它同样是
# 抖音包名，守卫放行 → 调用方以为已回到视频页 → 此后每个视频的 tap 坐标都打在错
# 页面上 → 评论采不到 → Lead 表空。
#
# 这里不跑真机（本段是服务端 smoke），锁的是三件不能再退回去的事。
node - <<'NODE' || fail "Step 33 取链接后的详情页恢复守卫缺失/退化" 33
const fs = require('fs');
const ctl = fs.readFileSync('services/phone-adb-controller/douyin-phone-adb', 'utf8');

// ① 判定函数在，且用的是「分享按钮存在且可点」这把尺子（入口 _on_video_detail 同款）
const fn = ctl.slice(ctl.indexOf('_is_video_detail_xml() {'));
if (!fn.includes('content-desc="分享')) process.exit(1);
if (!fn.includes("clickable=")) process.exit(1);

// ② deep link 恢复段真的调了它，且没过就 die —— 本 bug 的形状正是「判定在、出口没用」
const vs = ctl.indexOf('if [[ "$content_type" == "video" ]]; then');
const branch = ctl.slice(vs, ctl.indexOf('\n  else\n', vs));
if (!/_is_video_detail_xml/.test(branch)) process.exit(1);
if (!/die .*did not restore/.test(branch)) process.exit(1);

// ③ 正常详情页的真机 fixture 必须含 et_search_kw。
//    这条锁的是当时自己踩的坑：第一版拿「顶部有搜索框」当否决条件，自造用例全绿，
//    真机一回放才发现从搜索结果进入的详情页顶部本来就有搜索框——那样会把每个正常
//    视频都判死，比原 bug 更糟。fixture 里没有这个反例，这条判据就无人看守了。
const detail = fs.readFileSync(
  'services/phone-adb-controller/__tests__/fixtures/video-detail-from-search.xml', 'utf8');
if (!detail.includes('et_search_kw')) process.exit(1);
if (!detail.includes('content-desc="分享')) process.exit(1);
NODE
ok "Step 33 ✅ 取链接后的详情页恢复守卫在位（判据=分享按钮，出口真的验、没过就 die）"

# ───────────────────────────────────────────────────────────────────
# Step 34：处理完一个视频后的归位必须是确定性的，不能自己数 back 次数
#
# 0922 02:00 夜批实证（Step 33 那一刀已上机后的第一批）：内部恢复守卫已生效、
# 链路能自我恢复了，但掉页仍在发生——调用方几个「跳过」分支只 back 一次，
# 而取过链接的视频栈里比"直接点开卡片"多压一层（deep link 重开），
# 一次退不回结果页，人落在暂存解析页，后面每个视频的 tap 全打在错页面上。
node - <<'NODE' || fail "Step 34 采收归位退化成数 back 次数" 34
const fs = require('fs');
const ctl = fs.readFileSync('services/phone-adb-controller/douyin-phone-adb', 'utf8');
const harvest = fs.readFileSync('services/phone-adb-controller/harvest-keyword.sh', 'utf8');

// ① 归位函数必须验前台并在退不回去时报错（退完 N 次就返回成功 = 没守卫）
const fn = ctl.slice(ctl.indexOf('back_to_results() {'));
if (!fn.includes('_is_search_results_fg')) process.exit(1);
if (!/return 1/.test(fn.slice(0, fn.indexOf('\n}\n')))) process.exit(1);

// ② 判定不能只看包名——暂存解析页、搜索输入页都是抖音自己的页面
const judgeStart = ctl.search(/^_is_search_results_fg\(\) \{$/m);
if (judgeStart < 0) process.exit(1);
const judgeEnd = ctl.slice(judgeStart + 1).search(/^_is_video_detail_xml\(\) \{$/m);
if (judgeEnd < 0) process.exit(1);
const judge = ctl.slice(judgeStart, judgeStart + 1 + judgeEnd);
if (!judge.includes('SEARCH_RESULT_ACTIVITY')) process.exit(1);

// ③ 采收循环里不许再出现"自己数 back 次数"的归位
const lines = harvest.split('\n');
const bad = lines.filter((l, i) => {
  // back-to-profile(对标流回主页,7f842d12)同是控制器内核验页面的归位子命令,不是数 back
  if (!/--profile "\$P" back\b/.test(l) || /back-to-(results|profile)/.test(l)) return false;
  const ctx = lines.slice(Math.max(0, i - 5), i).join('\n');
  return !/open-comments|评论面板|card-link/.test(ctx);   // 面板层的恢复不算归位
});
if (bad.length > 0) process.exit(1);
if (!harvest.includes('back-to-results')) process.exit(1);
NODE
ok "Step 34 ✅ 采收归位是确定性的（退到看见结果页为止，退不回去就报错）"

# ───────────────────────────────────────────────────────────────────
# Step 35：回填按「活」路由，认不出一律拒收（别再静默倒进金诺）
#
# 主理人 0922 定的模型：隔离点在「活」上不在「机器」上——
# 「生产要求你生产回填哪，研发要求你研发回填哪，这两个不一样。」
#
# 旧实现认不出 profile 就 return ROUTES[0]（金诺），注释写着"避免静默丢数据"，
# 实际是静默污染别人的库：小彩(xiaolongxia)不在任何 route 里，一旦开跑，
# 悦升研发机的线索会整批写进金诺生产表，没有任何人会发现。
node - <<'NODE' || fail "Step 35 回填路由退回按机器兜底" 35
const { routeOf, ROUTES, devBatchTag } = require('./services/phone-adb-controller/line-routes.js');

// ① 三种历史用法都还认得出（夜批现在传的就是 profile 名，断了整条链会红）
for (const [hint, key] of [['jinoshengyuan-work','jinuo'], ['legacy','jinuo'],
                           ['yueshengyun-work','yuesheng'], ['AI人工智能训练师','jinuo'],
                           ['悦升云端','yuesheng']]) {
  if (routeOf(hint).key !== key) process.exit(1);
}

// ② 认不出必须抛错——这是本刀的核心
for (const bad of ['xiaolongxia', '', undefined, '没见过的标记']) {
  let threw = false;
  try { routeOf(bad); } catch { threw = true; }
  if (!threw) process.exit(1);
}

// ③ 研发是**标签**不是客户（主理人 0922 纠正）：
//    「金诺是一个客户表，悦升云端也是个客户表。研发只是个标签呀。
//      金诺的研发就在金诺里面，悦升的研发就在悦升里面。」
//    上一版把 dev 做成第三条路由且 base=null，等于把研发当第三个客户，
//    而且让研发活的数据直接丢失、无处可查。
if (ROUTES.some((r) => r.key === 'dev')) process.exit(1);          // 路由表里不许有 dev
for (const r of ROUTES) { if (!r.base || !r.lead) process.exit(1); } // 没有"不落库的客户"
// 研发活照样落它所属客户的库，标签走线索表已有的「实验批次」列
if (routeOf('jinuo', { dev: true }).base !== routeOf('jinuo').base) process.exit(1);
if (devBatchTag(true) !== '研发' || devBatchTag(false) !== '') process.exit(1);

// ④ 采收链必须把标记透传下去，不能再传空（空值会被 ② 拒收，整条链会红）
const fs = require('fs');
const code = (f) => fs.readFileSync(f, 'utf8').split('\n')
  .filter((l) => !l.trimStart().startsWith('#')).join('\n');
const hk = code('services/phone-adb-controller/harvest-keyword.sh');
const b2 = code('services/phone-adb-controller/batch2.sh');
if (/LINE="\$\{6:-\}"/.test(hk)) process.exit(1);
if (!/harvest-keyword\.sh[^\n]*"\$LINE"/.test(b2)) process.exit(1);
// 收紧：原来写 /push-videos\.js[^\n]*\$LINE/ 太松——同一行后半句还有
// push-raw-comments.js ... ${LINE}，把 push-videos 换回 ${P} 也照样匹配得上（变异实测漏网）。
if (/push-videos\.js\s+\S+\s+\S+\s+\$P\b/.test(b2)) process.exit(1);
if (!/push-videos\.js\s+\S+\s+\S+\s+\$LINE\b/.test(b2)) process.exit(1);
NODE
ok "Step 35 ✅ 回填按活路由（认不出拒收、研发不碰生产 base、标记透传到落池）"

# ───────────────────────────────────────────────────────────────────
# Step 36：关键词「是否启用」认一类写法，别只认"是"（step2 的入口闸）
#
# 这一列是人手填在飞书表里的自由文本。0923 真机实测两家的实际填法：
#   金诺 58 条：是 37 / 启用 9 / 暂停 7 / 否 5
#   悦升 35 条：启用 35
# 原实现写死 `=== "是"`，填「启用」的一律被静默过滤——金诺取词 31 → 40，
# 9 条词被埋了而且不报错（日志只显示"本批取 N 词"）。
#
# 选不出词 = step2「按关键词找目标视频」根本不会开始，所以这是那一步的入口闸。
node - <<'NODE' || fail "Step 36 关键词启用判定退化" 36
const { isKeywordEnabled } = require('./services/phone-adb-controller/keyword-enabled-lib.js');

// ① 两家现在的填法都得认，少认一种就有词被静默埋掉
for (const v of ['是', '启用']) if (!isKeywordEnabled(v)) process.exit(1);

// ② 白名单默认即拒：没列进去的一个都不许放过。金诺表里真有 7 条填「暂停」，
//    误判会让停掉的词重新开跑、去真发私信。
//    （注意：挡住它们的是"不在白名单"，不是那两行黑名单/正则——那两行在当前
//      实现下是冗余的，变异实测删掉也不影响结果，只为防将来改成宽松匹配。）
for (const v of ['否', '暂停', '停用', '未启用', '暂不启用', '关闭', '待定', '???']) {
  if (isKeywordEnabled(v)) process.exit(1);
}

// ③ 空值/未填不跑：没表态就别动客户的号
for (const v of ['', '   ', null, undefined]) if (isKeywordEnabled(v)) process.exit(1);

// ④ 判定必须住在**可安全 require 的文件**里——不是 grep 有没有 readFileSync
//    （换个写法就绕过去了），而是真的在一个空目录里 require 一次看它炸不炸。
//    第一版判定挂在 next-keywords.js 上，那个脚本顶层就读 clawdbot.json、顶层就发飞书请求，
//    CI 一 require 就 `ENOENT: ~/.openclaw/clawdbot.json` 报红。这里复刻的就是那个现场。
const { execFileSync } = require('child_process');
const { mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const { resolve } = require('path');
const LIB = resolve('services/phone-adb-controller/keyword-enabled-lib.js');
const sandbox = mkdtempSync(`${tmpdir()}/kwlib-`);
try {
  execFileSync(process.execPath,
    ['-e', `const m=require(${JSON.stringify(LIB)}); if (typeof m.isKeywordEnabled!=='function') process.exit(9);`],
    // cwd 和 HOME 都指向空目录：本机上 ~/.openclaw/clawdbot.json 是存在的，
    // 只把 cwd 挪空，"顶层读 home 下的配置"这个原样病灶在本地照样能读到 → 守卫假绿。
    // CI runner 上没有那个文件才会炸。把 HOME 一起架空，守卫才跟宿主环境无关。
    { cwd: sandbox, env: { PATH: process.env.PATH, HOME: sandbox }, stdio: 'pipe' });
} catch (e) {
  process.stderr.write(`判定文件 require 不干净（CI 会当场报红）: ${e.stderr || e.message}\n`);
  process.exit(1);
}
NODE
ok "Step 36 ✅ 关键词启用判定认一类写法，且住在可安全 require 的纯函数文件里"

# Step 37：判定通过的评论，必须真的落成线索行才算办完（step5 的出账闸）
#
# 0923 线上对账，两家的评论池和线索表对不上账：
#   金诺 池true=351 → 线索表 278 池转入 + 21 重复  = 299  差 41
#   悦升 池true=167 → 线索表  48 池转入 +  7 重复  =  55  差 105
# 池子账面写着"已进入最终线索"，线索表里查无此人，两本账差 146 条且无人会发现。
#
# 不是数据问题也不是判定链问题：把 3 条孤儿原样复刻回写，三条全 code=0 成功；
# 同日真跑一轮悦升分拣，41 判定 / 29 搬入 / 0 异常。是顺序错了——
# 先把池推成「已分拣+进入最终线索=true」再写线索表，写失败只打一行日志；
# 而下一轮扫池的入口是 `处理状态 !== "待分拣" → 跳过`，这条再也捞不回来。
#
# 评论判定完却进不了线索表 = step5「线索入库」根本没发生，所以这是那一步的出账闸。
node - <<'NODE' || fail "Step 37 分拣结算顺序退化，线索会静默消失" 37
const { settlePending } = require('./services/phone-adb-controller/sort-comments-lib.js');

const mkRow = () => ({ id: 'recP', fields: {
  评论者昵称: '小小奥', 用户主页标识: '29428203889 | personal',
  评论原文: '想了解私有化部署', 来源视频: '一人公司怎么用 AI',
  评论作品视频链接: '', 地区: '陕西', 留言时间: '2026-09-23',
}});
const mkDeps = (leadRes) => {
  const calls = [];
  return { calls, deps: {
    putPool: async (id, fields) => { calls.push({ op: 'putPool', fields }); return { code: 0 }; },
    postLead: async (fields) => { calls.push({ op: 'postLead', fields }); return leadRes; },
    putLead: async (id, fields) => { calls.push({ op: 'putLead', fields }); return leadRes; },
  }};
};
const args = (deps, over) => Object.assign({
  row: mkRow(), verdict: { relevance: '相关', grade: 'A', reason: '明确询问' },
  deps, route: { key: 'yuesheng', line: '悦升云端', intent: '私有化部署', audience: '企业AI决策者' },
  seen: new Map(), now: '2026-09-23 11:30(UTC+8)', asLeadTime: (_n, v) => v,
}, over || {});
const settled = (calls) => calls.filter(c => c.op === 'putPool' && c.fields['处理状态'] === '已分拣');

(async () => {
  // ① 线索写失败 → 池绝不能被推出「待分拣」，否则下一轮永远扫不到它（146 条就是这么丢的）
  {
    const { calls, deps } = mkDeps({ code: 1254045, msg: 'FieldNameNotFound' });
    const r = await settlePending(args(deps));
    if (settled(calls).length) process.exit(1);
    if (r.retryable !== true) process.exit(1);
  }
  // ② 线索建成后才推进池，且顺序必须是「先线索、后池」
  {
    const { calls, deps } = mkDeps({ code: 0, data: { record: { record_id: 'recL' } } });
    const r = await settlePending(args(deps));
    if (r.moved !== 1) process.exit(1);
    const iLead = calls.findIndex(c => c.op === 'postLead');
    const iDone = calls.findIndex(c => c.op === 'putPool' && c.fields['处理状态'] === '已分拣');
    if (!(iLead >= 0 && iDone > iLead)) process.exit(1);
  }
  // ③ 重复客户高亮写失败 → 同样不许推进池（原实现连返回值都不看）
  {
    const { calls, deps } = mkDeps({ code: 1254043, msg: 'RecordIdNotFound' });
    const r = await settlePending(args(deps, { seen: new Map([['小小奥', { id: 'recSTALE', dup: 2 }]]) }));
    if (r.duped !== 0 || settled(calls).length) process.exit(1);
  }
  // ④ 客户语义跟着 route 走，未配留空——绝不回落成金诺的"考证人群"
  {
    const { calls, deps } = mkDeps({ code: 0, data: { record: { record_id: 'recL' } } });
    await settlePending(args(deps));
    const f = calls.find(c => c.op === 'postLead').fields;
    if (f['目标人群'] !== '企业AI决策者') process.exit(1);
    const bare = mkDeps({ code: 0, data: { record: { record_id: 'recL2' } } });
    await settlePending(args(bare.deps, { route: { key: 'x', line: 'X' } }));
    const g = bare.calls.find(c => c.op === 'postLead').fields;
    if (g['目标人群'] !== '' || g['搜索意图'] !== '') process.exit(1);
  }
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
NODE
ok "Step 37 ✅ 判定通过的评论必须真落成线索行，落不成就留在待分拣等下一轮（不再静默消失）"

# Step 38：词的赛马数据必须真的回写得进去（step2 选词的依据）
#
# 0923 实测，悦升关键词表 35 行的四个效果列**一个数都没有**，而金诺同期 39/2/29/52。
# 三层，每层单独都足以让数据为 0：
#   ① update-keyword-stats.js 把金诺的 base/table/account 全写死，连 line-routes 都没
#      require——0916「按业务线路由」改了四个写库脚本，漏了这一个 → 悦升从来没跑过
#   ② 悦升「最后测试时间」是日期型(type 5)，脚本写文本字符串 → DatetimeFieldConvFail，
#      飞书是**整条记录**打回，连「有效线索数」这些没问题的列也一起写不进去
#   ③ 两家线索表都没有「命中关键词」列(各34列逐列查过)，而有效线索数按它统计 →
#      `if (!kw) return;` 每次命中，这个数永远是 0（金诺那 2 行有值的是人手填的）
#
# 词的赛马数据没有 = next-keywords 的「最久未测优先 / 按效果挑词」全是瞎排，
# 所以这是 step2「按关键词找目标视频」的选词依据闸。
node - <<'NODE' || fail "Step 38 关键词效果回写退化" 38
const { buildStatFields, enabledValueFor, tallyFromPool } = require('./services/phone-adb-controller/keyword-stats-lib.js');

// ① 日期型的时间列要写时间戳，文本型写文本，类型读不到退回文本
const dated = buildStatFields({ stat: { leads: 1, dup: 0, comments: 2, videos: 0 },
  now: '2026-09-23 12:00(UTC+8)', fieldTypes: { 最后测试时间: 5 }, stamp: true });
if (typeof dated['最后测试时间'] !== 'number') process.exit(1);
const texted = buildStatFields({ stat: { leads: 1, dup: 0, comments: 2, videos: 0 },
  now: '2026-09-23 12:00(UTC+8)', fieldTypes: { 最后测试时间: 1 }, stamp: true });
if (texted['最后测试时间'] !== '2026-09-23 12:00(UTC+8)') process.exit(1);
const unknown = buildStatFields({ stat: { leads: 1, dup: 0, comments: 2, videos: 0 },
  now: '2026-09-23 12:00(UTC+8)', fieldTypes: {}, stamp: true });
if (unknown['最后测试时间'] !== '2026-09-23 12:00(UTC+8)') process.exit(1);

// ② 本轮没跑过的词不刷时间戳（刷平了「最久未测优先」就废了）
if ('最后测试时间' in buildStatFields({ stat: { leads: 0, dup: 0, comments: 0, videos: 0 },
  now: 'x', fieldTypes: { 最后测试时间: 5 }, stamp: false })) process.exit(1);

// ③ 有效线索数从池里数，不从线索表（那列不存在）
const row = (kw, keep, nick) => ({ fields: { 命中关键词: kw, 进入最终线索: keep, 评论者昵称: nick } });
const t = tallyFromPool([row('AI获客', true, '甲'), row('AI获客', true, '甲'),
                         row('AI获客', false, '乙'), row('数字员工', true, '丙')]);
if (t['AI获客'].leads !== 2 || t['AI获客'].comments !== 3 || t['AI获客'].dup !== 1) process.exit(1);
if (t['数字员工'].leads !== 1 || t['数字员工'].dup !== 0) process.exit(1);
if (tallyFromPool([row('', true, '甲')])['']) process.exit(1);

// ④ 自建行的「是否启用」按目标列现状挑，别往单选里塞选项外的值
if (enabledValueFor({ type: 3, options: ['启用', '停用'] }) !== '启用') process.exit(1);
if (enabledValueFor({ type: 3, options: ['停用', '暂停'] }) !== '是') process.exit(1);
if (enabledValueFor({ type: 1, options: [] }) !== '是') process.exit(1);
NODE
ok "Step 38 ✅ 词的赛马数据按目标列类型真写得进去，有效线索数从池里数（不再全 0）"

# Step 39：夜批调效果回写时必须把「这批是谁的活」带上（step2 的调用链闸）
#
# 0923 实证的最后一层：harvest-cron.sh 调 update-keyword-stats.js 时一个参数都不传。
# 老实现里脚本内部写死金诺 base，于是 **m1 跑悦升的批次也在往金诺表回写**——
# 数据没丢，是进错了家。这解释了为什么金诺那几列一直有数（两台机都在写），悦升一直是 0。
#
# 改成按 line-routes 路由之后，不传参数会直接抛「未配路由」：不会再静默写错家，
# 但夜批当晚就会红。所以调用链上的传参必须在 CI 就锁住，不能等事故。
#
# 隔离点在「活」上不在机器上（主理人 0922）：手机只管执行，活自己带着「我属于谁」。
# 这条守的就是「活的归属有没有一路传到写库那一步」。
# 7f842d12: harvest-cron.sh 已退成 exec wf-run.sh 的薄壳,调用链实现在 wf-run.sh
_GP2_HC="services/phone-adb-controller/wf-run.sh"
[[ -s "$_GP2_HC" ]] || fail "Step 39 harvest-cron.sh 缺失" 39
# 不在这里做语法检查：harvest-cron.sh 是 zsh 脚本，而跑本 smoke 的 ubuntu runner
# **没装 zsh**（实测 `zsh: command not found`，Step 39 当场 exit 39）。
# bash -n 对它的 zsh 写法又会误报 syntax error near 'else'。
# 语法检查留给装了 zsh 的 openclaw-scripts-test（ci-l3-code.yml）；这一步只守传参。
# pattern 整体放单引号里：写成双引号的话 ${BIZ} 会被本脚本就地展开成空串，
# 守卫就变成在找 `...js ''`，永远匹配不上（写完就中了一次）。
grep -qE 'update-keyword-stats\.js .\$\{BIZ\}.' "$_GP2_HC" \
  || fail "Step 39 夜批调效果回写没带业务线：不传=当晚抛未配路由；老写法则是把悦升的批次静默回写进金诺表" 39
ok "Step 39 ✅ 夜批把「这批是谁的活」一路传到了效果回写（不会再写错家，也不会当晚抛路由错）"

# Step 40：认人的时候别被名字的写法绊倒（step3 采集评论者身份的活性闸）
#
# 采到评论要知道是谁写的：点头像 → 进主页 → 读抖音号。进去后拿主页昵称跟评论区
# 那条评论的昵称比，一样才算进对人——防的是把 A 的评论配上 B 的抖音号，
# 将来会给错的人发私信。
#
# 0923 悦升夜批：这一步失败 172 次、37 人重试三轮后被放弃，日志说 nickname mismatch，
# 但**人根本就进对了**。比对的两边编码不一致：
#   observed 走 xmllint（会解 XML 字符实体）→ '小辣椒🌶️'
#   expected 是调用方从 content-desc 原样传入（没解）→ '小辣椒&#127798;️'
# 那批 801 人里 68 人昵称带实体(8.5%)，每人白跑三轮约 3~4 分钟 ≈ 4 小时；
# 这批跑了 8.5 小时到早上 7 点，把 03:00 那批整个挤掉（12 词全「锁被占」LEAD=0）。
#
# 认不出人 = step3「采集评论者身份」拿不到抖音号，线索就是半成品，所以这是那一步的闸。
node - <<'NODE' || fail "Step 40 昵称比对被编码写法绊倒" 40
const { sameNickname } = require('./services/phone-adb-controller/nickname-match-lib.js');

// ① 真机原样：实体形式 vs 已解码形式，必须认成同一个人
if (!sameNickname('小辣椒&#127798;️', '小辣椒🌶️')) process.exit(1);
if (!sameNickname('陈骆猪&#128055;&#128055;', '陈骆猪🐷🐷')) process.exit(1);
if (!sameNickname('仙人掌&#x1F335;', '仙人掌🌵')) process.exit(1);

// ② 绝不能认同的 —— 归一化过头会从「误杀」滑到「误认」：
//    把私信发给陌生人，比原 bug 危险得多
if (sameNickname('小辣椒🌶️', '大蒜头🧄')) process.exit(1);
if (sameNickname('叫我二姐姐', '叫我二姐')) process.exit(1);
if (sameNickname('辣条&#127798;', '辣条&#128055;')) process.exit(1);

// ③ 空昵称永远不算匹配：读不到就是读不到，当成功等于放弃了这道检查
if (sameNickname('', '')) process.exit(1);
if (sameNickname('', '小辣椒🌶️')) process.exit(1);
NODE

# 真机脚本侧（zsh）必须做同样的归一，且**真跑一遍**——
# 静态 grep 抓不住"写了但不生效"：第一版转义写错（& 转成 &amp; 后 xmllint 又还原成
# 字面，等于没做）、去空白用了要 extendedglob 才认的写法，两处都是 grep 全绿真跑才露馅。
if command -v zsh >/dev/null 2>&1; then
  _GP2_NICK=$(zsh -c '
    eval "$(awk "/^normalize_nickname\(\) \{/,/^\}/" services/phone-adb-controller/douyin-phone-adb)"
    print -n -- "$(normalize_nickname "小辣椒&#127798;️")"
  ' 2>/dev/null)
  [[ "$_GP2_NICK" == "小辣椒🌶" ]] \
    || fail "Step 40 真机脚本的 normalize_nickname 没生效: 实得[$_GP2_NICK] 期望[小辣椒🌶]" 40
else
  echo "  ⏭ 跳过 zsh 侧真跑（runner 无 zsh，由 openclaw-scripts-test 覆盖）"
fi
ok "Step 40 ✅ 认人不被名字写法绊倒（实体/已解码算同一人，不同的人仍判不同）"

# Step 41：101-104消费同公司的冻结版本，缺映射不能沿用硬编码画像。
node --test services/phone-adb-controller/__tests__/company-config.test.mjs \
  services/phone-adb-controller/__tests__/company-config-runtime.test.mjs \
  || fail "Step 41 公司配置隔离、版本冻结或真实判断请求回归失败" 41
ok "Step 41 ✅ 公司资料与规则版本随运行留证，缺项明确阻断"

rm -f "$S1_TMP" "$S1_COOKIES" "$S2_TMP" "$S3_TMP" "$S5_TMP" "$S5B_TMP" "$S6_TMP" "$S7_TMP" \
      "$S11_TMP" "$S12_TMP" "$S13_TMP" "$S13_COOKIES" \
      "$S24_TMP" \
      "$S25_TMP" "$S25_TMP2" "$S29_TMP" "$S30_TMP" 2>/dev/null
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ 保留的服务端和共享安全合同通过；旧 Kotlin 模型检查已退役"
echo "  SKILL_DEVICE_ACCEPTANCE=not_verified；Skill 业务和真机未由本检查验收"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
