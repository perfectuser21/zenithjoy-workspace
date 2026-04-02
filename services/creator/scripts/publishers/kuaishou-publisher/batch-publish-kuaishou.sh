#!/usr/bin/env bash
# 快手图文批量发布脚本
#
# 用法：bash batch-publish-kuaishou.sh [日期]
# 示例：bash batch-publish-kuaishou.sh 2026-03-07
#
# 内容队列目录结构：
#   ~/.kuaishou-queue/{date}/
#   ├── image-1/
#   │   ├── content.txt
#   │   └── image.jpg
#   └── image-2/
#       └── image.jpg

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUEUE_DIR="${HOME}/.kuaishou-queue"
DATE=${1:-$(date +%Y-%m-%d)}
TARGET_DIR="${QUEUE_DIR}/${DATE}"
NODE_SCRIPT="${SCRIPT_DIR}/publish-kuaishou-image.cjs"
SESSION_CHECK_SCRIPT="${SCRIPT_DIR}/check-kuaishou-session.cjs"
EXPORT_NODE_PATH="/Users/administrator/perfect21/cecelia/node_modules"

echo "========================================="
echo "快手批量发布"
echo "========================================="
echo ""
echo "日期: ${DATE}"
echo "队列目录: ${TARGET_DIR}"
echo ""

# ========== 前置检查：OAuth 会话状态 ==========
echo "🔐 检查快手 OAuth 会话..."
SESSION_OUTPUT=$(NODE_PATH="${EXPORT_NODE_PATH}" node "${SESSION_CHECK_SCRIPT}" 2>&1 || true)
echo "${SESSION_OUTPUT}"
echo ""

if echo "${SESSION_OUTPUT}" | grep -q '\[SESSION_EXPIRED\]'; then
  echo "❌ 快手会话已过期，无法批量发布"
  echo "请在 Windows PC 浏览器中重新登录快手创作者中心，然后重试"
  exit 1
fi

if echo "${SESSION_OUTPUT}" | grep -q '\[CDP_ERROR\]'; then
  echo "❌ 无法连接 Windows PC CDP，请检查："
  echo "  1. Windows PC (100.97.242.124) 是否开机"
  echo "  2. Chrome 调试端口 19223 是否已启动"
  exit 1
fi

if echo "${SESSION_OUTPUT}" | grep -q '\[TIMEOUT\]'; then
  echo "❌ 会话检查超时，Windows PC 响应缓慢，请稍后重试"
  exit 1
fi

if ! echo "${SESSION_OUTPUT}" | grep -q '\[SESSION_OK\]'; then
  echo "⚠️  会话状态未知，继续发布（谨慎）"
fi

echo "✅ 会话有效，开始批量发布..."
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

echo "📋 使用发布方案: $(basename "${NODE_SCRIPT}")"

# 统计
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0

echo "📝 扫描图文内容..."
echo ""

# 遍历所有 image-* 目录
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
  content_text=""
  if [ -f "${content_dir}/content.txt" ]; then
    content_text=$(head -c 30 "${content_dir}/content.txt")...
  fi

  echo "----------------------------------------"
  echo "发布: ${dir_name}"
  if [ -n "${content_text}" ]; then
    echo "文案: ${content_text}"
  fi
  echo "----------------------------------------"
  echo ""

  if NODE_PATH="${EXPORT_NODE_PATH}" node "${NODE_SCRIPT}" --content "${content_dir}"; then
    echo "✅ 发布成功"
    # 标记已发布
    date -u +%Y-%m-%dT%H:%M:%SZ > "${content_dir}/done.txt"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "❌ 发布失败"
    FAILED=$((FAILED + 1))
  fi

  echo ""
  echo "等待 5 秒后继续..."
  sleep 5
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
echo "截图目录: /tmp/kuaishou-publish-screenshots/"
echo ""

exit 0
