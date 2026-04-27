#!/usr/bin/env bash
# Build 产物完整性检查 — 防止 .env.production 缺失导致关键变量没注入

set -euo pipefail

cd "$(dirname "$0")/.."

DIST_DIR="${1:-dist}"

if [ ! -d "$DIST_DIR" ]; then
  echo "❌ $DIST_DIR 不存在，请先 npm run build"
  exit 1
fi

echo "🔍 检查 build 产物关键变量..."

REQUIRED_TOKENS=(
  "cli_a:VITE_FEISHU_APP_ID"
)

failed=0
for entry in "${REQUIRED_TOKENS[@]}"; do
  pattern="${entry%%:*}"
  varname="${entry##*:}"
  if grep -qE "$pattern" "$DIST_DIR"/assets/*.js 2>/dev/null; then
    echo "  ✅ $varname 已注入"
  else
    echo "  ❌ $varname 缺失！(pattern: $pattern)"
    failed=1
  fi
done

if [ $failed -eq 1 ]; then
  echo ""
  echo "❌ Build 产物不完整。常见原因："
  echo "  1. .env.production 没复制到当前工作目录"
  echo "  2. .env.production 在 .gitignore 里（worktree 默认没有）"
  echo ""
  echo "修复：cp 主仓库/apps/dashboard/.env.production ./"
  exit 1
fi

echo ""
echo "✅ Build 产物完整性检查通过"
