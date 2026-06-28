#!/bin/bash
set -euo pipefail

# ZenithJoy Workspace 部署脚本
# 用法: ./deploy/deploy.sh hk

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TARGET=${1:-hk}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 配置
case $TARGET in
  hk)
    HOST="hk"  # SSH config 中的别名
    REMOTE_PATH="/opt/zenithjoy/autopilot-dashboard"
    SERVICE_NAME="autopilot-dashboard"
    SMOKE_URL="https://autopilot.zenjoymedia.media"
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

# git 安全检查：未提交
if ! git -C "$PROJECT_ROOT" diff --quiet || ! git -C "$PROJECT_ROOT" diff --cached --quiet; then
  echo -e "${RED}BLOCKED: 有未提交的改动${NC}"
  git -C "$PROJECT_ROOT" status --short
  exit 1
fi

# git 安全检查：未跟踪的源文件
UNTRACKED=$(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard -- apps/dashboard/src/ apps/dashboard/public/ | head -5)
if [ -n "$UNTRACKED" ]; then
  echo -e "${RED}BLOCKED: 有未跟踪的源文件${NC}"
  echo "$UNTRACKED"
  exit 1
fi

# git 安全检查：未 push
LOCAL_SHA=$(git -C "$PROJECT_ROOT" rev-parse HEAD)
REMOTE_SHA=$(git -C "$PROJECT_ROOT" rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "none")
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo -e "${RED}BLOCKED: 本地 $CURRENT_BRANCH 和远端不同步，请先 push${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Git 检查通过${NC} (branch: $CURRENT_BRANCH, sha: ${LOCAL_SHA:0:7})"

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

# 公网 smoke
echo ""
echo ">>> 公网 smoke..."
if curl -sf "$SMOKE_URL" --max-time 15 > /dev/null 2>&1; then
  echo -e "${GREEN}✅ 公网 smoke 通过: $SMOKE_URL${NC}"
else
  echo -e "${YELLOW}⚠️  公网 smoke 失败，检查 nginx/CDN: $SMOKE_URL${NC}"
fi
