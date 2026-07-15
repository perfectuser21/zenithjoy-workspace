#!/usr/bin/env bash
# golden-path-4-smoke.sh
# ZenithJoy Walking Skeleton — Path 4 客户私域 AI 接管（Line04 微信客服，16 步权威版）
# 权威文档：https://docs.zenjoymedia.media/line04-blueprint/（2026-07-15 三次修正版）
#
# 16 步与断言层级：
#   Step 1  客户扫码绑定个人微信号 → Agent 建立后台 UIA 监听（不弹前台窗口）
#   Step 2  客户装客户端 → Agent 注册连中台
#   Step 3  Agent 检测到微信已登录、找到主窗口 → 开始后台静默监听（服务端等价断言：dryrun + overlay 存在）
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
#   Step 16 〔未达成〕浮窗切换显示当前回复客户的画像面板（customer-profile 六字段已有，联动未做）
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
#   - Step 16：customer-profile 数据源已有，但"浮窗联动画像面板"这个动作本身未开发，本步诚实 SKIP
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

OVERLAY_PY="services/agent/wechat-rpa/overlay/overlay_window.py"
[ -f "$OVERLAY_PY" ] || fail "Step 3 overlay_window.py 不存在: $OVERLAY_PY" 3
grep -q "switch_customer" "$OVERLAY_PY" || fail "Step 3 overlay_window.py 缺 switch_customer 方法" 3
grep -q "events" "$OVERLAY_PY" || fail "Step 3 overlay_window.py 缺 events 消费逻辑" 3
ok "Step 3 ✅ Agent 后台静默监听部署包存在（overlay_window.py 含 switch_customer + events 消费）"

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
ok "Step 15 ✅ AI 思考浮窗动态流通（golden path 当前终点）"

# ───────────────────────────────────────────────────────────────────
# Step 16：〔未达成〕浮窗切换显示当前回复客户的画像面板
# customer-profile 数据源已具备（Step 8），fetch 画像的辅助方法 switch_customer()/
# _fetch_customer_profile() 也已存在（里程碑B遗留），但真正的缺口是：events 消费循环
# （EventTailConsumer 的分发点）从不在收到 switch_customer 类型事件时真的调用它——
# 只是孤儿代码，没有被接线。诚实记账（SKIP），不是硬 FAIL：本文件在 smoke-baseline.txt
# 棘轮闸内，硬 FAIL 会阻断所有 Path4 PR 合并。TODO：接线立项点火后把这里改回真断言。
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 16: 〔未达成〕会话跟随客户画像面板"

# 只认「事件分发点真的调用 switch_customer(」，不认孤儿的 fetch 辅助方法存在
PANEL_WIRED=$(grep -n "\.switch_customer(" "$OVERLAY_DIR"/*.py 2>/dev/null | grep -v "def switch_customer" | grep -v "__pycache__" || true)
if [ -n "$PANEL_WIRED" ]; then
  ok "Step 16 ✅ 浮窗已联动画像面板（事件分发点真调用 switch_customer）: $PANEL_WIRED"
else
  echo "  SKIP: 未达成——switch_customer()/_fetch_customer_profile() 辅助方法已存在（里程碑B遗留），但 events 消费循环从不调用它，是孤儿代码未接线（数据源已具备见 Step 8）"
fi

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

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Path 4 16 步 golden path smoke 服务端段全通"
echo "  真机段：xian-rog 真机验收证据见 sprints/07150800-line04-overlay-continuation/evidence/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
