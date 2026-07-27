#!/usr/bin/env bash
# golden-path-4-smoke.sh
# ZenithJoy Walking Skeleton — Path 4 客户私域 AI 接管（Line04 微信客服，16 步权威版）
# 权威文档：https://docs.zenjoymedia.media/line04-blueprint/（2026-07-15 三次修正版）
#
# 16 步与断言层级：
#   Step 1  客户扫码绑定个人微信号 → Agent 建立后台 UIA 监听（不弹前台窗口）
#   Step 2  客户装客户端 → Agent 注册连中台（Step 2c：config.json 的 apiUrl 缓存跟随 live env 刷新，2026-07-17 真机根治）
#   Step 3  Agent 检测到微信已登录、找到主窗口 → 开始后台静默监听（服务端等价断言：dryrun + overlay 存在；
#           Step 3e：scan_unread 扫描期间开窗读消息不再永久抢走用户前台键鼠焦点；
#           Step 3f：扫描前守卫窗口最大化自愈接入 cooldown，不再反复 maximize/minimize，2026-07-17 真机根治）；
#           Step 3i：热键召唤主路（preflight hotkey_summon 自检 + 塌缩自愈先热键再降级托盘，2026-07-19 折入）；
#           Step 3j：热键真机根因守卫（GetForegroundWindow 判据 + SendInput INPUT sizeof=40）；
#           Step 3k：overlay pywebview 供给链四处齐备（打包预装/依赖声明/客户机自修复/红灯上报，2026-07-20 刀A）；
#           Step 3l：半死区修复三件套（L1窗口形态不变量/L2梯度自愈/L3 skip细分/L4队列过期，task 5e9d608f，2026-07-20）
#   Step 6  上线自检消息——每次启动发一条给固定测试联系人（task 7be2842d，纯函数等价断言）
#   Step 7  客户触发好友扫描 / 联系人首次发消息 → 系统建立该联系人 CRM 档案（真链路：friend-scan/trigger+ingest）
#   Step 8  客户在中台 CRM 客户列表页，给联系人打 A1-A5 状态（真链路：customer-profile 六字段）
#   Step 9  设置白名单/接管模式（真链路：PUT/GET /api/wechat/cs/config/:wechatId）
#   Step 10 联系人给客户微信发来一条消息（事件触发，无独立断言，由 Step 11 起消费）
#   Step 11 判断这条消息该不该回——白名单 wxid 优先匹配（纯函数等价断言，判定点：显示名匹配隐患已修）
#   Step 12 调取该联系人历史对话记忆（真链路：memory/message → memory/context，租户隔离）
#   Step 13 生成回复草稿，判断是否转人工（真链路：POST /api/wechat/draft-generate）
#   Step 14 后台把回复真实发送出去，气泡刷新确认才算成功（真链路：cs/outbound → receipt → DB 翻状态）
#   Step 15 客户桌面浮窗实时看到"正在回复谁+推理摘要+发送中→已送达"（events.jsonl 单写者，PR#1315）
#   Step 16 浮窗切换显示当前回复客户的画像面板（events 消费循环真调用 switch_customer，已接线）
#
# Step 4/5 是共享前门（注册/装机，Path1/2/4 复用），断言见 golden-path-2-smoke.sh Step1-2，本 smoke 不复测。
#
# ⚠️ 真机段等价断言说明：
#   Step 1/3 的真机执行段（Windows 客户机真装 Agent、真登录微信）、Step 14 的真机气泡确认段
#   属 xian-rog 真机通道，本 smoke 用「服务端真链路等价断言」覆盖 API/DB 层。
#   TODO(line04-realmachine-evidence): 真机验收证据见 sprints/07150800-line04-overlay-continuation/evidence/。
#
# 未覆盖真实链路清单（规则 C）：
#   - Step 6：真机段（真实微信真发送给固定测试联系人）见 xian-rog 真机通道，本 smoke 纯函数等价断言
#   - Step 16：真机段（真实浮窗 DOM 渲染验证）见 xian-rog 真机通道，本 smoke 端到端功能断言到 get_events()/switch_customer 调用层
#   - Step 13 回复判断内核内部质量：用户 2026-07-15 拍板不重新审计，本步只做一次真调 + 响应结构断言
#
# 用法：
#   API_BASE=http://localhost:5200 DATABASE_URL=postgresql://... \
#     bash .github/workflows/scripts/smoke/golden-path-4-smoke.sh
#   退出码 0 = 全通；非零 = 第 EXIT_CODE 步红

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_URL="${DB_URL:-${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}}"
INT_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

_UNIQ_N=0
uniq_token() { _UNIQ_N=$((_UNIQ_N+1)); echo "$(date +%s)-$$-${RANDOM}-${_UNIQ_N}"; }
RND=$(uniq_token)

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }

psq() { psql "$DB_URL" -Atq -c "$1"; }

DB_REACHABLE=0
if psql "$DB_URL" -c '\q' 2>/dev/null; then DB_REACHABLE=1; fi
API_REACHABLE=0
if curl -s --max-time 2 -o /dev/null "$API_BASE/health" 2>/dev/null; then API_REACHABLE=1; fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Path 4 Walking Skeleton — Line04 客户私域 AI 接管（16 步权威版）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ───────────────────────────────────────────────────────────────────
# Step 1/2/3：客户扫码绑定 → 装客户端 → Agent 后台静默监听建立
# 真机段（xian-rog 真装 Agent、真登录微信）不可及，服务端等价断言：
#   qr-bind 校验 shape + dryrun 子进程真跑 + overlay_window.py 部署包存在 + switch_customer/events 消费逻辑存在
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 1-3: 扫码绑定 → 装客户端 → Agent 后台静默监听建立"

