#!/bin/bash
# 启动文件传输 HTTP 服务器

QUEUE_DIR="/home/xx/.toutiao-queue"
PORT=8899
PID_FILE="/tmp/toutiao-file-server.pid"

# 检查是否已经在运行
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "✅ HTTP 服务器已在运行"
    echo "   PID: $OLD_PID"
    echo "   端口: $PORT"
    echo "   目录: $QUEUE_DIR"
    echo ""
    echo "访问地址:"
    echo "  http://146.190.52.84:$PORT/"
    echo ""
    exit 0
  else
    rm "$PID_FILE"
  fi
fi

# 检查目录是否存在
if [ ! -d "$QUEUE_DIR" ]; then
  echo "❌ 队列目录不存在: $QUEUE_DIR"
  echo ""
  echo "创建目录："
  mkdir -p "$QUEUE_DIR"
  echo "  ✓ 已创建 $QUEUE_DIR"
  echo ""
fi

echo "========================================="
echo "启动文件传输服务器"
echo "========================================="
echo ""
echo "端口: $PORT"
echo "目录: $QUEUE_DIR"
echo ""

# 切换到队列目录
cd "$QUEUE_DIR" || exit 1

# 启动 Python HTTP 服务器
nohup python3 -m http.server $PORT > /tmp/toutiao-file-server.log 2>&1 &
PID=$!

# 保存 PID
echo "$PID" > "$PID_FILE"

# 等待服务器启动
sleep 2

# 验证服务器是否启动成功
if ps -p "$PID" > /dev/null 2>&1; then
  echo "✅ 服务器启动成功"
  echo ""
  echo "PID: $PID"
  echo "日志: /tmp/toutiao-file-server.log"
  echo ""
  echo "访问地址:"
  echo "  http://146.190.52.84:$PORT/"
  echo "  http://localhost:$PORT/"
  echo ""
  echo "停止服务器："
  echo "  kill $PID"
  echo "  或: pkill -f 'python3 -m http.server $PORT'"
  echo ""
  echo "========================================="
else
  echo "❌ 服务器启动失败"
  rm "$PID_FILE"
  exit 1
fi
