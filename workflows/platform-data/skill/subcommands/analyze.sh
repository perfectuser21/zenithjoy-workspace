#!/bin/bash
# Analyzer Subcommand - 数据分析

set -euo pipefail

WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../workflows/analyzer" && pwd)"

# 显示用法
if [[ "${1:-}" == "help" ]] || [[ "${1:-}" == "--help" ]]; then
    echo "Usage: /platform-data analyze [options]"
    echo ""
    echo "Options:"
    echo "  --platform <name>  - 分析特定平台数据"
    echo "  --days <number>    - 分析最近 N 天数据"
    echo "  --export           - 导出分析结果"
    echo ""
    echo "Example:"
    echo "  /platform-data analyze --platform douyin --days 7"
    exit 0
fi

# 调用 analyzer 脚本
ANALYZER_SCRIPT="$WORKFLOW_DIR/scripts/analyze.js"

if [[ ! -f "$ANALYZER_SCRIPT" ]]; then
    echo "❌ Analyzer 脚本不存在: $ANALYZER_SCRIPT"
    exit 1
fi

echo "📊 启动数据分析..."
exec node "$ANALYZER_SCRIPT" "$@"