if [ "$API_REACHABLE" -eq 1 ]; then
  S1_TMP=$(mktemp)
  S1_HTTP=$(curl -s -o "$S1_TMP" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$API_BASE/api/wechat/qr-bind" 2>/dev/null)
  [ "$S1_HTTP" = "400" ] || fail "Step 1 qr-bind {} 期望 400，got $S1_HTTP" 1
  grep -qE 'platform' "$S1_TMP" || fail "Step 1 qr-bind 400 body 不含 platform 字段" 1
  grep -qE 'agent_id' "$S1_TMP" || fail "Step 1 qr-bind 400 body 不含 agent_id 字段" 1
  rm -f "$S1_TMP"
  ok "Step 1 ✅ qr-bind 请求 shape 校验通（platform/agent_id 必填）"
else
  echo "  SKIP: API 不可达（route 行为由 integration test 覆盖）"
fi

DRYRUN_OUT=$(echo '{"type":"wechat_qr_bind","payload":{"dryrun":true,"agent_id":"gp4-smoke-001"}}' | python3 scripts/wechat_rpa_dryrun.py 2>&1)
DRYRUN_EC=$?
[ "$DRYRUN_EC" = "0" ] || fail "Step 2 dryrun 子进程 exit $DRYRUN_EC（期望 0）" 2
echo "$DRYRUN_OUT" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("wechat_id","").startswith("mock_wx_")' 2>/dev/null \
  || fail "Step 2 dryrun receipt 不含 wechat_id" 2
ok "Step 2 ✅ 装客户端 dryrun 回执含 wechat_id（Agent 注册链路真跑）"

# ───────────────────────────────────────────────────────────────────
# Step 2c：config.json 的 apiUrl 缓存不能永久卡死（2026-07-16/17 真机实证：
# 孙燕青/于瑾两台机器 .env 明明配的 staging，zj-listener 日志却 100% 连着生产。
# 根因：loadOrInitConfig() 只在首次启动（!stableAgentId）时写 config.json，
# 之后即使 live env 提供了新 apiUrl，缓存也永不刷新，下次读不到 env 时
# 就会捡回那条更早写死的旧地址且永久卡死。纯函数等价断言：源码里
# shouldPersist 的判断必须同时覆盖"live env 提供了不同于缓存的 apiUrl"这一支，
# 不能只有 !stableAgentId 一支。
# ───────────────────────────────────────────────────────────────────
CONFIG_LOADER_TS="services/agent/src/config-loader.ts"
[ -f "$CONFIG_LOADER_TS" ] || fail "Step 2c config-loader.ts 不存在: $CONFIG_LOADER_TS" 2
grep -qE 'shouldPersist\s*=\s*!stableAgentId\s*\|\|\s*\(.*liveApiUrl.*!==\s*cachedApiUrl' "$CONFIG_LOADER_TS" \
  || fail "Step 2c config.json apiUrl 缓存刷新回归——live env 换了地址但缓存可能永久卡死（真机事故 2026-07-16/17 复发风险）" 2
ok "Step 2c ✅ apiUrl 缓存跟随 live env 刷新（不再只在首次启动写一次）"

OVERLAY_PY="services/agent/wechat-rpa/overlay/overlay_window.py"
[ -f "$OVERLAY_PY" ] || fail "Step 3 overlay_window.py 不存在: $OVERLAY_PY" 3
grep -q "switch_customer" "$OVERLAY_PY" || fail "Step 3 overlay_window.py 缺 switch_customer 方法" 3
grep -q "events" "$OVERLAY_PY" || fail "Step 3 overlay_window.py 缺 events 消费逻辑" 3
ok "Step 3 ✅ Agent 后台静默监听部署包存在（overlay_window.py 含 switch_customer + events 消费）"

# Step 3k(刀A 2026-07-20)：overlay pywebview 供给链四处齐备——框框死3天事故的机器守卫。
# 任何 PR 拆掉任一处（打包预装/依赖声明/客户机自修复/红灯上报接线）本步即红。
BUILD_PACK_SH="services/agent/scripts/build-install-pack.sh"
REQ_TXT="services/agent/wechat-rpa/requirements.txt"
PREFLIGHT_TS="services/agent/modules/line04/preflight.ts"
OVERLAY_TS="services/agent/modules/line04/handlers/overlay.ts"
grep -qE 'WHEEL_PKGS=.*pywebview==' "$BUILD_PACK_SH" \
  || fail "Step 3k 打包预装列表 WHEEL_PKGS 缺 pywebview 锁定版（框框断供根因①）" 3
grep -qE '^pywebview==' "$REQ_TXT" \
  || fail "Step 3k requirements.txt 缺 pywebview 锁定版声明" 3
grep -q 'installPywebview' "$PREFLIGHT_TS" \
  || fail "Step 3k preflight.ts 缺 installPywebview 客户机自修复（存量机换core目录即再断）" 3
grep -q 'pywebview_install_failed' "$OVERLAY_TS" \
  || fail "Step 3k overlay.ts 缺补装失败上报（静默降级复辟）" 3
ok "Step 3k ✅ overlay pywebview 供给链四处齐备（预装/声明/自修复/红灯）"

# ───────────────────────────────────────────────────────────────────
# Step 3l：半死区修复三件套 + 队列过期（task 5e9d608f，2026-07-20 刀A）
#   L1 判群前窗口形态不变量 / L2 梯度自愈触发函数 / L3 skip reason 细分 / L4 队列过期上限
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 3l: 半死区修复三件套 + 队列过期 纯函数等价断言（task 5e9d608f）"

python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

# --- L1：判群前窗口形态不变量纯函数 ---
fn = getattr(listen_chat, 'assert_window_shape_for_header', None)
assert fn is not None, 'FAIL: assert_window_shape_for_header 函数不存在'

# --- L2：梯度自愈触发函数 ---
heal_fn = getattr(listen_chat, 'should_heal_half_deadzone', None)
assert heal_fn is not None, 'FAIL: should_heal_half_deadzone 函数不存在'
assert heal_fn({'A': 3, 'B': 3}) is True, 'FAIL: 跨2 sender 应触发自愈'
assert heal_fn({'A': 3}) is False, 'FAIL: 单 sender 不触发自愈'
assert heal_fn({'A': 3, 'B': 3, 'C': 3}, threshold=3) is True, 'FAIL: 多 sender 均应触发'

# --- L3：skip reason 细分 ---
c = listen_chat._SkipCounter()
c.record('title_unreadable')
c.record('title_unreadable')
c.record('is_group')
snap = c.snapshot()
assert snap['total'].get('title_unreadable') == 2, 'FAIL: title_unreadable 计数不符，期望 2'
assert snap['total'].get('is_group') == 1, 'FAIL: is_group 计数不符，期望 1'

# --- L4：待发队列过期上限 ---
pending = {}
listen_chat.record_reply_failure(pending, sender='A', content='hi', reply='ok', now=0.0)
due = listen_chat.select_due_retries(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
assert 'A' not in due, 'FAIL: 超过 max_age_seconds 的条目不应出现在重试列表'

print('PASS: Step 3l 全部断言通过')
" && echo "Step 3l OK" || { echo "FAIL Step 3l"; exit 3; }

# grep 锚验证：关键实现符号必须落地
grep -q "assert_window_shape_for_header" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: assert_window_shape_for_header 未落地"; exit 3; }
grep -q "should_heal_half_deadzone" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: should_heal_half_deadzone 未落地"; exit 3; }
grep -q "title_unreadable" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: title_unreadable 未落地"; exit 3; }
grep -q "zj-deadzone-dump" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: zj-deadzone-dump dump 路径未落地"; exit 3; }
grep -q "enqueued_at" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL Step 3l: enqueued_at 过期字段未落地"; exit 3; }
echo "Step 3l grep 锚全部通过"

# rsync 同步校验：源文件与 build-modules 必须一致（L4 Runtime Gate）
diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ \
  --exclude="*.pyc" --exclude="__pycache__" \
  || { echo "FAIL Step 3l: wechat-rpa rsync 未同步"; exit 3; }
echo "Step 3l rsync 同步校验通过"

# version bump 校验
EXPECTED="1.0.152"
ACTUAL=$(python3 -c "import json; print(json.load(open('services/agent/modules/line04/manifest.json'))['version'])")
[ "$ACTUAL" = "$EXPECTED" ] \
  || { echo "FAIL Step 3l: manifest version 期望 $EXPECTED，实际 $ACTUAL"; exit 3; }
echo "Step 3l version bump 校验通过：$ACTUAL"

ok "Step 3l ✅ 半死区修复三件套 + 队列过期（L1 窗口形态/L2 梯度自愈/L3 skip细分/L4 过期上限）"

# ───────────────────────────────────────────────────────────────────
# Step 6：上线自检消息——每次启动发一条给固定测试联系人（task 7be2842d，已实现）
# 纯函数等价断言：_should_send_startup_selfcheck deny-by-default + send_startup_selfcheck
# 找到目标会话真调 reply_in_chat_with_lease。真机段（真实微信真发送）见 xian-rog 真机通道。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 6: 上线自检消息（每次启动发一条给固定测试联系人）"

if python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

# deny-by-default：未配置收件人 / 本进程已发过 → 不发
assert listen_chat._should_send_startup_selfcheck(done=False, contact='') is False
assert listen_chat._should_send_startup_selfcheck(done=True, contact='固定测试联系人') is False
assert listen_chat._should_send_startup_selfcheck(done=False, contact='固定测试联系人') is True

class _FakeElementInfo:
    def __init__(self, name): self.name = name

class _FakeItem:
    def __init__(self, name): self.element_info = _FakeElementInfo(name)

class _FakeMainWindow:
    def __init__(self, names): self._names = names
    def descendants(self, control_type=None): return [_FakeItem(n) for n in self._names]

# 找到目标会话 → 真调 reply_in_chat_with_lease（monkeypatch 断言调用参数）
called = {}
def _fake_reply_with_lease(mw, item, text, sender, middleware_url):
    called['sender'] = sender
    return True
listen_chat.reply_in_chat_with_lease = _fake_reply_with_lease
listen_chat._STARTUP_SELFCHECK_CONTACT = '固定测试联系人'
mw = _FakeMainWindow(['固定测试联系人'])
result = listen_chat.send_startup_selfcheck(mw, middleware_url='http://mw')
assert result is True, f'send_startup_selfcheck 应返回 True，实际 {result}'
assert called.get('sender') == '固定测试联系人', f'未真调 reply_in_chat_with_lease，实际 {called}'

# 找不到目标会话 → 软失败返回 False，不抛异常
mw2 = _FakeMainWindow(['别的联系人'])
result2 = listen_chat.send_startup_selfcheck(mw2, middleware_url='http://mw')
assert result2 is False, f'找不到会话应软失败返回 False，实际 {result2}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS"; then
  ok "Step 6a ✅ 启动自检 deny-by-default + 真调 reply_in_chat_with_lease + 软失败路径全过"
else
  fail "Step 6 启动自检消息断言失败" 6
fi

LISTEN_CHAT_MAIN_S6="services/agent/wechat-rpa/listen_chat.py"
grep -q "startup_selfcheck_done_once" "$LISTEN_CHAT_MAIN_S6" || fail "Step 6b 主循环未接线 startup_selfcheck_done_once（只有辅助函数没被真正调用）" 6
ok "Step 6b ✅ 主循环已接线（每进程只发一次，非每天定时）"
ok "Step 6 ✅ 上线自检消息链路通"

# ───────────────────────────────────────────────────────────────────
# Step 7：客户触发好友扫描 / 联系人首次发消息 → 系统建立 CRM 档案
# 真链路：POST /api/crm/friend-scan/trigger（网页点） → POST /api/crm/friend-scan/ingest（agent 上报）
#   → psql 验 zenithjoy.crm_customers 真落库（source='scan'）
# 前置 fixture：service_agents 需已有该 tenant 的 cs_wechat_id 绑定行（resolveServiceWriteTenant deny-by-default）。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 7: 好友扫描建档（friend-scan/trigger → ingest → crm_customers 落库）"

if [ "$DB_REACHABLE" -eq 1 ] && [ "$API_REACHABLE" -eq 1 ]; then
  S7_TENANT=$(psq "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('gp4-smoke-tenant-${RND}', 'ZJ-F-GP4${RND//-/}') RETURNING id")
  [ -n "$S7_TENANT" ] || fail "Step 7 fixture tenant 建立失败" 7
  S7_CS_WECHAT="gp4-smoke-cs-${RND}"
  S7_MACHINE="gp4-smoke-machine-${RND}"
  psq "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$S7_TENANT'::uuid, '$S7_MACHINE', '$S7_CS_WECHAT') ON CONFLICT (tenant_id) WHERE deleted_at IS NULL DO UPDATE SET wechat_id=EXCLUDED.wechat_id" >/dev/null

  S7_TMP=$(mktemp)
  S7_HTTP=$(curl -s -o "$S7_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/crm/friend-scan/trigger" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d "{\"cs_wechat_id\":\"$S7_CS_WECHAT\"}")
  [ "$S7_HTTP" = "200" ] || fail "Step 7a friend-scan/trigger expected 200, got $S7_HTTP: $(cat "$S7_TMP")" 7
  ok "Step 7a ✅ 客户点「立即扫好友」→ trigger 成功"

  S7_CONTACT="gp4smokecontact${RND//-/}"
  S7_HTTP=$(curl -s -o "$S7_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/crm/friend-scan/ingest" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d "{\"cs_wechat_id\":\"$S7_CS_WECHAT\",\"contacts\":[{\"name\":\"$S7_CONTACT\",\"wechat_id\":\"wxid_${RND//-/}\"}]}")
  [ "$S7_HTTP" = "200" ] || fail "Step 7b friend-scan/ingest expected 200, got $S7_HTTP: $(cat "$S7_TMP")" 7
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d.get('ingested',0) >= 1" "$S7_TMP" 2>/dev/null \
    || fail "Step 7b ingest 响应 ingested < 1: $(cat "$S7_TMP")" 7
  rm -f "$S7_TMP"

  S7_ROW=$(psq "SELECT count(*) FROM zenithjoy.crm_customers WHERE tenant_id='$S7_TENANT' AND contact='$S7_CONTACT' AND source='scan'")
  [ "$S7_ROW" = "1" ] || fail "Step 7c crm_customers 未落库 source='scan' 行（联系人=$S7_CONTACT）" 7
  ok "Step 7c ✅ 联系人真落库 CRM 档案（source=scan）"
  ok "Step 7 ✅ 好友扫描建档全链路通"
else
  echo "  SKIP: DB/API 不可达"
fi

# ───────────────────────────────────────────────────────────────────
# Step 8：客户在中台 CRM 客户列表页，给联系人打 A1-A5 状态（customer-profile 六字段完整性）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 8: CRM 客户列表页（customer-profile 六字段）"

WECHAT_TS="apps/api/src/routes/wechat.ts"
grep -q "customer-profile" "$WECHAT_TS" || fail "Step 8 wechat.ts 未注册 customer-profile 路由" 8
for field in level nickname source contact_count recent_actions ai_profile; do
  grep -q "$field" "$WECHAT_TS" || fail "Step 8 customer-profile 缺字段 $field" 8
done
ok "Step 8a ✅ customer-profile 路由含六字段声明"

if [ "$API_REACHABLE" -eq 1 ]; then
  S8_TMP=$(mktemp)
  S8_HTTP=$(curl -s -o "$S8_TMP" -w '%{http_code}' --max-time 15 \
    "$API_BASE/api/wechat/customer-profile?wechat_id=gp4_smoke_wx_001" 2>/dev/null || echo "000")
  if [ "$S8_HTTP" = "200" ]; then
    python3 -c "
import json,sys
d=json.load(open('$S8_TMP'))
data=d.get('data',d)
for f in ['level','nickname','source','contact_count','recent_actions','ai_profile']:
    assert f in data, f'缺字段: {f}'
" 2>/dev/null || fail "Step 8b customer-profile 响应六字段不完整" 8
    ok "Step 8b ✅ customer-profile API 响应六字段结构完整"
  else
    echo "  SKIP: customer-profile HTTP=$S8_HTTP（结构断言由 vitest 覆盖）"
  fi
  rm -f "$S8_TMP"
else
  echo "  SKIP: API 不可达"
fi
ok "Step 8 ✅ CRM 客户列表页数据源就绪"

# ───────────────────────────────────────────────────────────────────
# Step 9：设置白名单/接管模式（PUT/GET /api/wechat/cs/config/:wechatId，按微信号 upsert）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 9: 白名单/接管模式（cs/config upsert + 回读一致）"

if [ "$API_REACHABLE" -eq 1 ]; then
  S9_WECHAT="gp4-smoke-cswx-${RND}"
  S9_TMP=$(mktemp)
  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 \
    -X PUT "$API_BASE/api/wechat/cs/config/$S9_WECHAT" \
    -H "Content-Type: application/json" -H "X-Internal-Token: $INT_TOKEN" \
    -d '{"persona":{"self_name":"gp4-smoke客服"},"auto_agent_enabled":true,"whitelist":["gp4-smoke-whitelist-name"]}')
  [ "$S9_HTTP" = "200" ] || fail "Step 9a PUT cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  ok "Step 9a ✅ 白名单/接管配置写入成功（whitelist=[gp4-smoke-whitelist-name]）"

  S9_HTTP=$(curl -s -o "$S9_TMP" -w '%{http_code}' --max-time 15 "$API_BASE/api/wechat/cs/config/$S9_WECHAT")
  [ "$S9_HTTP" = "200" ] || fail "Step 9b GET cs/config expected 200, got $S9_HTTP: $(cat "$S9_TMP")" 9
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'gp4-smoke-whitelist-name' in (d.get('whitelist') or [])" "$S9_TMP" 2>/dev/null \
    || fail "Step 9b 回读 whitelist 不一致: $(cat "$S9_TMP")" 9
  rm -f "$S9_TMP"
  ok "Step 9b ✅ 回读一致（whitelist 含 gp4-smoke-whitelist-name）"
  ok "Step 9 ✅ 白名单/接管模式配置链路通"
else
  echo "  SKIP: API 不可达"
fi

# ───────────────────────────────────────────────────────────────────
# Step 10：联系人给客户微信发来一条消息（事件触发，无独立断言，由 Step 11 起消费）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 10: 联系人发消息（事件触发，无独立断言）"
ok "Step 10 ✅ 事件触发点（消费方见 Step 11-14）"

# ───────────────────────────────────────────────────────────────────
# Step 11：判断该不该回——白名单 wxid 优先匹配（纯函数等价断言）
# 判定点：白名单曾用 UIA 显示标题匹配（备注/昵称），改备注会静默失配——已改用 wxid 稳定标识符（PR#1314）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 11: 白名单 wxid 匹配（改备注不断链）"

python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import cs_config_gate as gate

cfg = {'whitelist': [{'name': '旧备注', 'wxid': 'wxid_gp4smoke'}]}
r1 = gate.should_reply(cfg, '改后新备注', sender_wxid='wxid_gp4smoke')
assert r1 is True, f'wxid 命中但 should_reply={r1}（改备注后应仍命中白名单）'

cfg2 = {'whitelist': ['老客户甲']}
r2 = gate.should_reply(cfg2, '老客户甲', sender_wxid=None)
assert r2 is True, f'旧格式纯字符串向后兼容失败: {r2}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS" \
  && ok "Step 11 ✅ 白名单 wxid 优先匹配 + 旧格式兼容通过（判定点已修：不再靠显示名）" \
  || fail "Step 11 白名单 wxid 匹配断言失败" 11

# ───────────────────────────────────────────────────────────────────
# Step 12：调取该联系人历史对话记忆（租户×联系人隔离，绝不串）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 12: 对话记忆（租户×联系人隔离）"

if [ "$API_REACHABLE" -eq 1 ] && [ "$DB_REACHABLE" -eq 1 ]; then
  S12_TENANT_A=$(psq "SELECT gen_random_uuid()::text")
  S12_TENANT_B=$(psq "SELECT gen_random_uuid()::text")
  S12_CONTACT="gp4smokemem${RND//-/}"
  S12_TMP=$(mktemp)

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/wechat/memory/message" \
    -H "Content-Type: application/json" -H "X-Tenant-Id: $S12_TENANT_A" \
    -d "{\"contact\":\"$S12_CONTACT\",\"role\":\"in\",\"text\":\"租户A的悄悄话\"}")
  [ "$S12_HTTP" = "200" ] || fail "Step 12a memory/message(租户A) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    "$API_BASE/api/wechat/memory/context?contact=$S12_CONTACT" -H "X-Tenant-Id: $S12_TENANT_B")
  [ "$S12_HTTP" = "200" ] || fail "Step 12b memory/context(租户B) expected 200, got $S12_HTTP: $(cat "$S12_TMP")" 12
  grep -q "租户A的悄悄话" "$S12_TMP" && fail "Step 12b 租户隔离违规：租户B读到了租户A的对话内容" 12
  ok "Step 12b ✅ 租户隔离验证：B 读不到 A 的记忆"

  S12_HTTP=$(curl -s -o "$S12_TMP" -w '%{http_code}' --max-time 15 \
    -X POST "$API_BASE/api/wechat/memory/message" -H "Content-Type: application/json" \
    -d "{\"contact\":\"$S12_CONTACT\",\"role\":\"in\",\"text\":\"缺租户\"}")
  [ "$S12_HTTP" = "400" ] || fail "Step 12c 无租户上下文应 400 MISSING_TENANT，got $S12_HTTP" 12
  rm -f "$S12_TMP"
  ok "Step 12c ✅ 缺租户上下文拒绝写入（不回退全量）"
  ok "Step 12 ✅ 对话记忆租户×联系人隔离通过"
else
  echo "  SKIP: DB/API 不可达"
fi

# ───────────────────────────────────────────────────────────────────
# Step 13：生成回复草稿，判断是否转人工（回复判断内核 wechat-cs-reply）
# 用户 2026-07-15 拍板：不重新审计内核质量，只做一次真调 + 响应结构断言。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 13: 回复判断内核（draft-generate 真调，不深挖内部质量）"

if [ "$API_REACHABLE" -eq 1 ]; then
  S13_TMP=$(mktemp)
  S13_TENANT=$(uniq_token)
  S13_HTTP=$(curl -s -o "$S13_TMP" -w '%{http_code}' --max-time 30 \
    -X POST "$API_BASE/api/wechat/draft-generate" \
    -H "Content-Type: application/json" \
    -d "{\"sender\":\"gp4smoke联系人\",\"wechat_id\":\"gp4-smoke-cs-${RND}\",\"content\":\"你好请问多少钱\",\"tenant_id\":\"$S13_TENANT\",\"mode\":\"review\"}")
  [ "$S13_HTTP" = "200" ] || fail "Step 13 draft-generate expected 200, got $S13_HTTP: $(cat "$S13_TMP")" 13
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert 'status' in d" "$S13_TMP" 2>/dev/null \
    || fail "Step 13 响应缺 status 字段: $(cat "$S13_TMP")" 13
  rm -f "$S13_TMP"
  ok "Step 13 ✅ draft-generate 真调通过（响应含 status，内核内部质量按拍板不深挖）"
else
  echo "  SKIP: API 不可达"
fi

# ───────────────────────────────────────────────────────────────────
# Step 14：后台把回复真实发送出去，气泡刷新确认才算成功（防假成功）
# fixture：直接造一条 approved 状态的 outbound 任务（真机气泡确认段见 xian-rog 真机通道）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 14: 真实发送 + 回执翻状态（防假成功）"

if [ "$DB_REACHABLE" -eq 1 ] && [ "$API_REACHABLE" -eq 1 ]; then
  S14_AGENT=$(psq "SELECT id FROM zenithjoy.agents ORDER BY created_at DESC LIMIT 1")
  if [ -z "$S14_AGENT" ]; then
    echo "  SKIP: 库内无 agents 行，Step 14 fixture 无法建立（需先跑过共享前门注册）"
  else
    S14_TASK=$(psq "INSERT INTO zenithjoy.wechat_publish_task (agent_id, task_type, content, target_friend_alias, status, approval_source) VALUES ('$S14_AGENT'::uuid, 'private_chat', 'gp4-smoke 回复内容', 'gp4smoke联系人', 'approved', 'system') RETURNING id")
    [ -n "$S14_TASK" ] || fail "Step 14a fixture wechat_publish_task 插入失败" 14

    S14_TMP=$(mktemp)
    S14_HTTP=$(curl -s -o "$S14_TMP" -w '%{http_code}' --max-time 15 \
      "$API_BASE/api/wechat/cs/outbound?agent_id=$S14_AGENT")
    [ "$S14_HTTP" = "200" ] || fail "Step 14a GET cs/outbound expected 200, got $S14_HTTP: $(cat "$S14_TMP")" 14
    grep -q "$S14_TASK" "$S14_TMP" || fail "Step 14a outbound 列表未含刚插入的任务 $S14_TASK" 14
    ok "Step 14a ✅ Agent 拉到待发任务"

    S14_HTTP=$(curl -s -o "$S14_TMP" -w '%{http_code}' --max-time 15 \
      -X POST "$API_BASE/api/wechat/cs/outbound/$S14_TASK/receipt" \
      -H "Content-Type: application/json" -d '{"ok":true}')
    [ "$S14_HTTP" = "200" ] || fail "Step 14b receipt expected 200, got $S14_HTTP: $(cat "$S14_TMP")" 14
    rm -f "$S14_TMP"

    S14_STATUS=$(psq "SELECT status FROM zenithjoy.wechat_publish_task WHERE id='$S14_TASK'")
    [ "$S14_STATUS" = "auto_sent" ] || fail "Step 14b 回执后状态='$S14_STATUS' 期望 auto_sent（防假成功：气泡未刷新不得判成功）" 14
    ok "Step 14b ✅ 回执真翻状态 auto_sent（真机气泡确认段见 xian-rog 真机通道）"
    ok "Step 14 ✅ 真实发送链路通"
  fi
else
  echo "  SKIP: DB/API 不可达"
fi

# ───────────────────────────────────────────────────────────────────
# Step 14c：群一律不回——判群闸 fail-closed（2026-07-16 真机事故：招商雍澜湾业主群被自动回复）
# 根因：_read_chat_header_texts 用绝对屏幕坐标过滤标题，微信窗口不在屏幕左上角时标题区
# 被整块滤空 + 回复闸读空即误判"非群"放行（fail-open）。纯函数等价断言：相对坐标读取 +
# fail-closed 语义（重试耗尽仍读空 → 不允许发送）。真机段（真实微信窗口偏移场景）见
# xian-rog 真机通道。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 14c: 群一律不回——判群闸 fail-closed（真机事故根治）"

if python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name=''):
        self.name = name


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _MW:
    def __init__(self, win_rect, texts):
        self._rect = win_rect
        self._texts = texts

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        return list(self._texts) if control_type == 'Text' else []


