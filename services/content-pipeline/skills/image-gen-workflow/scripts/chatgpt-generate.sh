#!/bin/bash
#
# ChatGPT 图片生成（纯生成，不含质检）
#
# 流程：
#   1. 新建对话
#   2. 上传参考图（可选）
#   3. 输入 prompt 发送
#   4. 等待生成
#   5. 下载图片
#
# 用法:
#   ./chatgpt-generate.sh "prompt"
#   ./chatgpt-generate.sh "prompt" --refs ref1.jpg ref2.jpg
#   ./chatgpt-generate.sh "prompt" --refs /path/*.jpg --output /path/to/output.png
#   ./chatgpt-generate.sh --regenerate  # 重新生成当前对话的图片
#
# 环境要求:
#   - 必须在 HK VPS 上运行
#   - agent-browser 可用
#   - SSH 隧道到 Mac mini Chrome (端口 9222)
#

set -e

# ========== 配置 ==========
CDP_PORT="${CDP_PORT:-9222}"
TIMEOUT="${TIMEOUT:-180}"

# ========== 参数解析 ==========
PROMPT=""
OUTPUT=""
REF_IMAGES=()
REGENERATE=false
PARSING_REFS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --output|-o)
            OUTPUT="$2"
            PARSING_REFS=false
            shift 2
            ;;
        --refs|-r)
            PARSING_REFS=true
            shift
            ;;
        --regenerate)
            REGENERATE=true
            PARSING_REFS=false
            shift
            ;;
        --timeout|-t)
            TIMEOUT="$2"
            PARSING_REFS=false
            shift 2
            ;;
        *)
            if [ "$PARSING_REFS" = true ]; then
                REF_IMAGES+=("$1")
            elif [ -z "$PROMPT" ]; then
                PROMPT="$1"
            fi
            shift
            ;;
    esac
done

OUTPUT="${OUTPUT:-/tmp/chatgpt-$(date +%Y%m%d-%H%M%S).png}"

# 检查参数
if [ "$REGENERATE" = false ] && [ -z "$PROMPT" ]; then
    echo "用法: $0 \"prompt\" [--refs ref1.jpg ref2.jpg ...] [--output path]"
    echo "      $0 --regenerate [--output path]  # 重新生成当前对话"
    exit 1
fi

# ========== 函数定义 ==========

ab() {
    agent-browser --cdp $CDP_PORT "$@"
}

