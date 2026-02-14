#!/bin/bash
# 文件传输到 Windows PC（通过 Tailscale）
# 用法: ./transfer-files.sh <内容JSON文件>

CONTENT_FILE="$1"
WINDOWS_IP="100.97.242.124"

if [ ! -f "$CONTENT_FILE" ]; then
    echo "❌ 文件不存在: $CONTENT_FILE"
    exit 1
fi

# 读取日期目录
DATE_DIR=$(basename $(dirname "$CONTENT_FILE"))
BASE_DIR="C:\\Users\\Administrator\\Desktop\\toutiao-media\\$DATE_DIR"

echo ""
echo "========================================="
echo "传输文件到 Windows PC (Tailscale)"
echo "========================================="
echo "日期: $DATE_DIR"
echo "目标: $WINDOWS_IP"
echo ""

# 读取内容文件，上传所有图片和视频
QUEUE_DIR=$(dirname "$CONTENT_FILE")

# 上传图片
if [ -d "$QUEUE_DIR/images" ]; then
    for img in "$QUEUE_DIR"/images/*; do
        if [ -f "$img" ]; then
            echo "📤 $(basename $img)"
            curl -s -F "file=@$img" \
                 -F "targetDir=$BASE_DIR\\images" \
                 "http://$WINDOWS_IP:3001/upload" | jq -r '.path // .error'
        fi
    done
fi

# 上传视频
if [ -d "$QUEUE_DIR/videos" ]; then
    for video in "$QUEUE_DIR"/videos/*; do
        if [ -f "$video" ]; then
            echo "📤 $(basename $video)"
            curl -s -F "file=@$video" \
                 -F "targetDir=$BASE_DIR\\videos" \
                 "http://$WINDOWS_IP:3001/upload" | jq -r '.path // .error'
        fi
    done
fi

echo ""
echo "✅ 传输完成"
echo ""
