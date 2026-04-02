#!/usr/bin/env bash
# 小红书图文批量发布脚本
#
# 用法：bash batch-publish-xiaohongshu.sh [日期]
# 示例：bash batch-publish-xiaohongshu.sh 2026-03-07
#
# 内容队列目录结构：
#   ~/.xiaohongshu-queue/{date}/
#   ├── image-1/
#   │   ├── content.txt    （正文，可选，支持话题 #xxx#）
#   │   ├── title.txt      （标题，可选）
#   │   └── image.jpg      （图片，支持多张，最多 9 张）
#   └── image-2/
#       └── image.jpg

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUEUE_DIR="${HOME}/.xiaohongshu-queue"
DATE=${1:-$(date +%Y-%m-%d)}
TARGET_DIR="${QUEUE_DIR}/${DATE}"
NODE_SCRIPT="${SCRIPT_DIR}/publish-xiaohongshu-image.cjs"
EXPORT_NODE_PATH="/Users/administrator/perfect21/cecelia/node_modules"

echo "========================================="
echo "小红书批量发布"
echo "========================================="
echo ""
echo "日期: ${DATE}"
echo "队列目录: ${TARGET_DIR}"
echo ""

if [ ! -d "${TARGET_DIR}" ]; then
  echo "❌ 队列目录不存在: ${TARGET_DIR}"
  echo "请先创建内容目录并放入图片和文案"
  exit 1
fi

if [ ! -f "${NODE_SCRIPT}" ]; then
  echo "❌ 发布脚本不存在: ${NODE_SCRIPT}"
  exit 1
fi

# 统计
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0

echo "📝 扫描图文内容..."
echo ""

# 遍历所有 image-* 目录（按字母序）
for content_dir in "${TARGET_DIR}"/image-*/; do
  [ -d "${content_dir}" ] || continue

  dir_name=$(basename "${content_dir}")

  # 检查是否有图片
  has_image=false
  for ext in jpg jpeg png gif webp; do
    if ls "${content_dir}"*.${ext} 2>/dev/null | head -1 | grep -q .; then
      has_image=true
      break
    fi
  done

  if [ "${has_image}" = "false" ]; then
    echo "⚠️  跳过 ${dir_name}（无图片）"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 检查是否已发布（done.txt 标记）
  if [ -f "${content_dir}/done.txt" ]; then
    echo "⏭️  跳过 ${dir_name}（已发布）"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  TOTAL=$((TOTAL + 1))
  content_preview=""
  if [ -f "${content_dir}/content.txt" ]; then
    content_preview=$(head -c 30 "${content_dir}/content.txt")
  fi
  title_preview=""
  if [ -f "${content_dir}/title.txt" ]; then
    title_preview=$(head -c 20 "${content_dir}/title.txt")
  fi

  echo "----------------------------------------"
  echo "[XHS] 发布: ${dir_name}"
  if [ -n "${title_preview}" ]; then
    echo "[XHS] 标题: ${title_preview}..."
  fi
  if [ -n "${content_preview}" ]; then
    echo "[XHS] 正文: ${content_preview}..."
  fi
  echo "----------------------------------------"
  echo ""

  if NODE_PATH="${EXPORT_NODE_PATH}" node "${NODE_SCRIPT}" --content "${content_dir}"; then
    echo "[XHS] ✅ 发布成功"
    # 标记已发布（UTC 时间）
    date -u +%Y-%m-%dT%H:%M:%SZ > "${content_dir}/done.txt"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "[XHS] ❌ 发布失败"
    FAILED=$((FAILED + 1))
  fi

  echo ""
  echo "等待 10 秒后继续（小红书发布间隔）..."
  sleep 10
  echo ""
done

# 保存统计
STATS_DIR="${QUEUE_DIR}/.stats"
mkdir -p "${STATS_DIR}"

cat > "${STATS_DIR}/${DATE}.json" << EOF
{
  "date": "${DATE}",
  "total": ${TOTAL},
  "success": ${SUCCESS},
  "failed": ${FAILED},
  "skipped": ${SKIPPED},
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "========================================="
echo "批量发布完成"
echo "========================================="
echo ""
echo "总数: ${TOTAL}"
echo "成功: ${SUCCESS}"
echo "失败: ${FAILED}"
echo "跳过: ${SKIPPED}"
echo ""
echo "统计文件: ${STATS_DIR}/${DATE}.json"
echo "截图目录: /tmp/xiaohongshu-publish-screenshots/"
echo ""

exit 0
