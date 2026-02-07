#!/bin/bash
# 在所有 VNC 容器中启动 Chrome 并打开对应平台

declare -A URLS=(
  ["novnc-douyin"]="https://creator.douyin.com"
  ["novnc-kuaishou"]="https://cp.kuaishou.com"
  ["novnc-xiaohongshu"]="https://creator.xiaohongshu.com"
  ["novnc-toutiao"]="https://mp.toutiao.com"
  ["novnc-weibo"]="https://creator.weibo.com"
  ["novnc-channels"]="https://channels.weixin.qq.com"
  ["novnc-gongzhonghao"]="https://mp.weixin.qq.com"
  ["novnc-zhihu"]="https://www.zhihu.com/creator"
)

for container in "${!URLS[@]}"; do
  url="${URLS[$container]}"
  platform="${container#novnc-}"
  
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "启动 $platform 浏览器..."
    docker exec -d "$container" bash -c "
      export DISPLAY=:1
      chromium-browser --no-sandbox --disable-dev-shm-usage --disable-gpu \
        --remote-debugging-port=9222 \
        --user-data-dir=/headless/.config/chromium \
        '$url' &
    "
    echo "✓ $platform: $url"
  else
    echo "✗ $platform: 容器未运行"
  fi
done

echo ""
echo "请通过 VNC 登录各平台"
