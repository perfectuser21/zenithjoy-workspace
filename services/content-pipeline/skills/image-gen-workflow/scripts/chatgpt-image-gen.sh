#!/bin/bash
#
# ChatGPT 图片生成 - 使用 agent-browser
#
# 用法:
#   ./chatgpt-image-gen.sh "生成一张深色背景金色文字的卡片，文案是：真诚才是流量密码"
#   ./chatgpt-image-gen.sh "prompt" /path/to/output.png
#
# 依赖:
#   - SSH 隧道到 Mac mini Chrome (端口 9222)
#   - agent-browser 已安装
#   - Chrome 已登录 ChatGPT

set -e

PROMPT="$1"
OUTPUT="${2:-/tmp/chatgpt-image-$(date +%Y%m%d-%H%M%S).png}"
CDP_PORT="${CDP_PORT:-9222}"
TIMEOUT="${TIMEOUT:-120}"

if [ -z "$PROMPT" ]; then
    echo "用法: $0 <prompt> [output_path]"
    exit 1
fi

echo "=== ChatGPT 图片生成 ==="
echo "Prompt: $PROMPT"
echo "输出: $OUTPUT"
echo ""

# 1. 确保在 ChatGPT 页面
echo "[1/6] 检查 ChatGPT 页面..."
CURRENT_URL=$(agent-browser --cdp $CDP_PORT get url 2>/dev/null || echo "")

if [[ ! "$CURRENT_URL" =~ chatgpt\.com ]]; then
    echo "  导航到 ChatGPT..."
    agent-browser --cdp $CDP_PORT eval "window.location.href = 'https://chatgpt.com'" >/dev/null
    sleep 5
fi

# 2. 新建对话
echo "[2/6] 新建对话..."
agent-browser --cdp $CDP_PORT eval "
    const newChatLink = document.querySelector('a[href=\"/\"]') ||
                        document.querySelector('[data-testid=\"create-new-chat-button\"]') ||
                        document.querySelector('nav a[class*=\"new\"]');
    if (newChatLink) newChatLink.click();
" >/dev/null 2>&1 || true
sleep 2

