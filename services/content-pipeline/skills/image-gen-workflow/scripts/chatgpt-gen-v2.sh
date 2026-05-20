#!/bin/bash
#
# ChatGPT 图片生成 v2 - 使用 agent-browser
#
# 完整流程：新建对话 → 上传参考图 → 输入prompt → 发送 → 等待 → 下载
#
# 用法:
#   ./chatgpt-gen-v2.sh "prompt文字"
#   ./chatgpt-gen-v2.sh "prompt文字" --ref /path/to/reference.png
#   ./chatgpt-gen-v2.sh "prompt文字" --ref /path/to/ref.png --output /path/to/output.png
#
# 环境要求:
#   - 在 HK VPS 上运行（有 agent-browser）
#   - SSH 隧道到 Mac mini Chrome (端口 9222)
#   - Chrome 已登录 ChatGPT

set -e

# 参数解析
PROMPT=""
REF_IMAGE=""
OUTPUT=""
CDP_PORT="${CDP_PORT:-9222}"
TIMEOUT="${TIMEOUT:-120}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --ref|-r)
            REF_IMAGE="$2"
            shift 2
            ;;
        --output|-o)
            OUTPUT="$2"
            shift 2
            ;;
        --timeout|-t)
            TIMEOUT="$2"
            shift 2
            ;;
        *)
            if [ -z "$PROMPT" ]; then
                PROMPT="$1"
            fi
            shift
            ;;
    esac
done

if [ -z "$PROMPT" ]; then
    echo "用法: $0 \"prompt\" [--ref 参考图] [--output 输出路径]"
    echo ""
    echo "示例:"
    echo "  $0 \"生成深色背景金色文字的卡片：真诚才是流量密码\""
    echo "  $0 \"参考这张图的风格生成新图\" --ref /tmp/style.png"
    exit 1
fi

OUTPUT="${OUTPUT:-/tmp/chatgpt-$(date +%Y%m%d-%H%M%S).png}"

echo "=========================================="
echo "  ChatGPT 图片生成 v2"
echo "=========================================="
echo "Prompt: $PROMPT"
[ -n "$REF_IMAGE" ] && echo "参考图: $REF_IMAGE"
echo "输出: $OUTPUT"
echo ""

# 函数：运行 agent-browser 命令
ab() {
    agent-browser --cdp $CDP_PORT "$@"
}

# 函数：等待并重试
wait_for() {
    local check_cmd="$1"
    local max_wait="${2:-30}"
    local interval="${3:-3}"

    for ((i=0; i<max_wait; i+=interval)); do
        if eval "$check_cmd" 2>/dev/null; then
            return 0
        fi
        sleep $interval
    done
    return 1
}

# ========== Step 1: 确保在 ChatGPT 页面 ==========
echo "[1/7] 检查 ChatGPT 页面..."
CURRENT_URL=$(ab get url 2>/dev/null || echo "")

if [[ ! "$CURRENT_URL" =~ chatgpt\.com ]]; then
    echo "  导航到 ChatGPT..."
    ab eval "window.location.href = 'https://chatgpt.com'" >/dev/null
    sleep 5
fi
echo "  ✓ 在 ChatGPT 页面"

# ========== Step 2: 新建对话 ==========
echo "[2/7] 新建对话..."
ab snapshot -i 2>/dev/null | grep -q "New chat" && {
    NEW_CHAT_REF=$(ab snapshot -i 2>/dev/null | grep "New chat" | grep -o 'ref=e[0-9]*' | head -1 | cut -d= -f2)
    if [ -n "$NEW_CHAT_REF" ]; then
        ab click "@$NEW_CHAT_REF" >/dev/null 2>&1
        sleep 2
    fi
}
echo "  ✓ 新对话已创建"

