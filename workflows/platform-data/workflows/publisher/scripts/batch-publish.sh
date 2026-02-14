#!/bin/bash
# 批量发布今日头条内容

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUEUE_DIR="/home/xx/.toutiao-queue"
DATE=${1:-$(date +%Y-%m-%d)}
TARGET_DIR="$QUEUE_DIR/$DATE"

echo "========================================="
echo "今日头条批量发布"
echo "========================================="
echo ""
echo "日期: $DATE"
echo ""

if [ ! -d "$TARGET_DIR" ]; then
  echo "❌ 队列目录不存在: $TARGET_DIR"
  exit 1
fi

# 统计
TOTAL=0
SUCCESS=0
FAILED=0

# 发布图文
echo "📝 发布图文..."
echo ""

find "$TARGET_DIR" -name "post-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | while read -r file; do
  TOTAL=$((TOTAL + 1))
  TITLE=$(jq -r '.title' "$file" 2>/dev/null)
  ID=$(jq -r '.id' "$file" 2>/dev/null)

  echo "----------------------------------------"
  echo "发布: $TITLE"
  echo "ID: $ID"
  echo "----------------------------------------"
  echo ""

  if node "$SCRIPT_DIR/publish-post.cjs" --content "$file"; then
    echo "✅ 发布成功"
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

# 发布视频
echo "🎬 发布视频..."
echo ""

find "$TARGET_DIR" -name "video-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | while read -r file; do
  TOTAL=$((TOTAL + 1))
  TITLE=$(jq -r '.title' "$file" 2>/dev/null)
  ID=$(jq -r '.id' "$file" 2>/dev/null)

  echo "----------------------------------------"
  echo "发布: $TITLE"
  echo "ID: $ID"
  echo "----------------------------------------"
  echo ""

  if node "$SCRIPT_DIR/publish-video.cjs" --content "$file"; then
    echo "✅ 发布成功"
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
STATS_DIR="$QUEUE_DIR/.stats"
mkdir -p "$STATS_DIR"

cat > "$STATS_DIR/$DATE.json" << EOF
{
  "date": "$DATE",
  "total": $TOTAL,
  "success": $SUCCESS,
  "failed": $FAILED,
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "========================================="
echo "批量发布完成"
echo "========================================="
echo ""
echo "总数: $TOTAL"
echo "成功: $SUCCESS"
echo "失败: $FAILED"
echo ""
echo "统计文件: $STATS_DIR/$DATE.json"
echo ""
echo "========================================="

exit 0
