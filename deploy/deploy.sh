#!/bin/bash
set -e

# ZenithJoy Workspace 部署脚本
# 用法: ./deploy/deploy.sh hk

TARGET=${1:-hk}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 配置
case $TARGET in
  hk)
    HOST="hk"  # SSH config 中的别名
    REMOTE_PATH="/opt/zenithjoy/autopilot-dashboard"
    SERVICE_NAME="autopilot-dashboard"
    ;;
  *)
    echo "未知目标: $TARGET"
    echo "用法: $0 [hk]"
    exit 1
    ;;
esac

echo "========================================"
echo "部署 Autopilot Dashboard 到 $TARGET"
echo "========================================"

# 1. 检查是否在 main 分支
CURRENT_BRANCH=$(git -C "$PROJECT_ROOT" branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "警告: 当前在 $CURRENT_BRANCH 分支，不是 main"
  read -p "确定要继续吗? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 1
  fi
fi

# 2. 构建
echo ""
echo ">>> 构建 dashboard..."
cd "$PROJECT_ROOT/apps/dashboard"
npm run build

# 3. 备份远端
echo ""
echo ">>> 备份远端现有版本..."
BACKUP_NAME="${SERVICE_NAME}-$(date +%Y%m%d-%H%M%S)"
ssh $HOST "mkdir -p /opt/zenithjoy/.backups && \
  if [ -d $REMOTE_PATH ]; then \
    cp -r $REMOTE_PATH /opt/zenithjoy/.backups/$BACKUP_NAME; \
    echo '备份到: /opt/zenithjoy/.backups/$BACKUP_NAME'; \
  fi"

# 4. 同步文件
echo ""
echo ">>> 同步 dist 到 $HOST:$REMOTE_PATH..."
ssh $HOST "mkdir -p $REMOTE_PATH"
rsync -avz --delete \
  "$PROJECT_ROOT/apps/dashboard/dist/" \
  "$HOST:$REMOTE_PATH/dist/"

# 5. 同步 docker-compose (如果有)
if [ -f "$PROJECT_ROOT/deploy/docker-compose.hk.yml" ]; then
  echo ">>> 同步 docker-compose 配置..."
  rsync -avz \
    "$PROJECT_ROOT/deploy/docker-compose.hk.yml" \
    "$HOST:$REMOTE_PATH/docker-compose.yml"
fi

# 6. 重启服务
echo ""
echo ">>> 重启服务..."
ssh $HOST "cd $REMOTE_PATH && docker compose up -d --force-recreate 2>/dev/null || echo '无 docker-compose，跳过重启'"

# 7. 健康检查
echo ""
echo ">>> 健康检查..."
sleep 3
if ssh $HOST "curl -sf http://localhost:5211 > /dev/null 2>&1"; then
  echo "✅ 服务正常运行"
else
  echo "⚠️  健康检查失败，可能需要检查日志"
  echo "   ssh $HOST 'docker logs $SERVICE_NAME'"
fi

echo ""
echo "========================================"
echo "✅ 部署完成!"
echo "   目标: $HOST:$REMOTE_PATH"
echo "   备份: /opt/zenithjoy/.backups/$BACKUP_NAME"
echo "========================================"
