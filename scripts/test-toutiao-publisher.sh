#!/bin/bash
# 今日头条发布脚本测试

set -e

SCRIPT_PATH="/home/xx/notion_toutiao_publisher.js"
TEST_DATA_FILE="/tmp/test-toutiao-publish.json"

echo "🧪 今日头条发布脚本测试"
echo ""

# 检查脚本是否存在
if [[ ! -f "$SCRIPT_PATH" ]]; then
    echo "❌ 脚本不存在: $SCRIPT_PATH"
    echo "   请先运行部署命令："
    echo "   cp scripts/notion-toutiao-publisher.js /home/xx/notion_toutiao_publisher.js"
    exit 1
fi

echo "✅ 脚本文件存在: $SCRIPT_PATH"
echo ""

# 检查 CDP 连接
echo "🔍 检查 CDP 连接..."
if curl -s http://100.97.242.124:19225/json > /dev/null 2>&1; then
    echo "✅ CDP 端口可访问"
else
    echo "❌ CDP 端口不可访问"
    echo "   请确保 Windows Chrome 已启动并开启远程调试"
    exit 1
fi

# 检查是否有发布页面
echo "🔍 检查发布页面..."
PUBLISH_PAGE=$(curl -s http://100.97.242.124:19225/json | jq -r '.[] | select(.url | contains("/publish")) | .url' | head -1)

if [[ -z "$PUBLISH_PAGE" ]]; then
    echo "❌ 未找到发布页面"
    echo "   请在 Windows Chrome 中打开："
    echo "   https://mp.toutiao.com/profile_v4/graphic/publish"
    exit 1
fi

echo "✅ 发布页面已打开: $PUBLISH_PAGE"
echo ""

# 生成测试数据
echo "📝 生成测试数据..."
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
cat > "$TEST_DATA_FILE" << EOF
{
  "title": "自动发布测试 $TIMESTAMP",
  "content": "这是一篇自动发布测试文章。\n\n测试内容包括：\n\n1. 标题和内容自动填写\n2. 发布设置自动配置（无封面）\n3. 预览和发布按钮自动点击\n\n本次测试确保发布脚本能够完整执行整个发布流程，从内容填写到最终发布成功。测试时间戳：$TIMESTAMP。文章内容需要达到一定字数要求才能成功发布到今日头条平台。"
}
EOF

echo "✅ 测试数据已生成"
echo ""

# 执行发布测试
echo "🚀 开始执行发布测试..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if cat "$TEST_DATA_FILE" | node "$SCRIPT_PATH"; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎉 测试成功！"
    echo ""
    echo "请在今日头条后台验证："
    echo "1. 文章标题：自动发布测试 $TIMESTAMP"
    echo "2. 文章已发布（不在草稿中）"
    echo "3. 文章内容完整"
    exit 0
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ 测试失败"
    echo ""
    echo "可能原因："
    echo "1. CDP 连接中断"
    echo "2. 页面元素变化"
    echo "3. 网络延迟导致超时"
    echo ""
    echo "请查看上方日志排查问题"
    exit 1
fi
