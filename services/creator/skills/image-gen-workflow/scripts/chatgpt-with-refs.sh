#!/bin/bash
#
# ChatGPT 图片生成 - 带多张参考图
#
# 核心流程：
#   1. 复制参考图到 Mac mini /tmp (简单路径)
#   2. 点击 Add files -> Add photos & files
#   3. 用 osascript + Cmd+Shift+G 选择文件
#   4. 重复上传每张图
#   5. 输入 prompt 发送
#   6. 等待生成
#   7. 用 canvas 下载图片
#   8. 质检
#
# 用法:
#   ./chatgpt-with-refs.sh "prompt" ref1.jpg ref2.jpg ref3.jpg ref4.jpg
#   ./chatgpt-with-refs.sh "prompt" /path/to/refs/*.jpg --output /path/to/output.png
#
# 必须在 HK VPS 上运行（有 agent-browser + SSH 隧道到 Mac mini Chrome）

set -e

CDP_PORT="${CDP_PORT:-9222}"
OUTPUT=""
PROMPT=""
REF_IMAGES=()

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --output|-o)
            OUTPUT="$2"
            shift 2
            ;;
        *)
            if [ -z "$PROMPT" ]; then
                PROMPT="$1"
            else
                REF_IMAGES+=("$1")
            fi
            shift
            ;;
    esac
done

OUTPUT="${OUTPUT:-/tmp/chatgpt-$(date +%Y%m%d-%H%M%S).png}"

if [ -z "$PROMPT" ]; then
    echo "用法: $0 \"prompt\" ref1.jpg ref2.jpg ... [--output path]"
    exit 1
fi

echo "=========================================="
echo "  ChatGPT 图片生成 (带参考图)"
echo "=========================================="
echo "Prompt: $PROMPT"
echo "参考图: ${#REF_IMAGES[@]} 张"
echo "输出: $OUTPUT"
echo ""

# ========== Step 1: 准备参考图 ==========
echo "[1/7] 准备参考图..."
for i in "${!REF_IMAGES[@]}"; do
    src="${REF_IMAGES[$i]}"
    idx=$((i + 1))

    if [ -f "$src" ]; then
        # 本地文件，复制到 Mac mini
        scp "$src" "mac-mini:/tmp/ref${idx}.jpg" 2>/dev/null
        echo "  ✓ ref${idx}: $src"
    elif ssh mac-mini "test -f '$src'" 2>/dev/null; then
        # Mac mini 上的文件
        ssh mac-mini "cp '$src' /tmp/ref${idx}.jpg"
        echo "  ✓ ref${idx}: $src (Mac mini)"
    else
        echo "  ✗ 找不到: $src"
        exit 1
    fi
done

# ========== Step 2: 新建对话 ==========
echo "[2/7] 新建对话..."
agent-browser --cdp $CDP_PORT eval "document.querySelector('a[href=\"/\"]')?.click()" >/dev/null 2>&1
sleep 2
echo "  ✓ 新对话"

# ========== Step 3: 上传参考图 ==========
echo "[3/7] 上传 ${#REF_IMAGES[@]} 张参考图..."

for i in "${!REF_IMAGES[@]}"; do
    idx=$((i + 1))
    echo "  上传第 $idx 张..."

    # 点击 Add files 按钮
    ADD_REF=$(agent-browser --cdp $CDP_PORT snapshot -i 2>&1 | grep "Add files and more" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
    agent-browser --cdp $CDP_PORT click "@$ADD_REF" >/dev/null 2>&1
    sleep 1

    # 点击 Add photos & files
    PHOTO_REF=$(agent-browser --cdp $CDP_PORT snapshot -i 2>&1 | grep "Add photos" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
    agent-browser --cdp $CDP_PORT click "@$PHOTO_REF" >/dev/null 2>&1
    sleep 2

    # 用 osascript 选择文件
    ssh mac-mini "osascript <<EOF
delay 1
tell application \"System Events\"
    keystroke \"g\" using {command down, shift down}
end tell
delay 1
tell application \"System Events\"
    keystroke \"/tmp/ref${idx}.jpg\"
    delay 0.3
    keystroke return
    delay 1
    keystroke return
end tell
EOF
" 2>/dev/null

    sleep 2
done

# 验证上传
REMOVE_COUNT=$(agent-browser --cdp $CDP_PORT snapshot -i 2>&1 | grep -c "Remove file" || echo "0")
echo "  ✓ 已上传 $REMOVE_COUNT 张图"

if [ "$REMOVE_COUNT" -lt "${#REF_IMAGES[@]}" ]; then
    echo "  ⚠ 警告: 期望 ${#REF_IMAGES[@]} 张，实际 $REMOVE_COUNT 张"
fi

# ========== Step 4: 输入 Prompt ==========
echo "[4/7] 输入 prompt..."
agent-browser --cdp $CDP_PORT fill "#prompt-textarea" "$PROMPT" >/dev/null 2>&1
sleep 1
echo "  ✓ Prompt 已输入"

# ========== Step 5: 发送 ==========
echo "[5/7] 发送..."
SEND_REF=$(agent-browser --cdp $CDP_PORT snapshot -i 2>&1 | grep "Send prompt" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
agent-browser --cdp $CDP_PORT click "@$SEND_REF" >/dev/null 2>&1
echo "  ✓ 已发送"

# ========== Step 6: 等待生成 ==========
echo "[6/7] 等待图片生成..."
TIMEOUT=180
START=$(date +%s)

while true; do
    ELAPSED=$(($(date +%s) - START))
    if [ $ELAPSED -gt $TIMEOUT ]; then
        echo "  ✗ 超时 (${TIMEOUT}s)"
        exit 1
    fi

    # 检查是否有 "Download this image" 按钮
    HAS_IMAGE=$(agent-browser --cdp $CDP_PORT snapshot -i 2>&1 | grep -c "Download this image" || echo "0")

    if [ "$HAS_IMAGE" -gt 0 ]; then
        echo "  ✓ 图片生成完成！"
        break
    fi

    printf "  等待中... (%ds)\r" "$ELAPSED"
    sleep 5
done

# ========== Step 7: 下载图片 ==========
echo "[7/7] 下载图片..."

# 用 canvas 获取最后一张大图
BASE64=$(agent-browser --cdp $CDP_PORT eval "
(async () => {
    const imgs = document.querySelectorAll('img');
    let lastLarge = null;
    imgs.forEach(img => {
        if (img.naturalWidth >= 1024) lastLarge = img;
    });
    if (!lastLarge) return '';

    const canvas = document.createElement('canvas');
    canvas.width = lastLarge.naturalWidth;
    canvas.height = lastLarge.naturalHeight;
    canvas.getContext('2d').drawImage(lastLarge, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
})()
" 2>/dev/null)

if [ -z "$BASE64" ] || [ "$BASE64" = '""' ]; then
    echo "  ✗ 无法获取图片数据"
    exit 1
fi

echo "$BASE64" | tr -d '"' | base64 -d > "$OUTPUT"

if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
    echo ""
    echo "=========================================="
    echo "  ✓ 完成"
    echo "=========================================="
    echo "文件: $OUTPUT"
    echo "大小: $SIZE"

    # 复制到 Mac mini Downloads
    scp "$OUTPUT" "mac-mini:~/Downloads/$(basename $OUTPUT)" 2>/dev/null
    echo "已同步到 Mac mini Downloads"
else
    echo "  ✗ 保存失败"
    exit 1
fi
