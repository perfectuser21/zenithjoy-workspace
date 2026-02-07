#!/bin/bash
# 确保 SSH 隧道到 Mac Mini 存在

check_tunnel() {
    # 检查 19222 端口是否在监听
    if lsof -i :19222 >/dev/null 2>&1; then
        echo "✓ SSH 隧道已存在"
        return 0
    else
        return 1
    fi
}

create_tunnel() {
    echo "创建 SSH 隧道到 Mac Mini..."
    ssh -f -N -L 19222:localhost:9222 mac-mini
    sleep 2

    if check_tunnel; then
        echo "✓ SSH 隧道创建成功"
        return 0
    else
        echo "✗ SSH 隧道创建失败"
        return 1
    fi
}

verify_chrome() {
    # 验证 Chrome DevTools 可用
    if curl -s http://localhost:19222/json >/dev/null 2>&1; then
        echo "✓ Chrome DevTools 可用"
        return 0
    else
        echo "✗ Chrome DevTools 不可用，请在 Mac Mini 上启动 Chrome debug 模式"
        echo "  命令: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug"
        return 1
    fi
}

# 主流程
if ! check_tunnel; then
    create_tunnel || exit 1
fi

verify_chrome || exit 1

echo "✓ 环境就绪"
