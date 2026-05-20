#!/bin/bash
# 一键启动所有平台 Chrome + SSH 隧道
# 用法: bash start-all-browsers.sh

set -euo pipefail

WINDOWS_HOST="xian-pc"

echo "🚀 启动所有平台 Chrome（Windows）..."

TASKS=(
  "AutomationChrome:19222:抖音"
  "AutoChrome19223:19223:快手"
  "AutoChrome19224:19224:小红书"
  "AutoChrome19226:19226:头条"
  "AutoChrome19227:19227:微博"
  "AutoChrome19228:19228:视频号"
  "AutoChrome19230:19230:知乎"
)

for entry in "${TASKS[@]}"; do
  task="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"
  name="${rest##*:}"
  result=$(ssh "$WINDOWS_HOST" "schtasks /run /tn $task 2>&1" 2>/dev/null || echo "FAILED")
  if echo "$result" | grep -qi "成功\|SUCCESS"; then
    echo "  ✅ $name ($port) 已启动"
  else
    echo "  ⚠️  $name ($port): $result"
  fi
done

echo ""
echo "⏳ 等待 Chrome 启动（8秒）..."
sleep 8

echo ""
echo "🔗 建立 SSH 隧道（localhost → Windows）..."

PORTS=(19222 19223 19224 19226 19227 19228 19230)
for port in "${PORTS[@]}"; do
  # 检查隧道是否已存在
  if lsof -i "TCP:$port" -sTCP:LISTEN 2>/dev/null | grep -q ssh; then
    echo "  ✓ $port 隧道已存在"
  else
    ssh -fN -L "${port}:localhost:${port}" "$WINDOWS_HOST" 2>/dev/null && \
      echo "  ✅ $port 隧道已建立" || \
      echo "  ❌ $port 隧道建立失败"
  fi
done

echo ""
echo "🔍 验证连接..."
sleep 3

ALL_OK=true
for port in "${PORTS[@]}"; do
  result=$(curl -s --connect-timeout 3 "http://localhost:$port/json/version" 2>/dev/null || echo "")
  if echo "$result" | grep -q "Browser"; then
    version=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('Browser','?')[:20])" 2>/dev/null || echo "OK")
    echo "  ✅ $port: $version"
  else
    echo "  ❌ $port: 未响应"
    ALL_OK=false
  fi
done

echo ""
if $ALL_OK; then
  echo "✅ 所有平台就绪，可以开始发布"
else
  echo "⚠️  部分平台未就绪，请检查 Windows Chrome 是否正常启动"
fi