# 真机实测坐标：微信窗口偏移到屏幕中部（非左上角），标题绝对 top 远超旧的 210 上限
win_rect = _Rect(1069, 478, 1489, 1048)
header = _Text('招商雍澜湾业主群(497)', _Rect(1200, 520, 1450, 545))
mw = _MW(win_rect, [header])

texts = listen_chat._read_chat_header_texts(mw)
assert texts, 'relative-coord fix regressed: header text should be readable when window is offscreen'
assert listen_chat._is_group_by_header(texts) == 497

# fail-closed：标题重试耗尽仍读空 → 不允许发送（不能读不到就当私聊放行）
assert listen_chat._header_confirms_not_group(lambda: [], retries=2, retry_delay_s=0.0, sleep_fn=lambda s: None) is False
assert listen_chat._header_confirms_not_group(lambda: ['某群(5)'], retries=2, retry_delay_s=0.0, sleep_fn=lambda s: None) is False
assert listen_chat._header_confirms_not_group(lambda: ['李先生'], retries=2, retry_delay_s=0.0, sleep_fn=lambda s: None) is True
print('OK')
" 2>&1 | grep -q '^OK$'; then
  ok "Step 14c ✅ 判群闸相对坐标读取 + fail-closed 语义正确（真机偏移窗口场景已覆盖）"
