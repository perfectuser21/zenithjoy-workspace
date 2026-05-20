#!/bin/bash
#
# 确保 SSH 隧道到 Mac Mini Chrome 可用
#
# 架构:
#   US VPS (本地 9222) → HK VPS (9222) → Mac mini Chrome (9222)
#
# 通过 HK VPS 中转，因为 US VPS 到 Mac mini 的 Tailscale 不稳定

LOCAL_PORT="${1:-9222}"
REMOTE_PORT="${2:-9222}"

check_local_tunnel() {
    if nc -z localhost $LOCAL_PORT 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

check_hk_tunnel() {
    ssh -o ConnectTimeout=5 hk "nc -z localhost $REMOTE_PORT 2>/dev/null"
}

create_hk_tunnel() {
    echo "  在 HK VPS 建立到 Mac mini 的隧道..."
    ssh hk "pkill -f 'ssh.*-L.*$REMOTE_PORT:127.0.0.1:$REMOTE_PORT.*mac-mini' 2>/dev/null || true"
    sleep 1
    ssh hk "ssh -f -N -L $REMOTE_PORT:127.0.0.1:$REMOTE_PORT mac-mini"
    sleep 2
}

create_local_tunnel() {
    echo "  建立本地到 HK VPS 的隧道..."
    pkill -f "ssh.*-L.*$LOCAL_PORT:127.0.0.1:$REMOTE_PORT.*hk" 2>/dev/null || true
    sleep 1
    ssh -f -N -L $LOCAL_PORT:127.0.0.1:$REMOTE_PORT hk
    sleep 2
}

verify_chrome() {
    if curl -s "http://localhost:$LOCAL_PORT/json/version" 2>/dev/null | grep -q "Browser"; then
        return 0
    else
        return 1
    fi
}

# 主流程
echo "=== 确保 SSH 隧道 (端口 $LOCAL_PORT) ==="

# 1. 检查本地隧道
if check_local_tunnel && verify_chrome; then
    VERSION=$(curl -s "http://localhost:$LOCAL_PORT/json/version" | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4)
    echo "✓ 隧道就绪 - Chrome: $VERSION"
    exit 0
fi

echo "需要重建隧道..."

# 2. 确保 HK → Mac mini 隧道
if ! check_hk_tunnel; then
    create_hk_tunnel || {
        echo "✗ 无法建立 HK → Mac mini 隧道"
        echo "  请确保 Mac mini Chrome 以 debug 模式运行:"
        echo "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\"
        echo "    --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug &"
        exit 1
    }
fi

# 3. 建立本地 → HK 隧道
create_local_tunnel

# 4. 验证
sleep 1
if verify_chrome; then
    VERSION=$(curl -s "http://localhost:$LOCAL_PORT/json/version" | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4)
    echo ""
    echo "✓ 隧道就绪 - Chrome: $VERSION"
    exit 0
else
    echo "✗ 隧道建立但 Chrome 不响应"
    exit 1
fi
