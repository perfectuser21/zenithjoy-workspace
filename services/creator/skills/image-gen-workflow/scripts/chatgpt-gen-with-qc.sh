#!/bin/bash
#
# ChatGPT 图片生成 + Claude 质检
#
# 完整流程：
#   1. 上传参考图（可选）
#   2. 输入 prompt 发送
#   3. 等待生成
#   4. 下载到临时位置
#   5. Claude API 质检
#   6. 不合格 → 重新生成（最多 3 次）
#   7. 合格 → 输出最终文件
#
# 用法:
#   ./chatgpt-gen-with-qc.sh "prompt文字"
#   ./chatgpt-gen-with-qc.sh "prompt" --refs /path/to/ref1.jpg /path/to/ref2.jpg
#   ./chatgpt-gen-with-qc.sh "prompt" --refs /path/*.jpg --output /path/to/output.png
#   ./chatgpt-gen-with-qc.sh "prompt" --refs /path/*.jpg --criteria "米白色文字，黑色背景"
#
# 环境要求:
#   - 必须在 HK VPS 上运行（有 agent-browser + SSH 隧道到 Mac mini Chrome）
#   - ANTHROPIC_API_KEY 环境变量（用于质检）
#
# 质检标准（默认）:
#   - 文字清晰可读
#   - 风格与参考图一致
#   - 无明显瑕疵
#

set -e

# ========== 配置 ==========
CDP_PORT="${CDP_PORT:-9222}"
MAX_RETRIES="${MAX_RETRIES:-3}"
TIMEOUT="${TIMEOUT:-180}"
QC_THRESHOLD="${QC_THRESHOLD:-7}"  # 质检分数阈值，>=7 合格

# ========== 参数解析 ==========
PROMPT=""
OUTPUT=""
CRITERIA=""
REF_IMAGES=()
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
        --criteria|-c)
            CRITERIA="$2"
            PARSING_REFS=false
            shift 2
            ;;
        --threshold|-t)
            QC_THRESHOLD="$2"
            PARSING_REFS=false
            shift 2
            ;;
        --max-retries|-m)
            MAX_RETRIES="$2"
            PARSING_REFS=false
            shift 2
            ;;
        *)
            if [ "$PARSING_REFS" = true ]; then
                # 收集参考图
                REF_IMAGES+=("$1")
            elif [ -z "$PROMPT" ]; then
                PROMPT="$1"
            fi
            shift
            ;;
    esac
done

OUTPUT="${OUTPUT:-/tmp/chatgpt-qc-$(date +%Y%m%d-%H%M%S).png}"
TEMP_DIR="/tmp/chatgpt-gen-$$"
mkdir -p "$TEMP_DIR"

# 清理函数
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# ========== 检查依赖 ==========
if [ -z "$PROMPT" ]; then
    echo "用法: $0 \"prompt\" [--refs ref1.jpg ref2.jpg ...] [--output path] [--criteria \"质检标准\"]"
    echo ""
    echo "选项:"
    echo "  --refs, -r      参考图列表"
    echo "  --output, -o    输出路径"
    echo "  --criteria, -c  质检标准描述"
    echo "  --threshold, -t 质检分数阈值 (默认 7)"
    echo "  --max-retries   最大重试次数 (默认 3)"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    # 尝试从凭据文件加载
    if [ -f ~/.credentials/anthropic.env ]; then
        source ~/.credentials/anthropic.env
    fi
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "错误: 需要 ANTHROPIC_API_KEY 环境变量用于质检"
        exit 1
    fi
fi

echo "=========================================="
echo "  ChatGPT 图片生成 + Claude 质检"
echo "=========================================="
echo "Prompt: $PROMPT"
echo "参考图: ${#REF_IMAGES[@]} 张"
echo "输出: $OUTPUT"
echo "质检阈值: >= $QC_THRESHOLD 分"
echo "最大重试: $MAX_RETRIES 次"
[ -n "$CRITERIA" ] && echo "质检标准: $CRITERIA"
echo ""

# ========== 函数定义 ==========

# 运行 agent-browser 命令
ab() {
    agent-browser --cdp $CDP_PORT "$@"
}

