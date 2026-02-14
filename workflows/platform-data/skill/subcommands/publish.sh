#!/bin/bash
# Publisher Subcommand - 内容发布

set -euo pipefail

WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../workflows/publisher" && pwd)"

# 显示用法
if [[ "${1:-}" == "help" ]] || [[ "${1:-}" == "--help" ]]; then
    echo "Usage: /platform-data publish [options]"
    echo ""
    echo "Options:"
    echo "  --platform <name>  - 发布到特定平台（默认：toutiao）"
    echo "  --queue <date>     - 指定发布队列日期"
    echo "  --batch            - 批量发布模式"
    echo ""
    echo "Example:"
    echo "  /platform-data publish --platform toutiao --queue 2026-02-10"
    exit 0
fi

# 调用 publisher 脚本
PUBLISHER_SCRIPT="$WORKFLOW_DIR/scripts/publish.js"

if [[ ! -f "$PUBLISHER_SCRIPT" ]]; then
    echo "❌ Publisher 脚本不存在: $PUBLISHER_SCRIPT"
    exit 1
fi

echo "📤 启动内容发布..."
exec node "$PUBLISHER_SCRIPT" "$@"