# ========== Step 3: 上传参考图（如果有）==========
if [ -n "$REF_IMAGE" ] && [ -f "$REF_IMAGE" ]; then
    echo "[3/7] 上传参考图..."

    # 找到上传按钮
    UPLOAD_REF=$(ab snapshot -i 2>/dev/null | grep -i "Add files\|上传\|attach" | grep -o 'ref=e[0-9]*' | head -1 | cut -d= -f2)

    if [ -n "$UPLOAD_REF" ]; then
        # 点击上传按钮
        ab click "@$UPLOAD_REF" >/dev/null 2>&1
        sleep 1

        # 使用 upload 命令上传文件
        ab upload "input[type=file]" "$REF_IMAGE" >/dev/null 2>&1 || {
            # 备选：复制到剪贴板粘贴
            echo "  使用剪贴板方式上传..."
            scp "$REF_IMAGE" mac-mini:/tmp/ref-upload.png 2>/dev/null
            ssh mac-mini "osascript -e 'set the clipboard to (read (POSIX file \"/tmp/ref-upload.png\") as «class PNGf»)'" 2>/dev/null
            ab eval "document.querySelector('#prompt-textarea')?.focus()" >/dev/null
            sleep 0.5
            ssh mac-mini "osascript -e 'tell application \"System Events\" to keystroke \"v\" using command down'" 2>/dev/null
            sleep 2
        }
        echo "  ✓ 参考图已上传"
    else
        echo "  ⚠ 未找到上传按钮，跳过参考图"
    fi
else
    echo "[3/7] 跳过（无参考图）"
fi

# ========== Step 4: 输入 Prompt ==========
echo "[4/7] 输入 prompt..."
ab fill "#prompt-textarea" "$PROMPT" >/dev/null 2>&1 || {
    # 备选方法
    ab eval "
        const ta = document.querySelector('#prompt-textarea') || document.querySelector('textarea');
        if (ta) {
            ta.focus();
            ta.value = $(printf '%s' "$PROMPT" | jq -Rs .);
            ta.dispatchEvent(new Event('input', {bubbles: true}));
        }
    " >/dev/null 2>&1
}
sleep 1
echo "  ✓ Prompt 已输入"

# ========== Step 5: 发送 ==========
echo "[5/7] 发送请求..."
SEND_REF=$(ab snapshot -i 2>/dev/null | grep -i "Send prompt" | grep -o 'ref=e[0-9]*' | head -1 | cut -d= -f2)

if [ -n "$SEND_REF" ]; then
    ab click "@$SEND_REF" >/dev/null 2>&1
else
    ab eval "document.querySelector('[data-testid=\"send-button\"]')?.click() || document.querySelector('form button')?.click()" >/dev/null 2>&1
fi
echo "  ✓ 已发送"

# ========== Step 6: 等待图片生成 ==========
echo "[6/7] 等待图片生成 (最长 ${TIMEOUT}s)..."
START_TIME=$(date +%s)
IMAGE_FOUND=false

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -gt $TIMEOUT ]; then
        echo "  ✗ 超时！"
        exit 1
    fi

    # 检查是否有生成的图片
    RESULT=$(ab eval "
        const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
            i.naturalWidth > 400 &&
            !i.src.includes('avatar') &&
            !i.src.includes('logo') &&
            i.closest('[data-message-author-role=\"assistant\"]')
        );
        imgs.length > 0;
    " 2>/dev/null || echo "false")

    if [ "$RESULT" = "true" ]; then
        echo "  ✓ 图片生成完成！"
        IMAGE_FOUND=true
        break
    fi

    printf "  等待中... (%ds)\r" "$ELAPSED"
    sleep 5
done
echo ""

# ========== Step 7: 下载图片 ==========
echo "[7/7] 下载图片..."

# 使用 canvas 方法获取图片数据
BASE64_DATA=$(ab eval "
(async () => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
        i.naturalWidth > 400 &&
        !i.src.includes('avatar') &&
        i.closest('[data-message-author-role=\"assistant\"]')
    );
    if (imgs.length === 0) return '';

    const img = imgs[imgs.length - 1];

    // 等待图片完全加载
    if (!img.complete) {
        await new Promise(r => img.onload = r);
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    return canvas.toDataURL('image/png').split(',')[1];
})()
" 2>/dev/null)

if [ -z "$BASE64_DATA" ] || [ "$BASE64_DATA" = '""' ] || [ "$BASE64_DATA" = "null" ]; then
    echo "  ✗ 无法获取图片数据"
    exit 1
fi

# 解码保存
echo "$BASE64_DATA" | tr -d '"' | base64 -d > "$OUTPUT"

if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
    DIMS=$(file "$OUTPUT" | grep -o '[0-9]* x [0-9]*' || echo "unknown")

    echo ""
    echo "=========================================="
    echo "  ✓ 完成！"
    echo "=========================================="
    echo "文件: $OUTPUT"
    echo "大小: $SIZE"
    echo "尺寸: $DIMS"
    exit 0
else
    echo "  ✗ 图片保存失败"
    exit 1
fi
