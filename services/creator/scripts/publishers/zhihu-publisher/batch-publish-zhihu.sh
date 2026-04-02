#!/usr/bin/env bash
# 知乎批量发布脚本
# 用法: bash batch-publish-zhihu.sh [YYYY-MM-DD]
#
# 队列目录结构：
#   ~/.zhihu-queue/YYYY-MM-DD/
#   ├── article-1/
#   │   ├── title.txt     # 标题（必需）
#   │   ├── content.txt   # 正文（必需）
#   │   └── cover.jpg     # 封面图（可选）
#   └── article-2/
#       └── ...
#
# 发布完成后在内容目录写入 done.txt，下次运行跳过。
#
# 发布模式切换（环境变量）：
#   ZHIHU_MODE=cdp   # 旧方案：CDP UI 自动化（默认）
#   ZHIHU_MODE=api   # 新方案：in-browser fetch 调用知乎 API（推荐）
#
# 示例：
#   ZHIHU_MODE=api bash batch-publish-zhihu.sh 2026-03-11

set -euo pipefail

DATE="${1:-$(date +%Y-%m-%d)}"
QUEUE_DIR="${HOME}/.zhihu-queue/${DATE}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_PATH_OVERRIDE="/Users/administrator/perfect21/cecelia/node_modules"
ZHIHU_MODE="${ZHIHU_MODE:-cdp}"

echo "========================================="
echo " 知乎批量发布 - ${DATE} [${ZHIHU_MODE}模式]"
echo "========================================="
echo ""

if [[ ! -d "$QUEUE_DIR" ]]; then
  echo "队列目录不存在: $QUEUE_DIR"
  exit 1
fi

count=0
success=0
fail=0

for content_dir in "${QUEUE_DIR}"/*/; do
  [[ -d "$content_dir" ]] || continue

  # 跳过已完成的
  if [[ -f "${content_dir}done.txt" ]]; then
    echo "跳过（已完成）: $(basename "$content_dir")"
    continue
  fi

  count=$((count + 1))
  echo ""
  echo "发布 ($count): $(basename "$content_dir")"
  echo ""

  # 根据 ZHIHU_MODE 选择发布脚本
  if [[ "$ZHIHU_MODE" == "api" ]]; then
    PUBLISH_SCRIPT="${SCRIPT_DIR}/publish-zhihu-api.cjs"
  else
    PUBLISH_SCRIPT="${SCRIPT_DIR}/publish-zhihu-article.cjs"
  fi

  if NODE_PATH="$NODE_PATH_OVERRIDE" node "${PUBLISH_SCRIPT}" --content "$content_dir"; then
    success=$((success + 1))
    # 标记完成，下次跳过
    touch "${content_dir}done.txt"
    echo ""
    echo "成功: $(basename "$content_dir")"
  else
    fail=$((fail + 1))
    echo ""
    echo "失败: $(basename "$content_dir")"
  fi

  # 发布间隔，避免触发限流
  sleep 10
done

echo ""
echo "========================================="
echo " 批量发布完成"
echo " 总计: $count | 成功: $success | 失败: $fail"
echo "========================================="
