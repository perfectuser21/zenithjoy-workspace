#!/bin/bash
#
# 下载 ChatGPT 生成的图片 - 使用 agent-browser
#
# 功能:
#   1. 点击图片展开查看
#   2. 查找下载按钮或高清图片 URL
#   3. 下载到本地
#
# 用法:
#   ./download-chatgpt-image.sh [output_path]

set -e

OUTPUT="${1:-/tmp/chatgpt-image-$(date +%Y%m%d-%H%M%S).png}"
CDP_PORT="${CDP_PORT:-9222}"

echo "=== 下载 ChatGPT 图片 ==="

# 1. 获取页面上的图片信息
echo "[1/4] 查找生成的图片..."

IMAGE_INFO=$(agent-browser --cdp $CDP_PORT eval "
    const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
        i.naturalWidth > 400 &&
        !i.src.includes('avatar') &&
        !i.src.includes('logo') &&
        !i.src.includes('icon') &&
        (i.closest('[data-message-author-role=\"assistant\"]') || i.src.includes('dalle') || i.src.includes('openai'))
    );

    if (imgs.length === 0) {
        JSON.stringify({error: 'no images found'});
    } else {
        const img = imgs[imgs.length - 1];
        const rect = img.getBoundingClientRect();
        JSON.stringify({
            count: imgs.length,
            src: img.src,
            width: img.naturalWidth,
            height: img.naturalHeight,
            x: rect.x,
            y: rect.y,
            displayWidth: rect.width,
            displayHeight: rect.height
        });
    }
" 2>/dev/null)

if echo "$IMAGE_INFO" | grep -q '"error"'; then
    echo "错误: 未找到图片"
    exit 1
fi

echo "  找到图片: $(echo "$IMAGE_INFO" | grep -o '"count":[0-9]*' | cut -d: -f2) 张"
echo "  尺寸: $(echo "$IMAGE_INFO" | grep -o '"width":[0-9]*' | cut -d: -f2)x$(echo "$IMAGE_INFO" | grep -o '"height":[0-9]*' | cut -d: -f2)"

# 2. 点击图片展开
echo "[2/4] 点击图片展开..."

agent-browser --cdp $CDP_PORT eval "
    const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
        i.naturalWidth > 400 &&
        !i.src.includes('avatar') &&
        (i.closest('[data-message-author-role=\"assistant\"]') || i.src.includes('dalle'))
    );
    if (imgs.length > 0) {
        const img = imgs[imgs.length - 1];
        img.scrollIntoView({behavior: 'instant', block: 'center'});
        img.click();
        'clicked';
    } else {
        'no image to click';
    }
" >/dev/null 2>&1 || true

sleep 2

# 3. 查找高清图片或下载链接
echo "[3/4] 获取高清图片..."

DOWNLOAD_URL=$(agent-browser --cdp $CDP_PORT eval "
    // 优先级:
    // 1. 模态框中的下载按钮链接
    // 2. 模态框中的高清图片
    // 3. 页面上的原图

    let url = '';

    // 检查模态框
    const modal = document.querySelector('[role=\"dialog\"]') ||
                  document.querySelector('[class*=\"modal\"]') ||
                  document.querySelector('[class*=\"lightbox\"]') ||
                  document.querySelector('[class*=\"overlay\"]');

    if (modal) {
        // 下载按钮
        const downloadBtn = modal.querySelector('a[download]');
        if (downloadBtn && downloadBtn.href) {
            url = downloadBtn.href;
        }

        // 模态框中的图片
        if (!url) {
            const modalImg = modal.querySelector('img');
            if (modalImg && modalImg.src && modalImg.naturalWidth > 400) {
                url = modalImg.src;
            }
        }
    }

    // 原图
    if (!url) {
        const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
            i.naturalWidth > 400 &&
            !i.src.includes('avatar') &&
            (i.closest('[data-message-author-role=\"assistant\"]') || i.src.includes('dalle'))
        );
        if (imgs.length > 0) {
            url = imgs[imgs.length - 1].src;
        }
    }

    url;
" 2>/dev/null)

# 关闭模态框
agent-browser --cdp $CDP_PORT press Escape 2>/dev/null || true

# 4. 下载图片
echo "[4/4] 下载图片..."

if [ -n "$DOWNLOAD_URL" ] && [ "$DOWNLOAD_URL" != "undefined" ] && [ "$DOWNLOAD_URL" != "null" ]; then
    echo "  URL: ${DOWNLOAD_URL:0:100}..."

    # 检查是否是 blob URL
    if [[ "$DOWNLOAD_URL" == blob:* ]]; then
        echo "  Blob URL 无法直接下载，使用截图方式..."

        # 滚动到图片位置并截图
        agent-browser --cdp $CDP_PORT eval "
            const imgs = Array.from(document.querySelectorAll('img')).filter(i =>
                i.naturalWidth > 400 && !i.src.includes('avatar')
            );
            if (imgs.length > 0) {
                imgs[imgs.length - 1].scrollIntoView({behavior: 'instant', block: 'center'});
            }
        " >/dev/null 2>&1 || true

        sleep 1
        agent-browser --cdp $CDP_PORT screenshot "$OUTPUT" 2>/dev/null
    else
        # 通过 curl 下载
        # 先尝试本地下载
        if curl -s -o "$OUTPUT" "$DOWNLOAD_URL" 2>/dev/null; then
            echo "  本地下载成功"
        else
            # 通过 Mac mini 下载
            echo "  通过 Mac mini 下载..."
            ssh mac-mini "curl -s -o /tmp/dl-img.png '$DOWNLOAD_URL'" 2>/dev/null
            scp mac-mini:/tmp/dl-img.png "$OUTPUT" 2>/dev/null
        fi
    fi
else
    echo "  无法获取 URL，使用截图方式..."
    agent-browser --cdp $CDP_PORT screenshot "$OUTPUT" 2>/dev/null
fi

# 验证结果
if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
    echo ""
    echo "=== 完成 ==="
    echo "已保存: $OUTPUT"
    echo "大小: $SIZE"

    # 获取图片尺寸 (如果有 file 命令)
    if command -v file &>/dev/null; then
        file "$OUTPUT" | grep -o '[0-9]* x [0-9]*' || true
    fi

    exit 0
else
    echo "错误: 下载失败"
    exit 1
fi