# 准备参考图
# 支持三种格式：
#   1. 本地路径 /path/to/file.jpg - 复制到 Mac mini
#   2. mac:/path - Mac mini 上的绝对路径
#   3. /tmp/refN.jpg - 假定已在 Mac mini /tmp
prepare_refs() {
    [ ${#REF_IMAGES[@]} -eq 0 ] && return 0

    echo "[1] 准备参考图..."
    for i in "${!REF_IMAGES[@]}"; do
        src="${REF_IMAGES[$i]}"
        idx=$((i + 1))

        if [[ "$src" == mac:* ]]; then
            # Mac mini 路径（mac:/path/to/file）
            mac_path="${src#mac:}"
            ssh mac-mini "cp '$mac_path' /tmp/ref${idx}.jpg" 2>/dev/null
            echo "  ✓ ref${idx}: $mac_path (Mac mini)"
        elif [[ "$src" == /tmp/ref*.jpg ]]; then
            # 已在 Mac mini /tmp
            ssh mac-mini "test -f '$src'" 2>/dev/null || { echo "  ✗ Mac mini 上找不到: $src"; return 1; }
            echo "  ✓ ref${idx}: $src (已就绪)"
        elif [ -f "$src" ]; then
            # 本地文件，复制到 Mac mini
            scp "$src" "mac-mini:/tmp/ref${idx}.jpg" 2>/dev/null
            echo "  ✓ ref${idx}: $(basename "$src")"
        elif ssh mac-mini "test -f '$src'" 2>/dev/null; then
            # Mac mini 上的文件
            ssh mac-mini "cp '$src' /tmp/ref${idx}.jpg"
            echo "  ✓ ref${idx}: $src (Mac mini)"
        else
            echo "  ✗ 找不到: $src"
            return 1
        fi
    done
}

# 新建对话
new_chat() {
    echo "[2] 新建对话..."
    ab eval "document.querySelector('a[href=\"/\"]')?.click()" >/dev/null 2>&1
    sleep 2
    echo "  ✓ 完成"
}

# 上传参考图
upload_refs() {
    [ ${#REF_IMAGES[@]} -eq 0 ] && return 0

    echo "[3] 上传 ${#REF_IMAGES[@]} 张参考图..."

    for i in "${!REF_IMAGES[@]}"; do
        idx=$((i + 1))
        printf "  上传 %d/%d...\r" "$idx" "${#REF_IMAGES[@]}"

        # 点击 Add files
        ADD_REF=$(ab snapshot -i 2>&1 | grep "Add files and more" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
        [ -z "$ADD_REF" ] && { echo "  ✗ 找不到 Add files"; return 1; }
        ab click "@$ADD_REF" >/dev/null 2>&1
        sleep 1

        # 点击 Add photos
        PHOTO_REF=$(ab snapshot -i 2>&1 | grep "Add photos" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
        [ -z "$PHOTO_REF" ] && { echo "  ✗ 找不到 Add photos"; return 1; }
        ab click "@$PHOTO_REF" >/dev/null 2>&1
        sleep 2

        # osascript 选择文件
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

    REMOVE_COUNT=$(ab snapshot -i 2>&1 | grep -c "Remove file" || echo "0")
    echo "  ✓ 已上传 $REMOVE_COUNT 张"
}

# 发送 prompt
send_prompt() {
    local prompt="$1"
    echo "[4] 发送 prompt..."

    ab fill "#prompt-textarea" "$prompt" >/dev/null 2>&1
    sleep 1

    SEND_REF=$(ab snapshot -i 2>&1 | grep "Send prompt" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
    [ -z "$SEND_REF" ] && { echo "  ✗ 找不到发送按钮"; return 1; }
    ab click "@$SEND_REF" >/dev/null 2>&1
    echo "  ✓ 已发送"
}

# 重新生成
do_regenerate() {
    echo "[重生成] 请求重新生成..."

    # 尝试找 Regenerate 按钮
    REGEN_REF=$(ab snapshot -i 2>&1 | grep -i "Regenerate" | grep -o 'ref=e[0-9]*' | cut -d= -f2 | head -1)

    if [ -n "$REGEN_REF" ]; then
        ab click "@$REGEN_REF" >/dev/null 2>&1
        echo "  ✓ 已请求重新生成"
    else
        # 备选：发送新 prompt
        send_prompt "请用同样的风格重新生成一张"
    fi
}

# 等待生成
wait_for_image() {
    echo "[5] 等待生成 (最长 ${TIMEOUT}s)..."
    local start=$(date +%s)

    while true; do
        local elapsed=$(($(date +%s) - start))
        [ $elapsed -gt $TIMEOUT ] && { echo "  ✗ 超时"; return 1; }

        local has_image=$(ab snapshot -i 2>&1 | grep -c "Download this image" | tr -d '\n' || echo "0")
        [[ "$has_image" =~ ^[0-9]+$ ]] && [ "$has_image" -gt 0 ] && { echo "  ✓ 生成完成"; return 0; }

        printf "  等待中... (%ds)\r" "$elapsed"
        sleep 5
    done
}

# 下载图片（用 fetch + base64 方式）
download_image() {
    echo "[6] 下载图片..."

    # 在浏览器内 fetch 图片并转 base64
    ab eval "
window.__imgBase64 = null;
const imgs = [...document.querySelectorAll('img')].filter(i => i.naturalWidth >= 1024);
const genImg = imgs[imgs.length - 1];
if (genImg) {
    fetch(genImg.src)
        .then(r => r.blob())
        .then(blob => {
            const reader = new FileReader();
            reader.onloadend = () => { window.__imgBase64 = reader.result.split(',')[1]; };
            reader.readAsDataURL(blob);
        });
}
'OK'
" >/dev/null 2>&1

    # 等待 base64 准备好（最多等 10 秒）
    local wait=0
    local b64len=0
    while [ $wait -lt 10 ]; do
        sleep 1
        wait=$((wait + 1))
        b64len=$(ab eval "window.__imgBase64 ? window.__imgBase64.length : 0" 2>/dev/null | tr -d '"')
        [ "$b64len" -gt 10000 ] && break
    done

    if [ "$b64len" -lt 10000 ]; then
        echo "  ✗ 获取图片数据失败 (len=$b64len)"
        return 1
    fi

    # 获取 base64 并解码
    ab eval "window.__imgBase64" 2>/dev/null | tr -d '"' | base64 -d > "$OUTPUT"

    if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
        SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
        echo "  ✓ 已保存: $OUTPUT ($SIZE)"
        return 0
    else
        echo "  ✗ 保存失败"
        return 1
    fi
}

# ========== 主流程 ==========

echo "=========================================="
echo "  ChatGPT 图片生成"
echo "=========================================="
[ -n "$PROMPT" ] && echo "Prompt: ${PROMPT:0:50}..."
echo "参考图: ${#REF_IMAGES[@]} 张"
echo "输出: $OUTPUT"
echo ""

if [ "$REGENERATE" = true ]; then
    # 重新生成模式
    do_regenerate
else
    # 新生成模式
    prepare_refs || exit 1
    new_chat
    upload_refs || exit 1
    send_prompt "$PROMPT" || exit 1
fi

wait_for_image || exit 1
download_image || exit 1

echo ""
echo "=========================================="
echo "  ✓ 完成"
echo "=========================================="
echo "OUTPUT=$OUTPUT"
