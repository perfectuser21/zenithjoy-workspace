#!/usr/bin/env bash
# smoke: Agent 版本号显示 — 验证 manifest API 返回版本信息
# Feature: AgentDownloadPage 展示 agent 版本 / 发布时间 / 包大小
set -euo pipefail

API_BASE="${API_BASE:-https://autopilot.zenjoymedia.media}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

echo "=== agent-version-display smoke ==="
echo "API: $API_BASE"

# 1. 公开 manifest 端点可访问
MANIFEST=$(curl -sf "${API_BASE}/api/agent/install-pack/manifest" \
  -H "Content-Type: application/json" \
  --max-time 15) || { echo "FAIL: manifest endpoint unreachable"; exit 1; }

echo "manifest response: $MANIFEST"

# 2. 包含 version 字段
VERSION=$(echo "$MANIFEST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['version'])" 2>/dev/null) \
  || { echo "FAIL: manifest missing version field"; exit 1; }
echo "version: $VERSION"

# 3. version 格式为 semver (e.g. 1.1.9)
echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "FAIL: version '$VERSION' not semver"; exit 1; }

# 4. 包含 cos_url 字段（下载链接）
COS_URL=$(echo "$MANIFEST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cos_url',''))" 2>/dev/null) || COS_URL=""
if [ -n "$COS_URL" ]; then
  echo "cos_url: $COS_URL"
  echo "$COS_URL" | grep -qE '^https://' || { echo "FAIL: cos_url not https"; exit 1; }
fi

echo "=== PASS: agent-version-display smoke ==="