# 3. 输入 prompt
echo "[3/6] 输入 prompt..."
# 转义特殊字符
ESCAPED_PROMPT=$(echo "$PROMPT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed "s/'/\\\\'/g" | sed ':a;N;$!ba;s/\n/\\n/g')

agent-browser --cdp $CDP_PORT eval "
    const textarea = document.querySelector('#prompt-textarea') ||
                    document.querySelector('textarea[data-id=\"root\"]') ||
                    document.querySelector('textarea');
    if (textarea) {
        textarea.focus();
        textarea.value = '$ESCAPED_PROMPT';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
" >/dev/null

sleep 1

# 4. 点击发送
echo "[4/6] 发送..."
agent-browser --cdp $CDP_PORT eval "
    const sendBtn = document.querySelector('[data-testid=\"send-button\"]') ||
                   document.querySelector('button[aria-label*=\"Send\"]') ||
                   document.querySelector('form button:not([disabled])');
    if (sendBtn) sendBtn.click();
" >/dev/null

# 5. 等待图片生成
echo "[5/6] 等待图片生成... (最长 ${TIMEOUT}s)"
START_TIME=$(date +%s)
IMAGE_FOUND=false

while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -gt $TIMEOUT ]; then
        echo "  超时！"
        break
    fi

    # 检查是否有图片
    RESULT=$(agent-browser --cdp $CDP_PORT eval "
        const imgs = document.querySelectorAll('img[src*=\"oaidalleapi\"], img[src*=\"dalle\"], img[alt*=\"生成\"], img[alt*=\"Generated\"]');
        const largeImgs = Array.from(document.querySelectorAll('img')).filter(i =>
            i.naturalWidth > 400 &&
            !i.src.includes('avatar') &&
            !i.src.includes('logo') &&
            !i.src.includes('icon') &&
            i.closest('[data-message-author-role=\"assistant\"]')
        );
        const allImgs = [...imgs, ...largeImgs];
        if (allImgs.length > 0) {
            JSON.stringify({found: true, count: allImgs.length});
        } else {
            // 检查是否还在生成中
            const streaming = document.querySelector('[class*=\"streaming\"]') ||
                             document.querySelector('[class*=\"loading\"]') ||
                             document.querySelector('[data-testid*=\"loading\"]');
            JSON.stringify({found: false, streaming: !!streaming});
        }
    " 2>/dev/null || echo '{"found":false}')

    if echo "$RESULT" | grep -q '"found":true'; then
        echo "  找到图片！"
        IMAGE_FOUND=true
        break
    fi

    echo "  等待中... (${ELAPSED}s)"
    sleep 5
done

if [ "$IMAGE_FOUND" != "true" ]; then
    echo "错误: 未能检测到生成的图片"
    exit 1
fi

# 等待图片完全加载
sleep 3

# 6. 点击图片并下载
echo "[6/6] 下载图片..."

# 首先点击图片展开
agent-browser --cdp $CDP_PORT eval "
    const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
        i.naturalWidth > 400 &&
        !i.src.includes('avatar') &&
        !i.src.includes('logo') &&
        i.closest('[data-message-author-role=\"assistant\"]')
    );
    if (imgs.length > 0) {
        const lastImg = imgs[imgs.length - 1];
        lastImg.scrollIntoView({behavior: 'smooth', block: 'center'});
        lastImg.click();
    }
" >/dev/null 2>&1 || true

sleep 2

# 尝试从展开的模态框下载
DOWNLOAD_URL=$(agent-browser --cdp $CDP_PORT eval "
    // 查找下载按钮或高清图片
    const modal = document.querySelector('[role=\"dialog\"]') ||
                  document.querySelector('[class*=\"modal\"]') ||
                  document.querySelector('[class*=\"lightbox\"]');

    let imgUrl = '';

    if (modal) {
        const modalImg = modal.querySelector('img');
        if (modalImg) imgUrl = modalImg.src;

        // 查找下载按钮
        const downloadBtn = modal.querySelector('a[download]') ||
                           modal.querySelector('button[aria-label*=\"download\"]') ||
                           modal.querySelector('[data-testid*=\"download\"]');
        if (downloadBtn && downloadBtn.href) {
            imgUrl = downloadBtn.href;
        }
    }

    // 如果模态框没找到，直接取最新图片
    if (!imgUrl) {
        const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
            i.naturalWidth > 400 &&
            !i.src.includes('avatar') &&
            i.closest('[data-message-author-role=\"assistant\"]')
        );
        if (imgs.length > 0) {
            imgUrl = imgs[imgs.length - 1].src;
        }
    }

    imgUrl;
" 2>/dev/null || echo "")

if [ -n "$DOWNLOAD_URL" ] && [ "$DOWNLOAD_URL" != "undefined" ] && [ "$DOWNLOAD_URL" != "null" ]; then
    echo "  下载: ${DOWNLOAD_URL:0:80}..."

    # 通过 Mac mini 下载图片
    ssh mac-mini "curl -s -o /tmp/chatgpt-download.png '$DOWNLOAD_URL'" 2>/dev/null || true

    # 传回本地
    scp mac-mini:/tmp/chatgpt-download.png "$OUTPUT" 2>/dev/null || {
        echo "  直接下载失败，尝试截图方式..."
        agent-browser --cdp $CDP_PORT screenshot "$OUTPUT" --full 2>/dev/null || true
    }
else
    echo "  无法获取下载链接，使用截图方式..."
    # 截取图片区域
    agent-browser --cdp $CDP_PORT eval "
        const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
            i.naturalWidth > 400 &&
            !i.src.includes('avatar') &&
            i.closest('[data-message-author-role=\"assistant\"]')
        );
        if (imgs.length > 0) {
            const lastImg = imgs[imgs.length - 1];
            lastImg.scrollIntoView({behavior: 'instant', block: 'center'});
        }
    " >/dev/null 2>&1 || true

    sleep 1
    agent-browser --cdp $CDP_PORT screenshot "$OUTPUT" 2>/dev/null || true
fi

# 检查结果
if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
    echo ""
    echo "=== 完成 ==="
    echo "图片已保存: $OUTPUT"
    echo "文件大小: $SIZE"
    exit 0
else
    echo "错误: 图片保存失败"
    exit 1
fi
