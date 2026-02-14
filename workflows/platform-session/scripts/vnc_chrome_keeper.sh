#!/bin/bash
# VNC Chrome 保活脚本 - 确保每个容器都有 Chrome 运行

CONTAINERS="novnc-douyin novnc-kuaishou novnc-xiaohongshu novnc-toutiao novnc-weibo novnc-channels novnc-gongzhonghao novnc-zhihu"

for container in $CONTAINERS; do
  # 检查容器是否运行
  if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "[$(date)] ❌ $container 未运行，跳过"
    continue
  fi
  
  # 检查 Chrome 是否运行
  chrome_count=$(docker exec $container pgrep -c chrome 2>/dev/null || echo 0)
  
  if [ "$chrome_count" -eq "0" ]; then
    echo "[$(date)] ⚠️ $container Chrome 未运行，正在启动..."
    
    # 先检查 Xvfb 是否运行
    xvfb_count=$(docker exec $container pgrep -c Xvfb 2>/dev/null || echo 0)
    if [ "$xvfb_count" -eq "0" ]; then
      echo "[$(date)] 🔄 $container 桌面未运行，重启 supervisor..."
      docker exec $container supervisorctl restart all 2>/dev/null
      sleep 5
    fi
    
    # 启动 Chrome
    docker exec -d $container bash -c "DISPLAY=:1 google-chrome --no-sandbox --disable-gpu --user-data-dir=/root/chrome-data &" 2>/dev/null
    echo "[$(date)] ✅ $container Chrome 已启动"
  else
    echo "[$(date)] ✅ $container Chrome 运行中 ($chrome_count 进程)"
  fi
done
