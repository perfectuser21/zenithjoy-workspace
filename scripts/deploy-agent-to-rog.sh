#!/usr/bin/env bash
# deploy-agent-to-rog.sh — Path 4 ws1 — 把 zenithjoy-agent + wechat-rpa 同步到 rog Windows 主机
#
# rog-xian: USER=asus, USERPROFILE=C:\Users\asus, agent 已部署 ~/zenithjoy-agent/
#
# 用法：
#   ./scripts/deploy-agent-to-rog.sh                # 真同步
#   ./scripts/deploy-agent-to-rog.sh --check-only   # 探活模式（仅 ssh 通 + 目录存在检查）
#
# 输出：
#   ✅ DEPLOYED 或 ❌ FAILED + 原因

set -uo pipefail

ROG_HOST="${ROG_HOST:-rog-xian}"
ROG_USER="${ROG_USER:-asus}"
ROG_TARGET="${ROG_TARGET:-~/zenithjoy-agent}"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)/services/agent"

CHECK_ONLY=0
if [ "${1:-}" = "--check-only" ]; then
  CHECK_ONLY=1
fi

log_info() { echo "[deploy-agent-to-rog] $*"; }
log_fail() { echo "❌ FAILED: $*" >&2; }
log_ok()   { echo "✅ DEPLOYED: $*"; }

# ─── 探活：ssh 通 ─────────────────────────────────────────────────────────
log_info "探活 ssh ${ROG_HOST} ..."
if ! ssh -o ConnectTimeout=8 -o BatchMode=yes "${ROG_HOST}" "echo ok" >/dev/null 2>&1; then
  log_fail "rog-xian unreachable: ssh ${ROG_HOST} 连不上（确认 tailscale + ssh key）"
  echo "rog-xian.NOT_reachable"
  exit 2
fi
echo "rog-xian.reachable"

log_info "探活目标目录 ${ROG_TARGET} ..."
if ! ssh "${ROG_HOST}" "test -d ${ROG_TARGET} || mkdir -p ${ROG_TARGET}" 2>/dev/null; then
  log_fail "无法在 rog 上创建/访问 ${ROG_TARGET}"
  exit 3
fi
echo "target.reachable ${ROG_TARGET}"

if [ "${CHECK_ONLY}" -eq 1 ]; then
  log_ok "check-only 模式：rog-xian.reachable + target.${ROG_TARGET} 都通过"
  exit 0
fi

# ─── 真同步（rsync over ssh）─────────────────────────────────────────────
log_info "rsync ${SOURCE_DIR}/ → ${ROG_HOST}:${ROG_TARGET}/"
if ! rsync -avz --delete \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='dist-pkg' \
    --exclude='*.exe' \
    --exclude='__pycache__' \
    "${SOURCE_DIR}/" "${ROG_HOST}:${ROG_TARGET}/" 2>&1; then
  log_fail "rsync 失败"
  exit 4
fi

# pip install requirements（如该文件存在）
log_info "ssh rog 检查 wechat-rpa/requirements.txt ..."
ssh "${ROG_HOST}" "
  if [ -f ${ROG_TARGET}/wechat-rpa/requirements.txt ]; then
    cd ${ROG_TARGET}/wechat-rpa && pip install -r requirements.txt
  else
    echo '[deploy] no requirements.txt yet (ws2 will create)'
  fi
" 2>&1

# 写 .env 占位（如不存在）— 后续 ws2 客户绑号时由 dashboard 写入真值
ssh "${ROG_HOST}" "
  if [ ! -f ${ROG_TARGET}/.env ]; then
    cat > ${ROG_TARGET}/.env <<'ENVEOF'
# zenithjoy-agent .env（path 4 ws1 placeholder）
ZENITHJOY_API_URL=
AGENT_ID=
CUSTOMER_NAME=
ENVEOF
    echo '[deploy] wrote placeholder .env'
  fi
" 2>&1

log_ok "rsync + pip install 完成（${ROG_HOST}:${ROG_TARGET}）"
exit 0