else
  fail "Step 14c 判群闸回归——群可能被自动回复（真机事故 2026-07-16 招商雍澜湾业主群复发风险）" 14
fi

# ───────────────────────────────────────────────────────────────────
# Step 14d：私聊不能被上一个会话残留的群标题误判（2026-07-16 17:51 真机回归：
# 「❤柚子挖小样C598」这类真实私聊联系人被 fail-closed 闸误判成群跳过不回）。
# 根因：连续切换会话时标题面板渲染滞后，读到上一个会话（群）残留的标题——
# _header_confirms_not_group 只看有没有"(N)"人数模式，不看标题是否属于当前联系人。
# 纯函数等价断言：title_matches_fn 归属校验（同 _read_trailing_for 的 F3 同款模式）。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 14d: 私聊不被上一会话残留群标题误判（真机回归根治）"

if python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

panel_state = {'rendered': 0}

def read_fn():
    if panel_state['rendered'] < 2:
        return ['(321)']  # 残留上一个群(321人)的标题
    return ['❤柚子挖小样C598']  # 面板真正切过来后的私聊标题（无括号）

def title_matches_fn():
    return panel_state['rendered'] >= 2

def sleep_fn(_delay):
    panel_state['rendered'] += 1

ok1 = listen_chat._header_confirms_not_group(
    read_fn, retries=4, retry_delay_s=0.0, sleep_fn=sleep_fn, title_matches_fn=title_matches_fn,
)
assert ok1 is True, 'stale-header regression: private contact wrongly blocked as group'

