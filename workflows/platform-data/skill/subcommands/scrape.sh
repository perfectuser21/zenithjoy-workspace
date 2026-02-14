#!/bin/bash
# Scraper Subcommand - 数据采集

set -euo pipefail

WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../workflows/scraper" && pwd)"

# 显示用法
if [[ $# -eq 0 ]] || [[ "${1:-}" == "help" ]] || [[ "${1:-}" == "--help" ]]; then
    echo "Usage: /platform-data scrape <platform> [options]"
    echo ""
    echo "Platforms:"
    echo "  douyin        - 抖音"
    echo "  kuaishou      - 快手"
    echo "  xiaohongshu   - 小红书"
    echo "  channels      - 微信视频号"
    echo "  toutiao       - 今日头条"
    echo "  weibo         - 微博"
    echo "  zhihu         - 知乎"
    echo "  wechat        - 微信公众号"
    echo ""
    echo "Example:"
    echo "  /platform-data scrape douyin"
    exit 0
fi

PLATFORM="$1"
shift

# 调用对应平台的 scraper 脚本
SCRAPER_SCRIPT="$WORKFLOW_DIR/scripts/scraper-${PLATFORM}-v3.js"

if [[ ! -f "$SCRAPER_SCRIPT" ]]; then
    echo "❌ 不支持的平台: $PLATFORM"
    echo ""
    echo "支持的平台: douyin, kuaishou, xiaohongshu, channels, toutiao, weibo, zhihu, wechat"
    exit 1
fi

echo "🚀 启动 $PLATFORM 数据采集..."
exec node "$SCRAPER_SCRIPT" "$@"