# 准备参考图（复制到 Mac mini /tmp）
prepare_refs() {
    if [ ${#REF_IMAGES[@]} -eq 0 ]; then
        return 0
    fi

    echo "[准备] 复制参考图到 Mac mini..."
    for i in "${!REF_IMAGES[@]}"; do
        src="${REF_IMAGES[$i]}"
        idx=$((i + 1))

        if [ -f "$src" ]; then
            scp "$src" "mac-mini:/tmp/ref${idx}.jpg" 2>/dev/null
            echo "  ✓ ref${idx}: $(basename "$src")"
        elif ssh mac-mini "test -f '$src'" 2>/dev/null; then
            ssh mac-mini "cp '$src' /tmp/ref${idx}.jpg"
            echo "  ✓ ref${idx}: $src (Mac mini)"
        else
            echo "  ✗ 找不到: $src"
            return 1
        fi
    done
}

# 新建 ChatGPT 对话
new_chat() {
    echo "[新建] 创建新对话..."
    ab eval "document.querySelector('a[href=\"/\"]')?.click()" >/dev/null 2>&1
    sleep 2
    echo "  ✓ 新对话已创建"
}

# 上传参考图
upload_refs() {
    if [ ${#REF_IMAGES[@]} -eq 0 ]; then
        return 0
    fi

    echo "[上传] 上传 ${#REF_IMAGES[@]} 张参考图..."

    for i in "${!REF_IMAGES[@]}"; do
        idx=$((i + 1))
        echo "  上传第 $idx 张..."

        # 点击 Add files 按钮
        ADD_REF=$(ab snapshot -i 2>&1 | grep "Add files and more" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
        if [ -z "$ADD_REF" ]; then
            echo "  ✗ 找不到 Add files 按钮"
            return 1
        fi
        ab click "@$ADD_REF" >/dev/null 2>&1
        sleep 1

        # 点击 Add photos & files
        PHOTO_REF=$(ab snapshot -i 2>&1 | grep "Add photos" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
        if [ -z "$PHOTO_REF" ]; then
            echo "  ✗ 找不到 Add photos 菜单"
            return 1
        fi
        ab click "@$PHOTO_REF" >/dev/null 2>&1
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
    REMOVE_COUNT=$(ab snapshot -i 2>&1 | grep -c "Remove file" || echo "0")
    echo "  ✓ 已上传 $REMOVE_COUNT 张图"

    if [ "$REMOVE_COUNT" -lt "${#REF_IMAGES[@]}" ]; then
        echo "  ⚠ 警告: 期望 ${#REF_IMAGES[@]} 张，实际 $REMOVE_COUNT 张"
    fi
}

# 发送 prompt
send_prompt() {
    local prompt="$1"

    echo "[发送] 输入并发送 prompt..."
    ab fill "#prompt-textarea" "$prompt" >/dev/null 2>&1
    sleep 1

    SEND_REF=$(ab snapshot -i 2>&1 | grep "Send prompt" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
    if [ -z "$SEND_REF" ]; then
        echo "  ✗ 找不到发送按钮"
        return 1
    fi
    ab click "@$SEND_REF" >/dev/null 2>&1
    echo "  ✓ 已发送"
}

# 等待生成完成
wait_for_image() {
    echo "[等待] 等待图片生成 (最长 ${TIMEOUT}s)..."
    local start=$(date +%s)

    while true; do
        local elapsed=$(($(date +%s) - start))
        if [ $elapsed -gt $TIMEOUT ]; then
            echo "  ✗ 超时"
            return 1
        fi

        # 检查是否有 Download 按钮
        local has_image=$(ab snapshot -i 2>&1 | grep -c "Download this image" || echo "0")

        if [ "$has_image" -gt 0 ]; then
            echo "  ✓ 生成完成！"
            return 0
        fi

        printf "  等待中... (%ds)\r" "$elapsed"
        sleep 5
    done
}

# 下载图片
download_image() {
    local output_path="$1"

    echo "[下载] 下载图片..."

    # 点击 Download 按钮
    local dl_ref=$(ab snapshot -i 2>&1 | grep "Download this image" | grep -o 'ref=e[0-9]*' | cut -d= -f2)
    if [ -z "$dl_ref" ]; then
        echo "  ✗ 找不到下载按钮"
        return 1
    fi
    ab click "@$dl_ref" >/dev/null 2>&1
    sleep 3

    # 获取 Mac mini Downloads 最新文件
    local latest=$(ssh mac-mini "ls -t ~/Downloads/*.png 2>/dev/null | head -1")
    if [ -z "$latest" ]; then
        echo "  ✗ 找不到下载的文件"
        return 1
    fi

    # 复制到本地
    scp "mac-mini:$latest" "$output_path" 2>/dev/null

    if [ -f "$output_path" ] && [ -s "$output_path" ]; then
        local size=$(ls -lh "$output_path" | awk '{print $5}')
        echo "  ✓ 已下载: $output_path ($size)"
        return 0
    else
        echo "  ✗ 下载失败"
        return 1
    fi
}

# Claude 质检
quality_check() {
    local image_path="$1"
    local criteria="$2"

    echo "[质检] Claude 评估图片..."

    # 将图片转为 base64
    local base64_data=$(base64 -w 0 "$image_path")

    # 构建质检 prompt
    local qc_prompt="请评估这张生成的图片质量。

评估标准：
1. 文字是否清晰可读
2. 整体视觉效果
3. 风格是否符合要求"

    if [ -n "$criteria" ]; then
        qc_prompt="$qc_prompt
4. 特殊要求：$criteria"
    fi

    qc_prompt="$qc_prompt

请给出 1-10 的评分，并简要说明理由。
输出格式：
SCORE: [分数]
REASON: [理由]"

    # 调用 Claude API
    local response=$(curl -s https://api.anthropic.com/v1/messages \
        -H "Content-Type: application/json" \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "{
            \"model\": \"claude-sonnet-4-20250514\",
            \"max_tokens\": 500,
            \"messages\": [{
                \"role\": \"user\",
                \"content\": [
                    {
                        \"type\": \"image\",
                        \"source\": {
                            \"type\": \"base64\",
                            \"media_type\": \"image/png\",
                            \"data\": \"$base64_data\"
                        }
                    },
                    {
                        \"type\": \"text\",
                        \"text\": \"$qc_prompt\"
                    }
                ]
            }]
        }")

    # 解析结果
    local text=$(echo "$response" | jq -r '.content[0].text // empty')

    if [ -z "$text" ]; then
        echo "  ✗ 质检 API 调用失败"
        echo "  响应: $response"
        return 1
    fi

    # 提取分数
    local score=$(echo "$text" | grep -oP 'SCORE:\s*\K[0-9]+' | head -1)
    local reason=$(echo "$text" | grep -oP 'REASON:\s*\K.*' | head -1)

    if [ -z "$score" ]; then
        # 尝试其他格式
        score=$(echo "$text" | grep -oP '[0-9]+/10' | head -1 | cut -d/ -f1)
    fi

    if [ -z "$score" ]; then
        score="5"  # 默认分数
    fi

    echo "  分数: $score/10"
    echo "  理由: ${reason:-$text}"

    # 返回分数用于判断
    echo "$score" > "$TEMP_DIR/qc_score"

    if [ "$score" -ge "$QC_THRESHOLD" ]; then
        echo "  ✓ 质检通过"
        return 0
    else
        echo "  ✗ 质检不通过 (阈值: $QC_THRESHOLD)"
        return 1
    fi
}

# 重新生成
regenerate() {
    echo "[重试] 请求重新生成..."

    # 找到并点击重新生成按钮
    # ChatGPT 的重新生成通常是输入新 prompt 或点击 Regenerate
    local regen_ref=$(ab snapshot -i 2>&1 | grep -i "Regenerate" | grep -o 'ref=e[0-9]*' | cut -d= -f2)

    if [ -n "$regen_ref" ]; then
        ab click "@$regen_ref" >/dev/null 2>&1
        echo "  ✓ 已请求重新生成"
    else
        # 备选：发送"请重新生成"
        send_prompt "请重新生成一张，风格保持一致"
    fi
}

# ========== 主流程 ==========

# 1. 准备参考图
prepare_refs || exit 1

# 2. 新建对话
new_chat

# 3. 上传参考图
upload_refs || exit 1

# 4. 生成 + 质检循环
attempt=0
success=false

while [ $attempt -lt $MAX_RETRIES ]; do
    attempt=$((attempt + 1))
    echo ""
    echo "========== 第 $attempt 次尝试 =========="

    if [ $attempt -eq 1 ]; then
        # 首次：发送完整 prompt
        send_prompt "$PROMPT" || continue
    else
        # 重试：请求重新生成
        regenerate
    fi

    # 等待生成
    wait_for_image || continue

    # 下载到临时位置
    temp_image="$TEMP_DIR/attempt_${attempt}.png"
    download_image "$temp_image" || continue

    # 质检
    if quality_check "$temp_image" "$CRITERIA"; then
        # 质检通过，移动到最终位置
        cp "$temp_image" "$OUTPUT"
        success=true
        break
    fi
done

# ========== 结果 ==========
echo ""
echo "=========================================="
if [ "$success" = true ]; then
    echo "  ✓ 完成！"
    echo "=========================================="
    echo "文件: $OUTPUT"
    echo "大小: $(ls -lh "$OUTPUT" | awk '{print $5}')"
    echo "尝试次数: $attempt"

    # 同步到 Mac mini Downloads
    scp "$OUTPUT" "mac-mini:~/Downloads/$(basename "$OUTPUT")" 2>/dev/null
    echo "已同步到 Mac mini Downloads"

    exit 0
else
    echo "  ✗ 失败（已重试 $MAX_RETRIES 次）"
    echo "=========================================="

    # 保留最后一次尝试的图片供人工检查
    if [ -f "$TEMP_DIR/attempt_${MAX_RETRIES}.png" ]; then
        cp "$TEMP_DIR/attempt_${MAX_RETRIES}.png" "${OUTPUT%.png}_failed.png"
        echo "最后一次尝试已保存: ${OUTPUT%.png}_failed.png"
    fi

    exit 1
fi
