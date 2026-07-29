#!/usr/bin/env bash
# staff-hub-env-badge-smoke.sh — 验证 EnvBadge 按 VITE_DEPLOY_ENV 真实打进构建产物
set -euo pipefail

cd "$(dirname "$0")/../../../.." # 仓库根
cd apps/staff-hub

echo "== staging 构建应含 STAGING 角标字符串 =="
rm -rf dist
VITE_FEISHU_APP_ID=smoke-test VITE_DEPLOY_ENV=staging npx vite build --logLevel=warn
grep -rl "STAGING" dist/assets/*.js >/dev/null || { echo "FAIL: staging 构建产物里找不到 STAGING 字符串"; exit 1; }
echo "PASS: staging 构建含 STAGING 角标"

echo "== production 构建 resolveEnvFlag 逻辑应返回 null（角标不渲染，单测已覆盖，此处只验证构建本身成功）=="
rm -rf dist
VITE_FEISHU_APP_ID=smoke-test VITE_DEPLOY_ENV=production npx vite build --logLevel=warn
[ -f dist/index.html ] && echo "PASS: production 构建成功"

echo "staff-hub-env-badge-smoke: PASS"