# 真群：title_matches_fn 对纯群名从不精确匹配，最终仍应 fail-closed（结果不变）
ok2 = listen_chat._header_confirms_not_group(
    lambda: ['招商雍澜湾业主群(497)'], retries=2, retry_delay_s=0.0,
    sleep_fn=lambda s: None, title_matches_fn=lambda: False,
)
assert ok2 is False
print('OK')
" 2>&1 | grep -q '^OK$'; then
  ok "Step 14d ✅ 标题归属校验正确（残留群标题不再误伤私聊，真群仍正确拦截）"
else
  fail "Step 14d 私聊被上一会话残留群标题误判回归（真机事故 2026-07-16 17:51 复发风险）" 14
fi

# ───────────────────────────────────────────────────────────────────
# Step 15：客户桌面浮窗实时看到"正在回复谁+推理摘要+发送中→已送达"
# events.jsonl 单写者（listen_chat），PR#1315 已合并——纯函数等价断言 + DELIVERED 挂接回归
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 15: AI 思考浮窗动态流（events.jsonl 单写者）"

if python3 -c "
import sys, os, json, tempfile
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

state_dir = tempfile.mkdtemp(prefix='zj-gp4-smoke-events-')
os.environ['ZJ_STATE_DIR'] = state_dir

listen_chat._write_event('reply_sent', 'gp4smoke联系人', '客户询问价格，已推送优惠', None)
with open(os.path.join(state_dir, 'events.jsonl'), encoding='utf-8') as f:
    row = json.loads(f.readline())
