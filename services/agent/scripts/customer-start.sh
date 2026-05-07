#!/usr/bin/env bash
# Walking Skeleton #1 客户一键启动脚本
# 用法：
#   export ZENITHJOY_LICENSE=ZJ-F-XXXXXX
#   bash scripts/customer-start.sh
#
# 默认连 https://autopilot.zenjoymedia.media；本地开发可覆盖 ZENITHJOY_API_BASE
set -euo pipefail

# 必填环境变量校验
: "${ZENITHJOY_LICENSE:?请先 export ZENITHJOY_LICENSE=ZJ-F-XXXXXX（在 autopilot dashboard 拿）}"
ZENITHJOY_API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
ZENITHJOY_AGENT_REAL_PUBLISH="${ZENITHJOY_AGENT_REAL_PUBLISH:-1}"

CHROME_PORT=19222
CHROME_PROFILE="$HOME/zenithjoy-chrome-profile"

echo "▶ 检查 Chrome 19222 端口"
if lsof -i:${CHROME_PORT} -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "  Chrome 已在 19222 端口运行，复用"
else
  echo "  启动 Chrome 调试模式 → 请在打开的窗口登录 https://creator.douyin.com（测试号）"
  open -na "Google Chrome" --args --remote-debugging-port=${CHROME_PORT} --user-data-dir="${CHROME_PROFILE}" >/dev/null 2>&1 &
  sleep 3
fi

echo "▶ 启动 ZenithJoy Agent"
echo "  API: ${ZENITHJOY_API_BASE}"
echo "  REAL_PUBLISH: ${ZENITHJOY_AGENT_REAL_PUBLISH}"
echo ""

cd "$(dirname "$0")/.."  # 切到 services/agent 根目录
exec env \
  ZENITHJOY_API_BASE="${ZENITHJOY_API_BASE}" \
  ZENITHJOY_LICENSE="${ZENITHJOY_LICENSE}" \
  ZENITHJOY_AGENT_REAL_PUBLISH="${ZENITHJOY_AGENT_REAL_PUBLISH}" \
  npm start
