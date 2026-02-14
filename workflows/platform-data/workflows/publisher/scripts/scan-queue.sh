#!/bin/bash
# 扫描今日头条发布队列

QUEUE_DIR="/home/xx/.toutiao-queue"
DATE=${1:-$(date +%Y-%m-%d)}
TARGET_DIR="$QUEUE_DIR/$DATE"

echo "========================================="
echo "今日头条发布队列扫描"
echo "========================================="
echo ""
echo "日期: $DATE"
echo "队列目录: $TARGET_DIR"
echo ""

if [ ! -d "$TARGET_DIR" ]; then
  echo "❌ 队列目录不存在: $TARGET_DIR"
  echo ""
  echo "提示：使用以下命令创建队列目录："
  echo "  mkdir -p $TARGET_DIR/{images,videos}"
  exit 1
fi

# 统计待发布内容
POST_PENDING=$(find "$TARGET_DIR" -name "post-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | wc -l)
POST_TOTAL=$(find "$TARGET_DIR" -name "post-*.json" 2>/dev/null | wc -l)

VIDEO_PENDING=$(find "$TARGET_DIR" -name "video-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | wc -l)
VIDEO_TOTAL=$(find "$TARGET_DIR" -name "video-*.json" 2>/dev/null | wc -l)

IMAGES_COUNT=$(find "$TARGET_DIR/images" -type f 2>/dev/null | wc -l)
VIDEOS_COUNT=$(find "$TARGET_DIR/videos" -type f 2>/dev/null | wc -l)

echo "📊 统计信息"
echo "----------------------------------------"
echo "图文:"
echo "  总数: $POST_TOTAL"
echo "  待发布: $POST_PENDING"
echo ""
echo "视频:"
echo "  总数: $VIDEO_TOTAL"
echo "  待发布: $VIDEO_PENDING"
echo ""
echo "媒体文件:"
echo "  图片: $IMAGES_COUNT"
echo "  视频: $VIDEOS_COUNT"
echo ""

if [ $POST_PENDING -eq 0 ] && [ $VIDEO_PENDING -eq 0 ]; then
  echo "✅ 没有待发布内容"
  echo ""
  exit 0
fi

echo "📝 待发布列表"
echo "----------------------------------------"

# 列出待发布的图文
if [ $POST_PENDING -gt 0 ]; then
  echo ""
  echo "图文 ($POST_PENDING 个):"
  find "$TARGET_DIR" -name "post-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | while read -r file; do
    TITLE=$(jq -r '.title' "$file" 2>/dev/null)
    ID=$(jq -r '.id' "$file" 2>/dev/null)
    IMAGES=$(jq -r '.images | length' "$file" 2>/dev/null)
    echo "  • $ID"
    echo "    标题: $TITLE"
    echo "    图片: $IMAGES 张"
    echo "    文件: $file"
    echo ""
  done
fi

# 列出待发布的视频
if [ $VIDEO_PENDING -gt 0 ]; then
  echo ""
  echo "视频 ($VIDEO_PENDING 个):"
  find "$TARGET_DIR" -name "video-*.json" -exec grep -l '"status": "pending"' {} \; 2>/dev/null | while read -r file; do
    TITLE=$(jq -r '.title' "$file" 2>/dev/null)
    ID=$(jq -r '.id' "$file" 2>/dev/null)
    VIDEO=$(jq -r '.video' "$file" 2>/dev/null)
    echo "  • $ID"
    echo "    标题: $TITLE"
    echo "    视频: $VIDEO"
    echo "    文件: $file"
    echo ""
  done
fi

echo "========================================="
echo ""

exit 0