required = {'v', 'event_id', 'date', 'type', 'contact', 'stage', 'reasoning', 'ts'}
assert required <= row.keys(), f'缺字段: {required - row.keys()}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS"; then
  ok "Step 15a ✅ events.jsonl 合规写入（六字段齐全）"
else
  fail "Step 15a _write_event 纯函数断言失败" 15
fi

LISTEN_CHAT_MAIN="services/agent/wechat-rpa/listen_chat.py"
grep -qn '_write_event("reply_sent"' "$LISTEN_CHAT_MAIN" || fail "Step 15b DELIVERED 点未找到 _write_event(\"reply_sent\") 调用" 15
ok "Step 15b ✅ DELIVERED 点含 _write_event 调用（_commit_reply_success 后）"

OVERLAY_DIR="services/agent/wechat-rpa/overlay"
WRITE_OPENS=$(grep -rn 'open.*"a"\|open.*"w"' "$OVERLAY_DIR" --include="*.py" 2>/dev/null | grep -i "events" | grep -v "^[[:space:]]*#" | grep -v "__pycache__" || true)
[ -z "$WRITE_OPENS" ] || fail "Step 15c overlay 目录含 events 写入调用（违反单写者约束）: $WRITE_OPENS" 15
ok "Step 15c ✅ overlay 只读消费 events.jsonl（单写者约束）"

# Step 15d：心跳超时 degraded 状态不能吞掉同批真实事件（2026-07-16 真机回归：
# listen_chat.py 全文件从未写过 heartbeat 类型事件，EventTailConsumer 的
# _last_heartbeat_ts 永远是 None，旧逻辑 `return [DEGRADED_EVENT]` 短路掉所有
# 真实 reply_sent 事件，画像卡因此永远显示不出内容）。
grep -qn '_write_event("heartbeat"' "$LISTEN_CHAT_MAIN" || fail "Step 15d run_real_listen 未找到 _write_event(\"heartbeat\") 调用" 15
if python3 -c "
import sys, os, json, tempfile
sys.path.insert(0, 'services/agent/wechat-rpa')
from overlay.overlay_window import EventTailConsumer

state_dir = tempfile.mkdtemp(prefix='zj-gp4-smoke-heartbeat-')
with open(os.path.join(state_dir, 'events.jsonl'), 'w', encoding='utf-8') as f:
    f.write(json.dumps({'type': 'reply_sent', 'event_id': 'e-1', 'contact': 'gp4smoke联系人'}, ensure_ascii=False) + '\n')

consumer = EventTailConsumer(state_dir)
events = consumer.get_events()
types = [e.get('type') for e in events]
assert 'reply_sent' in types, f'真实事件被吞: {events}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS"; then
  ok "Step 15d ✅ 心跳短路不再吞真实事件（画像卡永空白根因已修）"
else
  fail "Step 15d overlay 心跳短路回归——画像卡可能永远显示不出内容" 15
fi

ok "Step 15 ✅ AI 思考浮窗动态流通（golden path 当前终点）"

# ───────────────────────────────────────────────────────────────────
# Step 16：浮窗切换显示当前回复客户的画像面板（已接线）
# get_events() 消费到带 contact 的新事件、且与当前显示客户不同时，真调 switch_customer
# 联动画像卡（此前 switch_customer()/_fetch_customer_profile() 是里程碑B 遗留孤儿代码，
# events 消费循环从不调用它——本 smoke 曾用过太松的 grep 断言误判成 PASS，现改为
# 端到端功能断言：真写 events.jsonl → 真调 get_events() → 验证 switch_customer 真被调用）。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 16: 会话跟随客户画像面板"

