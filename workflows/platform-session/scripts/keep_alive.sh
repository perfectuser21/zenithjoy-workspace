#!/bin/bash
# 用 xdotool 模拟 F5 刷新所有浏览器

CONTAINERS=(novnc-douyin novnc-kuaishou novnc-xiaohongshu novnc-toutiao novnc-weibo novnc-channels novnc-gongzhonghao novnc-zhihu)

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 刷新所有平台"

for container in "${CONTAINERS[@]}"; do
  platform="${container#novnc-}"
  
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    # 检查 Chrome 是否在运行
    if docker exec "$container" pgrep -x chromium-browse > /dev/null 2>&1; then
      # 用 xdotool 发送 F5 刷新
      docker exec "$container" bash -c "export DISPLAY=:1 && xdotool key F5" 2>/dev/null
      echo "✓ $platform 已刷新"
    else
      echo "- $platform 浏览器未运行"
    fi
  else
    echo "✗ $platform 容器未运行"
  fi
done
