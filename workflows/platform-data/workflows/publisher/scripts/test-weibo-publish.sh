#!/usr/bin/env bash
# test-weibo-publish.sh
# 微博发布测试脚本 - 发布 5 条测试内容
#
# 用法：
#   bash test-weibo-publish.sh              # 发布 5 条纯文字
#   bash test-weibo-publish.sh --with-image # 包含图片测试（需要本地有 /tmp/test-image.jpg）
#
# 前置条件：
#   1. Windows PC (100.97.242.124) Chrome 已打开 weibo.com 并已登录
#   2. Chrome 以 --remote-debugging-port=19227 启动
#   3. Node.js 已安装，ws 模块可用

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH_SCRIPT="$SCRIPT_DIR/publish-weibo.cjs"
TMP_DIR="/tmp/weibo-test-$(date +%s)"
WITH_IMAGE=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --with-image) WITH_IMAGE=true ;;
    --help|-h)
      echo "用法: bash test-weibo-publish.sh [--with-image]"
      echo ""
      echo "  --with-image   包含图片的测试（需要 /tmp/test-image.jpg 存在）"
      exit 0
      ;;
  esac
done

mkdir -p "$TMP_DIR"

echo "========================================"
echo "微博发布测试 (5 条)"
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

# 图片路径（--with-image 模式使用）
TEST_IMAGE="/tmp/test-image.jpg"
if $WITH_IMAGE && [ ! -f "$TEST_IMAGE" ]; then
  echo "⚠️  未找到测试图片 $TEST_IMAGE，切换为纯文字模式"
  WITH_IMAGE=false
fi

PASS=0
FAIL=0

# 定义 5 条测试内容
declare -a TEST_CONTENTS=(
  "【测试1】早安！今天也是充满活力的一天 ☀️ #日常分享#"
  "【测试2】分享一个好用的工具：自动化发布让内容创作更高效，省下时间做更有价值的事 💡"
  "【测试3】今天的天气真好，适合出门走走。你们今天有什么计划？🌤️ #生活记录#"
  "【测试4】坚持每天学习一点点，一年后你会感谢今天的自己 📚 #成长#"
  "【测试5】感谢大家的支持！继续努力，分享更多有价值的内容 ❤️ #感恩#"
)

for i in "${!TEST_CONTENTS[@]}"; do
  TEST_NUM=$((i + 1))
  CONTENT="${TEST_CONTENTS[$i]}"
  JSON_FILE="$TMP_DIR/test-$TEST_NUM.json"

  echo "----------------------------------------"
  echo "▶ 测试 $TEST_NUM/5"
  echo "  内容: ${CONTENT:0:40}..."

  # 构建 JSON
  if $WITH_IMAGE && [ -f "$TEST_IMAGE" ]; then
    cat > "$JSON_FILE" <<EOF
{
  "type": "weibo",
  "id": "test-$TEST_NUM",
  "content": $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$CONTENT"),
  "images": ["$TEST_IMAGE"]
}
EOF
    echo "  图片: $TEST_IMAGE"
  else
    cat > "$JSON_FILE" <<EOF
{
  "type": "weibo",
  "id": "test-$TEST_NUM",
  "content": $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$CONTENT"),
  "images": []
}
EOF
    echo "  图片: 无"
  fi

  echo ""

  # 执行发布
  if node "$PUBLISH_SCRIPT" --content "$JSON_FILE"; then
    echo "✅ 测试 $TEST_NUM 通过"
    PASS=$((PASS + 1))
  else
    echo "❌ 测试 $TEST_NUM 失败"
    FAIL=$((FAIL + 1))
  fi

  echo ""

  # 两条之间间隔 5 秒，避免触发频率限制
  if [ $TEST_NUM -lt 5 ]; then
    echo "  ⏳ 等待 5s 再发下一条..."
    sleep 5
  fi
done

echo "========================================"
echo "测试结果"
echo "========================================"
echo "通过: $PASS / 5"
echo "失败: $FAIL / 5"
echo "临时文件: $TMP_DIR"
echo "截图目录: /tmp/weibo-publish-screenshots"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✅ 全部测试通过"
  exit 0
else
  echo "❌ 有 $FAIL 条测试失败，请查看截图和日志"
  exit 1
fi
