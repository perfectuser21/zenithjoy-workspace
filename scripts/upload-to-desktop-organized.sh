#!/bin/bash

# 获取北京时间日期
BEIJING_DATE=$(TZ='Asia/Shanghai' date '+%Y-%m-%d')
BEIJING_TIME=$(TZ='Asia/Shanghai' date '+%H:%M:%S')

echo "=========================================="
echo "上传文件到 Windows Desktop（按日期和类型组织）"
echo "=========================================="
echo ""
echo "北京时间: ${BEIJING_DATE} ${BEIJING_TIME}"
echo ""

# 文件接收器地址
RECEIVER_URL="http://100.97.242.124:3001/upload"

# 源文件目录
SOURCE_DIR="/home/xx/.toutiao-queue/2026-02-09"

# 帖子标题（用于文件命名）
POST_TITLE="探索人工智能技术应用"

# 上传图片
echo "📸 上传图片..."
for i in 1 2 3; do
  SOURCE_FILE="${SOURCE_DIR}/images/test-image-${i}.jpg"
  
  if [ -f "$SOURCE_FILE" ]; then
    # 新的文件名：帖子标题-序号
    NEW_FILENAME="${POST_TITLE}-${i}.jpg"
    
    # 目标路径：Desktop/日期/images/
    TARGET_PATH="Desktop/${BEIJING_DATE}/images"
    
    echo "  上传: ${NEW_FILENAME}"
    echo "  目标: ${TARGET_PATH}/"
    
    RESULT=$(curl -s -F "file=@${SOURCE_FILE}" \
                      -F "path=${TARGET_PATH}" \
                      -F "filename=${NEW_FILENAME}" \
                      "${RECEIVER_URL}")
    
    echo "  结果: ${RESULT}"
    echo ""
  else
    echo "  ⚠️  文件不存在: ${SOURCE_FILE}"
  fi
done

echo "=========================================="
echo "✅ 上传完成"
echo ""
echo "文件位置："
echo "  C:\\Users\\Administrator\\Desktop\\${BEIJING_DATE}\\images\\"
echo "    - ${POST_TITLE}-1.jpg"
echo "    - ${POST_TITLE}-2.jpg"
echo "    - ${POST_TITLE}-3.jpg"
echo "=========================================="

