#!/bin/bash
# Platform Data Feature - 统一入口路由
set -euo pipefail

# 解析真实路径（处理软链接）
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
FEATURE_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
SUBCOMMANDS_DIR="$FEATURE_DIR/skill/subcommands"

# 显示帮助信息
show_help() {
    cat "$FEATURE_DIR/skill/SKILL.md"
}

# 主路由逻辑
case "${1:-}" in
    scrape)
        shift
        exec bash "$SUBCOMMANDS_DIR/scrape.sh" "$@"
        ;;
    analyze)
        shift
        exec bash "$SUBCOMMANDS_DIR/analyze.sh" "$@"
        ;;
    publish)
        shift
        exec bash "$SUBCOMMANDS_DIR/publish.sh" "$@"
        ;;
    help|--help|-h|"")
        show_help
        ;;
    *)
        echo "❌ 未知子命令: $1"
        echo ""
        echo "可用子命令："
        echo "  scrape   - 数据采集"
        echo "  analyze  - 数据分析"
        echo "  publish  - 内容发布"
        echo ""
        echo "使用 '/platform-data help' 查看详细说明"
        exit 1
        ;;
esac
