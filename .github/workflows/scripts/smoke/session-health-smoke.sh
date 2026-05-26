#!/bin/bash
# Session Health Smoke — 离线验证 check-health.js 输出格式
# 用法：SKIP_HTTP_CHECK=true bash session-health-smoke.sh

set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
REPORT="$ROOT/session-health-report.json"

echo "=== Session Health Smoke ==="

# 以 SKIP_HTTP_CHECK 模式跑 check-health.js（不发真实 HTTP 请求）
SKIP_HTTP_CHECK=true node "$ROOT/scripts/sessions/check-health.js" || true

if [ ! -f "$REPORT" ]; then
  echo "FAIL: session-health-report.json 不存在"; exit 1
fi

# 验证输出是 JSON array
python3 -c "
import json, sys
data = json.load(open('$REPORT'))
assert isinstance(data, list), 'FAIL: 不是 array'
assert len(data) == 35, f'FAIL: 期望 35 条目，实际 {len(data)}'
expected_keys = sorted(['checkedAt','expiresAt','platform','secretEnv','status'])
for i, item in enumerate(data):
    actual = sorted(item.keys())
    assert actual == expected_keys, f'item[{i}] keys mismatch: {actual}'
valid_statuses = {'ok','expired','invalid','missing'}
for item in data:
    assert item['status'] in valid_statuses, f'非法 status: {item[\"status\"]}'
print(f'OK: {len(data)} 条目，schema 校验通过')
"
echo "Smoke PASS"
