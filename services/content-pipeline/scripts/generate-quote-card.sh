#!/bin/bash
# 金句卡片生成脚本（1:1，黑底橙红风格）

if [ $# -lt 2 ]; then
    echo "用法: $0 <标题> <强调文字> [图标1,图标2]"
    echo ""
    echo "示例:"
    echo "  $0 '真正的竞争力' '不是会用AI而是知道什么时候不用AI' 'brain,target'"
    echo "  $0 '限制你的不是不会' '是你不试' 'fist,lightbulb'"
    exit 1
fi

TITLE="$1"
QUOTE="$2"
ICONS="${3:-brain,target}"

echo "生成金句卡片..."
echo "标题: $TITLE"
echo "强调: $QUOTE"
echo "图标: $ICONS"
echo ""

PROMPT="Create a 1:1 square social media quote card in this exact style:

STYLE REFERENCE:
- Pure black background (#0a0a0a)
- Large white/off-white title text at top
- Orange-red (#A95738) emphasized text below
- 2 simple flat minimalist icons in orange-red
- Clean typography, bold sans-serif font
- Plenty of negative space
- Minimal, modern, impactful design

CONTENT:
Title (white): $TITLE
Emphasized (orange-red): $QUOTE
Icons: $ICONS (simple, flat, orange-red)"

python3 $(dirname "$0")/toapis-image-gen.py "$PROMPT" -s 1024x1024
