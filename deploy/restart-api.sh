#!/bin/bash
# restart-api.sh — 在 HK VPS 上重建并重启 zenithjoy-api 容器
# 用法：bash deploy/restart-api.sh [--pull]
#   --pull  先 git pull 拉最新代码再构建

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${1:-}" == "--pull" ]]; then
  echo "→ git pull..."
  git pull origin main
fi

echo "→ docker build zenithjoy-api:latest ..."
docker build -t zenithjoy-api:latest apps/api/

echo "→ docker compose up -d zenithjoy-api ..."
docker compose -f deploy/docker-compose.hk.yml up -d --no-deps zenithjoy-api

echo "→ 等待健康检查..."
for i in $(seq 1 20); do
  STATUS=$(docker inspect zenithjoy-api --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
  if [[ "$STATUS" == "healthy" ]]; then
    echo "✅ zenithjoy-api healthy"
    exit 0
  fi
  echo "   [$i/20] $STATUS ..."
  sleep 3
done
echo "⚠️  健康检查超时，查看日志：docker logs zenithjoy-api --tail 30"
exit 1
