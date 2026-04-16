#!/bin/bash
# deploy-pipeline-worker.sh — 部署 pipeline-worker LaunchAgent
#
# 用法：
#   bash scripts/deploy-pipeline-worker.sh          # 部署
#   bash scripts/deploy-pipeline-worker.sh --remove  # 卸载

set -euo pipefail

LABEL="com.zenithjoy.pipeline-worker"
PLIST_SRC="infrastructure/launchagents/${LABEL}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
VENV_DIR="services/creator/.venv"

cd "$(dirname "$0")/.."

case "${1:-}" in
  --remove)
    echo "[pipeline-worker] 卸载 LaunchAgent..."
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm -f "${PLIST_DST}"
    echo "[pipeline-worker] 已卸载"
    exit 0
    ;;
esac

# 1. 确保 venv 存在
if [ ! -d "${VENV_DIR}" ]; then
  echo "[pipeline-worker] 创建 venv: ${VENV_DIR}"
  python3 -m venv "${VENV_DIR}"
fi

# 2. 安装依赖（如果 requirements.txt 有变化）
echo "[pipeline-worker] 安装依赖..."
"${VENV_DIR}/bin/pip" install -q -r services/creator/requirements.txt 2>/dev/null || true

# 3. 运行 migration — PR-e/5 起 SQLite 已冻结，apps/api 管理 Postgres migrations
#    保留 skip 作为占位，便于以后在 worker 启动前加启动探针（ping apps/api）。
echo "[pipeline-worker] SQLite migrations 跳过（已 cutover 到 Postgres）"

# 4. 部署 plist
echo "[pipeline-worker] 部署 LaunchAgent: ${PLIST_DST}"
cp "${PLIST_SRC}" "${PLIST_DST}"

# 5. 加载
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"

echo "[pipeline-worker] 部署完成"
echo "[pipeline-worker] 日志: /tmp/pipeline-worker.log"
echo "[pipeline-worker] 手动执行: ${VENV_DIR}/bin/python3 services/creator/pipeline_worker/worker.py --apply"
