#!/bin/bash

# 通用平台登录脚本
# 用法: platform_login.sh <platform> <action>
# platform: douyin, kuaishou, xiaohongshu, toutiao, weibo, channels
# action: start, check, stop

PLATFORM="${1:-douyin}"
ACTION="${2:-start}"

# 平台配置
declare -A PORTS=( [douyin]=6080 [kuaishou]=6081 [xiaohongshu]=6082 [toutiao]=6083 [weibo]=6084 [channels]=6085 )
declare -A URLS=( 
  [douyin]="https://creator.douyin.com" 
  [kuaishou]="https://cp.kuaishou.com" 
  [xiaohongshu]="https://creator.xiaohongshu.com" 
  [toutiao]="https://mp.toutiao.com" 
  [weibo]="https://weibo.com" 
  [channels]="https://channels.weixin.qq.com"
)
declare -A NAMES=(
  [douyin]="抖音" [kuaishou]="快手" [xiaohongshu]="小红书" 
  [toutiao]="今日头条" [weibo]="微博" [channels]="视频号"
)

PORT=${PORTS[$PLATFORM]}
URL=${URLS[$PLATFORM]}
NAME=${NAMES[$PLATFORM]}
CONTAINER="novnc-$PLATFORM"
DATA_DIR="/home/xx/.$PLATFORM"
VPS_IP="146.190.52.84"

case "$ACTION" in
  start)
    if docker ps | grep -q "$CONTAINER"; then
      echo "{\"status\":\"already_running\",\"platform\":\"$NAME\",\"vnc_url\":\"http://$VPS_IP:$PORT/vnc.html\",\"password\":\"123456\"}"
      exit 0
    fi
    
    mkdir -p "$DATA_DIR/chrome-data" 2>/dev/null || true
    
    docker rm -f "$CONTAINER" 2>/dev/null >/dev/null
    docker run -d --name "$CONTAINER" \
      --restart unless-stopped \
      -p $PORT:6901 \
      -v "$DATA_DIR/chrome-data:/home/headless/.config/chromium" \
      -e VNC_PW=123456 \
      consol/ubuntu-xfce-vnc:latest >/dev/null 2>&1
    
    sleep 5
    
    docker exec -u 0 "$CONTAINER" apt-get update -qq >/dev/null 2>&1
    docker exec -u 0 "$CONTAINER" apt-get install -y -qq chromium-browser curl socat >/dev/null 2>&1
    docker exec -u 0 "$CONTAINER" chown -R 1000:1000 /home/headless/.config/chromium 2>/dev/null
    
    docker exec -d "$CONTAINER" bash -c "DISPLAY=:1 chromium-browser --no-sandbox --disable-gpu --disable-software-rasterizer --disable-dev-shm-usage --remote-debugging-port=9222 $URL &" 2>/dev/null
    
    sleep 3
    docker exec -d "$CONTAINER" socat TCP-LISTEN:9223,fork,bind=0.0.0.0,reuseaddr TCP:localhost:9222 2>/dev/null
    
    echo "{\"status\":\"ready\",\"platform\":\"$NAME\",\"vnc_url\":\"http://$VPS_IP:$PORT/vnc.html\",\"password\":\"123456\",\"message\":\"请在 VNC 中扫码登录$NAME\"}"
    ;;
    
  check)
    if ! docker ps | grep -q "$CONTAINER"; then
      echo "{\"status\":\"not_running\",\"platform\":\"$NAME\"}"
      exit 1
    fi
    
    PAGE_INFO=$(docker exec "$CONTAINER" curl -s http://localhost:9222/json 2>/dev/null)
    
    if [ "$PAGE_INFO" = "[ ]" ] || [ -z "$PAGE_INFO" ]; then
      echo "{\"status\":\"no_page\",\"platform\":\"$NAME\",\"vnc_url\":\"http://$VPS_IP:$PORT/vnc.html\"}"
    elif echo "$PAGE_INFO" | grep -qi "login\|登录\|signin"; then
      echo "{\"status\":\"need_login\",\"platform\":\"$NAME\",\"vnc_url\":\"http://$VPS_IP:$PORT/vnc.html\"}"
    else
      echo "{\"status\":\"logged_in\",\"platform\":\"$NAME\"}"
    fi
    ;;
    
  stop)
    docker stop "$CONTAINER" 2>/dev/null >/dev/null
    echo "{\"status\":\"stopped\",\"platform\":\"$NAME\"}"
    ;;
    
  *)
    echo "{\"error\":\"Unknown action: start, check, stop\"}"
    ;;
esac
