#!/bin/bash
# Windows Runner 调用脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/runner_config.sh"

ROG_IP="$WINDOWS_IP"
RUNNER_PORT="${RUNNER_PORT:-3000}"
API_KEY="$RUNNER_API_KEY"

PLATFORM=$1
MODE=${2:-script}
TASK=$3

if [ -z "$PLATFORM" ]; then
    echo "用法: bash ~/call_runner.sh <platform> [mode] [task]"
    echo "平台: douyin, kuaishou, xiaohongshu, toutiao-main, toutiao-sub, weibo, shipinhao, gongzhonghao, zhihu"
    echo "模式: script (默认), capture, login"
    exit 1
fi

if [ "$MODE" == "capture" ] && [ -n "$TASK" ]; then
    curl -s -X POST "http://${ROG_IP}:${RUNNER_PORT}/run" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{\"platform\":\"${PLATFORM}\",\"mode\":\"capture\",\"task\":\"${TASK}\"}"
else
    curl -s -X POST "http://${ROG_IP}:${RUNNER_PORT}/run" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${API_KEY}" \
        -d "{\"platform\":\"${PLATFORM}\",\"mode\":\"${MODE}\"}"
fi
echo ""
