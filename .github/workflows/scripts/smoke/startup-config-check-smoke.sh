#!/usr/bin/env bash
# startup-config-check-smoke.sh
#
# 哨兵第一样板冒烟：中台启动 env 自检 + /health 暴露配置状态 + proven-to-fire。
# 治根 2026-06-19 生产 mmv 漏 TOAPI_API_KEY → 微信客服 AI 静默不回。
#
# 验证三件事：
#   1) apps/api 能起来，/health 返回含 config 字段且 config.ok=true（CI 注入测试 env 全到位）
#   2) proven-to-fire：node 直接 require dist 的 verifyStartupConfig，传缺 TOAPI_API_KEY 的对象 → ok=false
#   3) /health 在缺 key 时 config.ok=false 且 missing 列出缺的 key
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/apps/api"

PASS=0
FAIL=0
assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected '$2', got '$1')"; FAIL=$((FAIL+1)); fi
}

echo "=== 0: 构建 apps/api（产出 dist/startup-check.js + dist/index.js）==="
npm run build >/tmp/zj-startup-build.log 2>&1 || { echo "FAIL: build 失败"; cat /tmp/zj-startup-build.log; exit 1; }
test -f dist/startup-check.js || { echo "FAIL: dist/startup-check.js 不存在"; exit 1; }
echo "  PASS: build OK"

echo "=== 1: proven-to-fire — 缺 TOAPI_API_KEY → verifyStartupConfig ok=false ==="
FIRE_OK=$(node -e "const m=require('./dist/startup-check.js'); const r=m.verifyStartupConfig({DATABASE_URL:'x',BETTER_AUTH_SECRET:'y'}); console.log(r.ok);")
assert "$FIRE_OK" "false" "缺 TOAPI_API_KEY → ok=false（proven-to-fire）"
FIRE_MISS=$(node -e "const m=require('./dist/startup-check.js'); const r=m.verifyStartupConfig({DATABASE_URL:'x',BETTER_AUTH_SECRET:'y'}); console.log(r.missing.includes('TOAPI_API_KEY'));")
assert "$FIRE_MISS" "true" "missing 列出 TOAPI_API_KEY"

echo "=== 1b: 全给 → ok=true ==="
FULL_OK=$(node -e "const m=require('./dist/startup-check.js'); const e={}; for(const k of m.REQUIRED_ENV) e[k]='v'; console.log(m.verifyStartupConfig(e).ok);")
assert "$FULL_OK" "true" "REQUIRED_ENV 全给 → ok=true"

echo "=== 2: 起 apps/api，curl /health 断言含 config 且 config.ok=true ==="
PORT=5299
export PORT
export NODE_ENV=test
export TOAPI_API_KEY="smoke-toapi-key"
export DATABASE_URL="postgres://smoke:smoke@localhost:5432/smoke"
export BETTER_AUTH_SECRET="smoke-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

node dist/index.js >/tmp/zj-startup-server.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

# 等服务起来（最多 ~10s）
for i in $(seq 1 20); do
  if curl -s --max-time 2 -o /dev/null "http://localhost:$PORT/health" 2>/dev/null; then break; fi
  sleep 0.5
done

curl -s --max-time 3 -o /tmp/zj-health.json "http://localhost:$PORT/health" || { echo "FAIL: /health 不可达"; cat /tmp/zj-startup-server.log; exit 1; }
HAS_CONFIG=$(node -e "const j=require('/tmp/zj-health.json'); console.log(typeof j.config==='object' && j.config!==null);")
assert "$HAS_CONFIG" "true" "/health 响应含 config 字段"
CONFIG_OK=$(node -e "const j=require('/tmp/zj-health.json'); console.log(j.config && j.config.ok===true);")
assert "$CONFIG_OK" "true" "/health config.ok=true（测试 env 全到位）"

echo "=== 3: 缺 key 时 /health config.ok=false ==="
# 直接用 dist 的 verifyStartupConfig 模拟 process.env 缺 TOAPI_API_KEY 时 /health 会暴露的内容
HEALTH_MISS=$(node -e "const m=require('./dist/startup-check.js'); const r=m.verifyStartupConfig({DATABASE_URL:'x',BETTER_AUTH_SECRET:'y'.repeat(32)}); console.log(JSON.stringify({ok:r.ok,missing:r.missing}));")
echo "  缺 key 时 /health.config 会是: $HEALTH_MISS"
HEALTH_MISS_OK=$(node -e "const m=require('./dist/startup-check.js'); const r=m.verifyStartupConfig({DATABASE_URL:'x',BETTER_AUTH_SECRET:'y'.repeat(32)}); console.log(r.ok===false && r.missing.includes('TOAPI_API_KEY'));")
assert "$HEALTH_MISS_OK" "true" "缺 TOAPI_API_KEY → config.ok=false 且 missing 含它"

echo ""
echo "Smoke PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
