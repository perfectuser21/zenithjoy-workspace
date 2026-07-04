#!/usr/bin/env bash
# smoke: POST /api/agent/credit/deduct + GET /api/agent/credit/balance
# + GET /api/acquisition/pending-keyword-tasks 余额耗尽返空列表
set -euo pipefail

BASE="${API_BASE:-http://localhost:3000}"
LICENSE_KEY="${TEST_LICENSE_KEY:-smoke-license-key}"

echo "[agent-credit-smoke] === GET /api/agent/credit/balance ==="
BALANCE_RESP=$(curl -sf -X GET \
  -H "X-License-Key: $LICENSE_KEY" \
  "$BASE/api/agent/credit/balance")
echo "$BALANCE_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('ok') == True, f'balance ok!=true: {d}'
assert 'data' in d and 'balance' in d['data'], f'no balance field: {d}'
print('balance OK:', d['data']['balance'])
"

echo "[agent-credit-smoke] === POST /api/agent/credit/deduct (expect 402 or success) ==="
# deduct 1 积分（若余额不足返 402，均属合法响应）
DEDUCT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "X-License-Key: $LICENSE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount":1,"reason":"smoke_test"}' \
  "$BASE/api/agent/credit/deduct")
if [ "$DEDUCT_STATUS" != "200" ] && [ "$DEDUCT_STATUS" != "402" ]; then
  echo "FAIL: deduct returned unexpected status $DEDUCT_STATUS"
  exit 1
fi
echo "deduct status OK: $DEDUCT_STATUS"

echo "[agent-credit-smoke] === GET /api/acquisition/pending-keyword-tasks (no license = empty) ==="
EMPTY_RESP=$(curl -sf "$BASE/api/acquisition/pending-keyword-tasks")
echo "$EMPTY_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('total', -1) == 0, f'expected empty without license: {d}'
print('no-license guard OK')
"

echo "[agent-credit-smoke] ALL PASSED"
