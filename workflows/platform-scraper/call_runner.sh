#!/bin/bash
# Windows Runner 调用脚本

ROG_IP="100.98.253.95"
RUNNER_PORT="3000"
API_KEY="runner-secure-key-ax2024-9f8e7d6c5b4a"

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
