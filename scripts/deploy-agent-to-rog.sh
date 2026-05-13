#!/usr/bin/env bash
# scripts/deploy-agent-to-rog.sh
#
# rsync zenithjoy-agent → rog (xian-rog Lead 自检机) ~/zenithjoy-agent
#
# 使用前置:
#   - rog tailscale 已通 (100.98.253.95)
#   - rog SSH 已配 (asus user, key in ~/.ssh/id_rsa)
#   - 本机已 `pnpm -F @zenithjoy/agent build`
#
# 用法:
#   bash scripts/deploy-agent-to-rog.sh                     # 默认 dist 部署
#   ZJ_AGENT_SRC=services/agent bash scripts/deploy-agent-to-rog.sh   # 整目录 (dev)
#   DRY_RUN=1 bash scripts/deploy-agent-to-rog.sh           # 只打印 rsync 命令

set -euo pipefail

ROG_HOST="${ROG_HOST:-100.98.253.95}"
ROG_USER="${ROG_USER:-asus}"
ROG_PATH="${ROG_PATH:-/c/Users/asus/zenithjoy-agent}"
SRC="${ZJ_AGENT_SRC:-services/agent/dist}"

if [ ! -d "$SRC" ]; then
  echo "[deploy] source dir not found: $SRC" >&2
  echo "[deploy] 先跑: pnpm -F @zenithjoy/agent build" >&2
  exit 1
fi

RSYNC_OPTS="-avz --delete --exclude=node_modules --exclude=.git --exclude=*.log"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "[deploy] DRY-RUN: rsync $RSYNC_OPTS $SRC/ ${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
  exit 0
fi

echo "[deploy] rsync $SRC/ → ${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
eval rsync $RSYNC_OPTS "$SRC/" "${ROG_USER}@${ROG_HOST}:${ROG_PATH}/"
echo "[deploy] done"
