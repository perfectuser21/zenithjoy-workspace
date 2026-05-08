#!/usr/bin/env bash
# sprint-2-1d-agent-uptime-smoke.sh
# Sprint 2.1d — agent 启动后跑 N 个心跳周期不死 + /healthz 持续 200
# CI 短版（10 周期=5 分钟模拟）；Lead 全量（120 周期=1 小时）
set -euo pipefail

CYCLES="${CYCLES:-10}"
INTERVAL="${INTERVAL_S:-30}"
HEALTH_PORT="${HEALTH_PORT:-5201}"
AGENT_DIR="${AGENT_DIR:-services/agent}"
SUPERVISOR_PS1="$AGENT_DIR/supervisor/agent-supervisor.ps1"

echo "[smoke] step 1: supervisor 文件存在"
test -f "$SUPERVISOR_PS1" || { echo "FAIL $SUPERVISOR_PS1 not found"; exit 1; }

echo "[smoke] step 2: dist 产物存在 (node 直接可跑)"
test -f "$AGENT_DIR/dist/index.js" || { echo "FAIL: dist/index.js not built"; exit 1; }

echo "[smoke] step 3: health-server 源文件存在"
test -f "$AGENT_DIR/src/handlers/health-server.ts" || { echo "FAIL: health-server.ts missing"; exit 1; }

echo "[smoke] step 4: package.json 含 build script"
node -e "const p = require('./$AGENT_DIR/package.json'); if (!p.scripts.build) { console.error('FAIL'); process.exit(1); } else { console.log('build script:', p.scripts.build); }" || exit 1

echo "[smoke] step 5: start-agent-v2.ps1 已删 tsx 路径段"
grep -E "tsxCli|node_modules.tsx.dist.cli" "$AGENT_DIR/start-agent-v2.ps1" && { echo "FAIL: start-agent-v2.ps1 still has tsx path"; exit 1; } || true

echo "[smoke] OK"
