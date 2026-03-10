#!/usr/bin/env bash
# test-kuaishou-publish.sh
# 快手图文发布测试脚本
#
# 用法：
#   bash test-kuaishou-publish.sh              # 发布 1 条纯文字
#   bash test-kuaishou-publish.sh --with-image # 包含图片测试（需要本地有 /tmp/test-image.jpg）
#
# 前置条件：
#   1. Windows PC (100.97.242.124) Chrome 已以 --remote-debugging-port=19223 启动
#   2. Chrome 已打开并登录 cp.kuaishou.com（快手创作者平台）
#   3. Node.js 已安装，ws 模块可用：npm install ws

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_SCRIPT="$SCRIPT_DIR/publish-kuaishou.cjs"
TMP_DIR="/tmp/kuaishou-test-$(date +%s)"
WITH_IMAGE=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --with-image) WITH_IMAGE=true ;;
    --help|-h)
      echo "用法: bash test-kuaishou-publish.sh [--with-image]"
      echo ""
      echo "  --with-image   包含图片的测试（需要 /tmp/test-image.jpg 存在）"
      exit 0
      ;;
  esac
done

mkdir -p "$TMP_DIR"

echo "========================================"
echo "快手图文发布测试"
echo "========================================"
echo "脚本目录: $SCRIPT_DIR"
echo "临时目录: $TMP_DIR"
echo "包含图片: $WITH_IMAGE"
echo ""

# 检查发布脚本存在
if [ ! -f "$PUBLISH_SCRIPT" ]; then
  echo "❌ 发布脚本不存在: $PUBLISH_SCRIPT"
  exit 1
fi

# 检查 node 可用
if ! command -v node &>/dev/null; then
  echo "❌ 未找到 node，请先安装 Node.js"
  exit 1
fi

# 检查 ws 模块
if ! node -e "require('ws')" &>/dev/null 2>&1; then
  echo "❌ 缺少 ws 模块，请运行: npm install ws"
  exit 1
fi

# 检查 Windows PC CDP 连接（可选，失败不中止）
echo "🔍 检查 CDP 连接..."
if curl -s --connect-timeout 5 "http://100.97.242.124:19223/json" > /dev/null 2>&1; then
  echo "✅ CDP 连接正常 (100.97.242.124:19223)"
else
  echo "⚠️  无法连接到 CDP（100.97.242.124:19223）"
  echo "   请确认 Windows PC Chrome 已以 --remote-debugging-port=19223 启动"
  echo "   继续发布测试（发布脚本会给出详细错误信息）..."
fi

# 生成测试内容
TIMESTAMP=$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')
CONTENT_FILE="$TMP_DIR/kuaishou-test.json"

if [ "$WITH_IMAGE" = true ]; then
  TEST_IMAGE="/tmp/test-image.jpg"
  if [ ! -f "$TEST_IMAGE" ]; then
    echo "❌ 测试图片不存在: $TEST_IMAGE"
    echo "   请先创建测试图片，或使用不带 --with-image 的命令"
    exit 1
  fi
  cat > "$CONTENT_FILE" << JSONEOF
{
  "type": "kuaishou",
  "id": "test-$(date +%s)",
  "content": "【测试帖】快手图文发布测试 🎯\n\n测试时间：$TIMESTAMP\n测试环境：Mac mini → CDP → Windows PC\n\n#自动化测试 #快手",
  "images": ["$TEST_IMAGE"]
}
JSONEOF
else
  cat > "$CONTENT_FILE" << JSONEOF
{
  "type": "kuaishou",
  "id": "test-$(date +%s)",
  "content": "【测试帖】快手图文发布测试 🎯\n\n测试时间：$TIMESTAMP\n测试环境：Mac mini → CDP → Windows PC\n\n#自动化测试 #快手",
  "images": []
}
JSONEOF
fi

echo "📄 测试内容文件: $CONTENT_FILE"
echo ""
cat "$CONTENT_FILE"
echo ""

# 执行发布
echo "🚀 开始发布..."
echo ""

if node "$PUBLISH_SCRIPT" --content "$CONTENT_FILE"; then
  echo ""
  echo "✅ 测试发布成功"
  echo "截图保存在: /tmp/kuaishou-publish-screenshots/"
else
  EXIT_CODE=$?
  echo ""
  echo "❌ 测试发布失败（exit code: $EXIT_CODE）"
  echo "截图保存在: /tmp/kuaishou-publish-screenshots/"
  exit $EXIT_CODE
fi

# 清理临时文件
rm -rf "$TMP_DIR"
echo "🧹 临时文件已清理"
