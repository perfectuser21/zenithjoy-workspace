#!/bin/bash
# deploy-hk.sh — 部署 Autopilot Dashboard 到香港 VPS
# 安全检查：必须通过 git 流程才能部署

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$REPO_ROOT/apps/dashboard"
HK_DEST="hk:/opt/zenithjoy/autopilot-dashboard/dist/"

echo "========================================="
echo "  Autopilot Dashboard → 香港 VPS 部署"
echo "========================================="

cd "$REPO_ROOT"

# ── 检查 1: 不能有未提交的改动 ──
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo -e "${RED}BLOCKED: 有未提交的改动${NC}"
  echo "请先 commit 并 push 到 GitHub"
  git status --short
  exit 1
fi

# 未跟踪的文件也检查（排除 dist/ 和 node_modules/）
UNTRACKED=$(git ls-files --others --exclude-standard -- apps/dashboard/src/ apps/dashboard/public/ | head -5)
if [ -n "$UNTRACKED" ]; then
  echo -e "${RED}BLOCKED: 有未跟踪的源文件${NC}"
  echo "$UNTRACKED"
  exit 1
fi

# ── 检查 2: 必须已 push 到远端 ──
BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "none")

if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo -e "${RED}BLOCKED: 本地 $BRANCH 和远端不同步${NC}"
  echo "本地: $LOCAL_SHA"
  echo "远端: $REMOTE_SHA"
  echo "请先 push 到 GitHub"
  exit 1
fi

# ── 检查 3: 必须在 main 或 develop 上（已合并的代码才能部署） ──
if [ "$BRANCH" != "main" ] && [ "$BRANCH" != "develop" ]; then
  echo -e "${YELLOW}WARNING: 当前在 $BRANCH 分支，通常只从 main/develop 部署${NC}"
  read -p "确认继续？(y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo -e "${GREEN}✓ Git 检查通过${NC} (branch: $BRANCH, sha: ${LOCAL_SHA:0:7})"

# ── 构建 ──
echo ""
echo "→ Building..."
cd "$APP_DIR"
npx vite build

# ── 部署 ──
echo ""
echo "→ Rsync to HK..."
rsync -avz --delete dist/ "$HK_DEST"

echo ""
echo -e "${GREEN}✓ 部署完成${NC}"
echo "  分支: $BRANCH"
echo "  SHA:  ${LOCAL_SHA:0:7}"
echo "  URL:  https://autopilot.zenjoymedia.media"
