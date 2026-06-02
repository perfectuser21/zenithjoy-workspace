#!/usr/bin/env bash
# wechat-ilink-smoke.sh — Path 4 Step 1：微信 iLink 个人号通道 smoke
#
# 真实链路：mock iLink server（替代 ilinkai.weixin.qq.com）+ curl 三个新端点 + psql 断言。
# 覆盖登录闭环：login-start 拉二维码 → login-status 扫码 bound → DB 写 burner session(extra_json 含 token)。
#
# 前置（由 CI real-env-smoke 提供）：
#   - apps/api 已启动，且 ILINK_BASE_URL=http://localhost:7799（指向本脚本起的 mock server）
#   - Postgres 可用，DB_URL 指向 zenithjoy schema
#
# poller 真实 LLM 闭环（B→C→D→E）不在 smoke 内（需真 DeepSeek + 真扫码），
# 由 Lead 在 xian-rog 手动自验留证（截图 + DB 记录）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
DB_URL="${DB_URL:-postgres://zenithjoy:zenithjoy@localhost:5432/zenithjoy}"
MOCK_PORT=7799
TEST_TENANT="11111111-1111-1111-1111-111111111111"
TEST_AGENT_ROW="22222222-2222-2222-2222-222222222222"
TEST_AGENT_KEY="e2e-ilink-burner"

echo "[smoke] API_BASE=$API_BASE  ILINK mock=:$MOCK_PORT"

# ── 1. 起 mock iLink server ───────────────────────────────────────────────
cat > /tmp/ilink-mock.cjs <<'JS'
const http = require('http');
const PORT = 7799;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/auth/login-start')) {
      const { session_id } = JSON.parse(body || '{}');
      return res.end(JSON.stringify({ session_id, qr_url: `http://localhost:7799/qr/${session_id}` }));
    }
    if (req.url.includes('/auth/poll')) {
      // 模拟扫码已完成 → 直接返 bound + token
      return res.end(JSON.stringify({
        status: 'bound', token: 'mock-bearer-token',
        uin: 'mock-uin-123', wxid: 'wxid_mock', nickname: '测试小号',
      }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ errcode: -404 }));
  });
}).listen(PORT, () => console.log('ilink-mock up :' + PORT));
JS
node /tmp/ilink-mock.cjs &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
sleep 1

# ── 2. 建测试 tenant + agent（FK 链）─────────────────────────────────────────
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO zenithjoy.tenants (id, name) VALUES ('$TEST_TENANT', 'e2e-ilink')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO zenithjoy.agents (id, tenant_id, agent_id, platform, status)
  VALUES ('$TEST_AGENT_ROW', '$TEST_TENANT', '$TEST_AGENT_KEY', 'wechat', 'online')
  ON CONFLICT (id) DO NOTHING;
DELETE FROM zenithjoy.agent_platform_sessions
  WHERE agent_id='$TEST_AGENT_ROW' AND platform='wechat_personal_ilink';
SQL

# ── 3. login-start → 拿 session_id + qr_url ─────────────────────────────────
START_RESP=$(curl -fsS -X POST "$API_BASE/api/wechat/ilink-login-start" \
  -H 'Content-Type: application/json' -d "{\"agent_id\":\"$TEST_AGENT_ROW\"}")
echo "[smoke] login-start: $START_RESP"
SESSION_ID=$(echo "$START_RESP" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);if(!j.qr_url)throw new Error("no qr_url");process.stdout.write(j.session_id)})')
[ -n "$SESSION_ID" ] || { echo "FAIL: 无 session_id"; exit 1; }

# ── 4. login-status → bound ────────────────────────────────────────────────
ST=$(curl -fsS "$API_BASE/api/wechat/ilink-login-status?session_id=$SESSION_ID" \
  | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).status))')
echo "[smoke] login-status: $ST"
[ "$ST" = "bound" ] || { echo "FAIL: status 非 bound（$ST）"; exit 1; }

# ── 5. DB 断言：burner session = bound 且 extra_json 含 token ─────────────────
CNT=$(psql "$DB_URL" -tA -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions
  WHERE id='$SESSION_ID' AND platform='wechat_personal_ilink' AND role='burner'
    AND status='bound' AND extra_json->>'token' = 'mock-bearer-token'")
echo "[smoke] bound burner session 行数: $CNT"
[ "$CNT" = "1" ] || { echo "FAIL: agent_platform_sessions bound 行断言失败"; exit 1; }

echo "[smoke] ✅ PASS — iLink 登录闭环（login-start → bound → DB 落库）跑通"
