#!/usr/bin/env bash
# Sprint 2.1e — build-install-pack 产物结构 + reproducibility test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$AGENT_DIR/scripts/build-install-pack.sh"

echo "[test] step 1: build-install-pack.sh 存在"
test -x "$BUILD_SCRIPT" || { echo "FAIL $BUILD_SCRIPT not found or not executable"; exit 1; }

echo "[test] step 2: 跑构建（需已 npm install + npm run build）"
cd "$AGENT_DIR"
test -d node_modules || { echo "FAIL: agent node_modules missing"; exit 1; }
test -f dist/index.js || { echo "FAIL: dist/index.js missing — run 'npm run build' first"; exit 1; }

bash "$BUILD_SCRIPT" || { echo "FAIL: build-install-pack.sh exit non-zero"; exit 1; }

echo "[test] step 3: 产物清单"
TARGZ=$(ls dist-installpack/zenithjoy-agent-v*.tar.gz 2>/dev/null | head -1)
SHA256=$(ls dist-installpack/zenithjoy-agent-v*.tar.gz.sha256 2>/dev/null | head -1)
test -f "$TARGZ" || { echo "FAIL: tar.gz not produced"; exit 1; }
test -f "$SHA256" || { echo "FAIL: sha256 not produced"; exit 1; }

echo "[test] step 4: tar.gz 含必需文件"
TMPDIR=$(mktemp -d)
tar -xzf "$TARGZ" -C "$TMPDIR"
INSTALL_DIR=$(ls "$TMPDIR" | head -1)
test -f "$TMPDIR/$INSTALL_DIR/zenithjoy-agent.exe" || { echo "FAIL: .exe missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/start.bat" || { echo "FAIL: start.bat missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/.env.template" || { echo "FAIL: .env.template missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/README.txt" || { echo "FAIL: README missing"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/node_modules/playwright-core/index.js" || { echo "FAIL: playwright-core/index.js missing — publisher scripts will fail MODULE_NOT_FOUND"; exit 1; }
test -f "$TMPDIR/$INSTALL_DIR/node_modules/playwright-core/package.json" || { echo "FAIL: playwright-core/package.json missing"; exit 1; }
test -d "$TMPDIR/$INSTALL_DIR/node_modules/playwright-core/lib" || { echo "FAIL: playwright-core/lib/ missing"; exit 1; }

echo "[test] step 5: .env.template 含 3 个必需 key"
for k in ZENITHJOY_API_BASE ZENITHJOY_LICENSE ZENITHJOY_CHROME_DEBUG_PORT; do
  grep -q "^${k}=" "$TMPDIR/$INSTALL_DIR/.env.template" || { echo "FAIL: $k missing in .env.template"; exit 1; }
done

echo "[test] step 6: sha256 与 tar.gz 实际 hash 一致"
ACTUAL=$(shasum -a 256 "$TARGZ" | awk '{print $1}')
EXPECTED=$(awk '{print $1}' "$SHA256")
test "$ACTUAL" = "$EXPECTED" || { echo "FAIL: sha256 mismatch ($ACTUAL vs $EXPECTED)"; exit 1; }

rm -rf "$TMPDIR"
echo "[test] OK"