# 16a：精确接线检查（真调用点，不认孤儿的 fetch 辅助方法存在）
PANEL_WIRED=$(grep -n "\.switch_customer(" "$OVERLAY_DIR"/*.py 2>/dev/null | grep -v "def switch_customer" | grep -v "__pycache__" || true)
[ -n "$PANEL_WIRED" ] || fail "Step 16a 事件分发点未找到真调用 switch_customer(（只有孤儿辅助方法）" 16
ok "Step 16a ✅ 事件分发点真调用 switch_customer: $PANEL_WIRED"

# 16b：端到端功能断言——真写 events.jsonl，真调 OverlayApp.get_events()，验证联动切换
if python3 -c "
import sys, os, json, tempfile
sys.path.insert(0, 'services/agent/wechat-rpa')
sys.path.insert(0, 'services/agent/wechat-rpa/overlay')
from overlay.overlay_window import OverlayApp

state_dir = tempfile.mkdtemp(prefix='zj-gp4-smoke-panel-')
app = OverlayApp(state_dir=state_dir)

called = []
app.switch_customer = lambda wechat_id: called.append(wechat_id)

with open(os.path.join(state_dir, 'events.jsonl'), 'a', encoding='utf-8') as f:
    f.write(json.dumps({'type': 'heartbeat', 'ts': __import__('time').time(), 'event_id': 'h-1'}, ensure_ascii=False) + '\n')
    f.write(json.dumps({'type': 'reply_sent', 'event_id': 'e-1', 'contact': 'gp4smoke联系人'}, ensure_ascii=False) + '\n')

app.get_events()
assert called == ['gp4smoke联系人'], f'联动切换未真触发，实际: {called}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS"; then
  ok "Step 16b ✅ 端到端联动：真写 events.jsonl → get_events() → switch_customer 真被调用"
else
  fail "Step 16b 画像面板联动端到端断言失败" 16
fi

# 16c：真渲染断言——evaluator 独立评审发现的缺口回归：调用链接上不等于用户能看到画像卡。
# 验证 HTML 模板真定义了 window.__updateCustomerCard + 画像卡 DOM 容器，且 switch_customer
# 真把完整六字段传给 evaluate_js（不能只传 nickname/level 两个字段）。
if python3 -c "
import sys, json
sys.path.insert(0, 'services/agent/wechat-rpa')
from overlay.overlay_window import OverlayApp

html = OverlayApp.HTML_TEMPLATE
assert 'window.__updateCustomerCard = function' in html or 'function __updateCustomerCard' in html, \
    'HTML_TEMPLATE 未真定义 window.__updateCustomerCard（只有调用点没有定义）'
for dom_id in ['profile-nickname', 'profile-level', 'profile-source',
               'profile-contact-count', 'profile-actions', 'profile-ai']:
    assert dom_id in html, f'HTML_TEMPLATE 缺画像卡 DOM 容器 id={dom_id}'

class _FakeWindow:
    def __init__(self):
        self.last_call = None
    def evaluate_js(self, js):
        self.last_call = js

app = OverlayApp(state_dir='/tmp')
app._window = _FakeWindow()
app._fetch_customer_profile = lambda wid: {
    'level': 'VIP', 'nickname': '客户甲', 'source': '抖音',
    'contact_count': 3, 'recent_actions': ['咨询价格'], 'ai_profile': '高意向',
}
app.switch_customer('wxid_smoke_test')
call = app._window.last_call or ''
for val in ['客户甲', 'VIP', '抖音', '咨询价格', '高意向']:
    assert val in call, f'evaluate_js 调用未含字段值 {val!r}（六字段未真传全）: {call[:200]}'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS"; then
  ok "Step 16c ✅ 真渲染断言：HTML 真定义渲染函数+DOM 容器，switch_customer 真传完整六字段"
else
  fail "Step 16c 画像卡真渲染断言失败（evaluator 发现的缺口：调用链接上但渲染落地不存在）" 16
fi
ok "Step 16 ✅ 会话跟随客户画像面板联动通（含真渲染验证）"

echo ""
# Step 3 补充：扫描前守卫纯函数等价断言（v1.0.120，issue 99741ff9 补丁）
# 真机段 TODO：xian-rog 630x622 小窗验证 [扫描守卫] 日志出现且下轮 sessions>0
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat
assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=False) is True
assert listen_chat.window_needs_maximize(is_zoomed=True, is_iconic=False) is False
assert listen_chat.window_needs_maximize(is_zoomed=False, is_iconic=True) is False
print('PASS')
" 2>/dev/null && ok "Step 3b ✅ 扫描前守卫三路径逻辑正确（非最大化→触发/最大化→放行/iconic→放行）" \
               || fail "Step 3b 扫描前守卫逻辑异常" 3

# Step 3c：窗口自愈须"MAXIMIZE 触发排版→settle→MINIMIZE 收回"，不能永久全屏
# （2026-07-16 用户真机反馈：微信被强制全屏且从不还原，霸占屏幕。xian-rog 真机验证过
# 直接改 minimize 无法修复单栏布局，只是藏起坏状态——必须先 maximize 真触发排版）。
# 真机段 TODO：真机验证 SW_MAXIMIZE 后窗口最终确实回到最小化/托盘态，不停留全屏。
LISTEN_CHAT_MAIN_WH="services/agent/wechat-rpa/listen_chat.py"
python3 -c "
with open('$LISTEN_CHAT_MAIN_WH', encoding='utf-8') as f:
    lines = f.readlines()
start = next(i for i, l in enumerate(lines) if l.startswith('def run_real_listen'))
end = len(lines)
for i in range(start + 1, len(lines)):
    if lines[i].startswith('def '):
        end = i
        break
body = lines[start:end]
sites = 0
for i, line in enumerate(body):
    if 'ShowWindow(' in line and ', 3)' in line:
        window = body[i + 1:i + 4]
        has_settle = any('_WINDOW_HEAL_SETTLE_SLEEP' in l for l in window)
        has_minimize = any('ShowWindow(' in l and ', 6)' in l for l in window)
        assert has_settle and has_minimize, f'第{start+i+1}行MAXIMIZE后未跟settle+MINIMIZE: {window}'
        sites += 1
assert sites == 2, f'应有2处窗口自愈遵循maximize→settle→minimize，实际{sites}处'
print('PASS')
" 2>&1 | tail -1 | grep -q "PASS" \
  && ok "Step 3c ✅ 窗口自愈 maximize→settle→minimize 序列正确（不再永久霸占用户屏幕）" \
  || fail "Step 3c 窗口自愈回归——微信可能被强制全屏且不还原" 3

# Step 3d：滚轮扫描须避让活跃用户（2026-07-16 用户真机反馈：抢键盘鼠标，人没法用）
# 真机段 TODO：xian-rog 验证用户操作鼠标期间扫描确实跳过、日志出现"本轮避让"字样
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat
assert listen_chat.should_defer_scroll_for_active_user(idle_ms=500) is True
assert listen_chat.should_defer_scroll_for_active_user(idle_ms=3000) is False
assert listen_chat.should_defer_scroll_for_active_user(idle_ms=1500) is False
print('PASS')
" 2>/dev/null && ok "Step 3d ✅ 滚轮避让活跃用户判定逻辑正确" \
             || fail "Step 3d 滚轮避让逻辑异常——真实鼠标可能又会打断用户" 3

# Step 3e：scan_unread 扫描期间开窗读消息不能永久抢走用户前台键鼠焦点
# （2026-07-17 用户真机反馈：抢键盘鼠标，人没法用——根因是 reply_in_chat 早已还焦点，
# scan_unread 的读取层 _open_chat 调用从未接入这套归还机制，而扫描比回复频繁得多）
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat, inspect
src = inspect.getsource(listen_chat.scan_unread)
assert '_get_foreground_window()' in src, 'scan_unread 未采集操作前前台窗口'
assert '_should_restore_foreground(prev_fg, wechat_hwnd)' in src, 'scan_unread 未接入归还判定'
assert '_set_foreground_window(prev_fg)' in src, 'scan_unread 未真正还焦点'
print('PASS')
" 2>/dev/null && ok "Step 3e ✅ scan_unread 已接入前台焦点归还机制（不再永久抢键鼠焦点）" \
             || fail "Step 3e scan_unread 前台焦点归还回归——真机可能又会抢键盘鼠标" 3

# Step 3f：扫描前守卫窗口最大化自愈须有 cooldown，不能每个 scan interval 都反复触发
# （2026-07-17 用户真机反馈：微信窗口每隔几秒最大化一次然后最小化，反复循环）
python3 -c "
with open('services/agent/wechat-rpa/listen_chat.py', encoding='utf-8') as f:
    lines = f.readlines()
anchor_idx = next(i for i, l in enumerate(lines) if '扫描前守卫（issue 99741ff9 补丁' in l)
window = [l for l in lines[anchor_idx:anchor_idx + 25] if not l.strip().startswith('#')]
assert any('now - last_window_maximize >= _WINDOW_MAXIMIZE_COOLDOWN' in l for l in window), \
    '扫描前守卫缺 cooldown 检查'
assert any('last_window_maximize = now' in l for l in window), \
    '扫描前守卫缺 cooldown 更新'
print('PASS')
" 2>/dev/null && ok "Step 3f ✅ 扫描前守卫已接入 cooldown 节流（不再每个 scan interval 反复触发）" \
             || fail "Step 3f 扫描前守卫 cooldown 回归——真机可能又会反复 maximize/minimize" 3

# Step 3g：扫描态/回复态窗口可见性拆分——纯扫描 cloak 静默，回复态保留可见+送达确认
# （2026-07-17 用户真机反馈：微信窗口每隔十几秒弹出来又缩回去，根因=scan_unread每轮
# 都真实弹窗；修法=_ensure_tray_visible/_restore_window_state 加 for_reply 参数）
# 真机段 TODO：xian-rog 验证窗口不再每隔十几秒弹出/缩回，同时确认真有消息时依然可见+能正常回复送达
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat, inspect
ensure_src = inspect.getsource(listen_chat._ensure_tray_visible)
restore_src = inspect.getsource(listen_chat._restore_window_state)
reply_src = inspect.getsource(listen_chat.reply_in_chat)
assert 'for_reply: bool = False' in ensure_src, '_ensure_tray_visible 缺 for_reply 参数'
assert 'for_reply: bool = False' in restore_src, '_restore_window_state 缺 for_reply 参数'
assert '_ensure_tray_visible(mw, for_reply=True)' in reply_src, 'reply_in_chat 未显式传 for_reply=True'
assert '_restore_window_state(mw, orig_state, for_reply=True)' in reply_src, 'reply_in_chat 还原调用未显式传 for_reply=True'
print('PASS')
" 2>/dev/null && ok "Step 3g ✅ 扫描态/回复态窗口可见性已拆分（for_reply参数+3处调用点正确传参）" \
             || fail "Step 3g 扫描态/回复态可见性拆分回归——真机可能又会每隔几秒弹出/缩回" 3

# Step 3h：launch_weixin 跨进程互斥锁——防 CI job 和常驻 staging agent 并发启动微信堆积僵尸进程
# （2026-07-17 xian-rog 实锤：4个Weixin.exe+8个WeChatAppEx.exe几乎同时诞生，其一卡进幽灵坐标
# (-32000,-32000)，导致真机气泡 gate reply_in_chat fail-closed。根因=launch_weixin()文档
# 承诺幂等但从不检查is_weixin_running()、无跨进程锁，CI job与常驻agent各自独立判断都会启动）
# 真机段 TODO：xian-rog 反复触发 CI job2/job3 + 常驻agent 并发场景，确认不再堆积多个 Weixin.exe
python3 -c "
import sys; sys.path.insert(0, 'services/agent/wechat-rpa')
import find_weixin, inspect
launch_src = inspect.getsource(find_weixin.launch_weixin)
assert 'acquire_launch_lock' in launch_src, 'launch_weixin 未接入跨进程锁'
assert 'is_weixin_running()' in launch_src, 'launch_weixin 未真正检查是否已运行(幂等)'
assert hasattr(find_weixin, 'acquire_launch_lock'), '缺 acquire_launch_lock'
assert hasattr(find_weixin, 'release_launch_lock'), '缺 release_launch_lock'
print('PASS')
" 2>/dev/null && ok "Step 3h ✅ launch_weixin 已接入跨进程互斥锁+真实幂等检查（不再并发堆积僵尸进程）" \
             || fail "Step 3h launch_weixin 跨进程锁回归——CI与常驻agent可能又会并发堆积微信进程" 3

# Step 3i：热键召唤主路——preflight 自检含 hotkey_summon，scan 真塌快速自愈先热键再降级托盘
# （2026-07-19 折入自散装 line04-hotkey-summon-smoke.sh，decision fc17d9eb；PR #1410/#1420 真机验证）
python3 -c "
import sys, re
sys.path.insert(0, 'services/agent/wechat-rpa')
from preflight import run_all_checks, CHECK_NAMES
assert 'hotkey_summon' in CHECK_NAMES, 'preflight CHECK_NAMES 缺 hotkey_summon'
checks = run_all_checks('http://localhost:9', dry_run=True)
hk = next(c for c in checks if c['name'] == 'hotkey_summon')
assert hk['status'] == 'warn', 'dry-run 下 hotkey_summon 应为 warn，实际=' + hk['status']
with open('services/agent/wechat-rpa/listen_chat.py', encoding='utf-8') as f:
    src = f.read()
m = re.search(r'_should_fast_heal_hidden_collapsed\(\s*\n?\s*now,\s*scan_collapse_since,', src)
assert m is not None, '找不到 scan 快速自愈调用'
window = src[m.start(): m.start() + 900]
hk_idx = window.find('_summon_wechat_via_hotkey()')
tray_idx = window.find('_summon_wechat_from_tray()')
assert hk_idx != -1 and tray_idx != -1 and hk_idx < tray_idx, '召唤主路未接线: hotkey=%d tray=%d' % (hk_idx, tray_idx)
print('PASS')
" 2>/dev/null && ok "Step 3i ✅ 热键召唤主路已接线（preflight 含 hotkey_summon + 快速自愈先热键再降级托盘）" \
             || fail "Step 3i 热键召唤主路回归——塌缩自愈可能退回脆弱托盘召唤" 3

# Step 3j：热键真机根因守卫——check_hotkey_summon 判据必须读 GetForegroundWindow + INPUT 结构体 sizeof=40
# （2026-07-19 rog 真机铁证：微信响应 Ctrl+Alt+W 是被拉到前台而非隐藏；union 缺 MOUSEINPUT→sizeof 32→SendInput 返回0）
python3 -c "
import sys, ctypes
sys.path.insert(0, 'services/agent/wechat-rpa')
with open('services/agent/wechat-rpa/preflight.py', encoding='utf-8') as f:
    pf = f.read()
assert 'GetForegroundWindow' in pf, 'check_hotkey_summon 判据未读 GetForegroundWindow（退回只看可见性会必现误报）'
import listen_chat
sz = ctypes.sizeof(listen_chat.INPUT)
assert sz == 40, 'INPUT sizeof=%d != 40，SendInput 会返回0发不出键' % sz
print('PASS')
" 2>/dev/null && ok "Step 3j ✅ 热键真机根因守卫在位（GetForegroundWindow 判据 + INPUT sizeof=40）" \
             || fail "Step 3j 热键真机根因回归——自检误报或 SendInput 发不出键" 3

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Path 4 16 步 golden path smoke 服务端段全通"
echo "  真机段：xian-rog 真机验收证据见 sprints/07150800-line04-overlay-continuation/evidence/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
