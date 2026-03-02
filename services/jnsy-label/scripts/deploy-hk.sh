#!/bin/bash
# 部署到香港服务器
# 用法: ./scripts/deploy-hk.sh

set -e

echo "📦 Deploying JNSY-Label to HK server..."

# 1. 拉取最新代码
ssh hk "cd /opt/ai-trainer && git pull origin main"

# 2. 重启服务
ssh hk "cd /opt/ai-trainer && docker compose up -d --build"

# 3. 检查状态
ssh hk "docker ps | grep -E 'ai-trainer|label-studio'"

echo "✅ Deployment complete!"
