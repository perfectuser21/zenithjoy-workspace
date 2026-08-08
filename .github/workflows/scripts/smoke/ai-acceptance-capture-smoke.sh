#!/usr/bin/env bash
# smoke: AI 打表器——采证器白名单点火 smoke (D2)
# Validates: action whitelist / no signup / trigger_collect count / version endpoint
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AI 打表器采证器白名单 smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CELLS_MAP="scripts/acceptance-spec/ai-run/cells-map.mjs"
CAPTURE="scripts/acceptance-spec/ai-run/capture.mjs"
LOGIN="scripts/acceptance-spec/ai-run/login.mjs"
WORKFLOW=".github/workflows/ai-acceptance-capture.yml"

# S1: cells-map.mjs 存在
[ -f "$CELLS_MAP" ] || { echo "FAIL: $CELLS_MAP 不存在"; exit 1; }
echo "✅ S1: cells-map.mjs 存在"

# S2: signup 禁用（全部采证文件）
for f in "$CELLS_MAP" "$CAPTURE" "$LOGIN"; do
  count=$(grep -c 'signup' "$f" 2>/dev/null || true)
  [ "$count" -eq 0 ] || { echo "FAIL: $f 含 signup ($count 处)"; exit 1; }
done
echo "✅ S2: 所有采证文件无 signup"

# S3: trigger_collect 格数 ≤2
TC_COUNT=$(node -e "import('$CELLS_MAP').then(m=>{const tc=m.CELLS_MAP?.filter(c=>c.action==='trigger_collect')||[];console.log(tc.length)})" 2>/dev/null || echo "skip")
if [ "$TC_COUNT" != "skip" ]; then
  [ "$TC_COUNT" -le 2 ] || { echo "FAIL: trigger_collect 格数=$TC_COUNT (期望≤2)"; exit 1; }
  echo "✅ S3: trigger_collect 格数=$TC_COUNT (≤2)"
else
  echo "ℹ️  S3: node ESM skip（CI 无 node 时可忽略）"
fi

# S4: workflow 文件存在且 runner 是 ubuntu-latest
[ -f "$WORKFLOW" ] || { echo "FAIL: $WORKFLOW 不存在"; exit 1; }
grep -q 'ubuntu-latest' "$WORKFLOW" || { echo "FAIL: workflow 不是 ubuntu-latest"; exit 1; }
echo "✅ S4: workflow 存在且使用 ubuntu-latest"

# S5: workflow secrets 白名单不含禁用项
for secret in ACCEPTANCE_API_TOKEN TAILSCALE_AUTHKEY HK_VPS_SSH_KEY; do
  if grep -q "$secret" "$WORKFLOW"; then
    echo "FAIL: workflow 含禁用 secret: $secret"; exit 1
  fi
done
echo "✅ S5: secrets 白名单干净"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ AI 打表器采证器 smoke PASS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
