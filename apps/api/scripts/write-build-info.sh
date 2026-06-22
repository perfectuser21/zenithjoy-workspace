#!/usr/bin/env bash
# write-build-info.sh — 把当前 git commit sha / package version / 构建时间写进 dist/build-info.json。
#
# 由 npm run build（postbuild）调用，让运行进程能通过 /version 报告"我跑的是哪个构建"。
# 治根：发版报成功但旧进程仍在跑 → 发版脚本断言 /version.sha == 刚部署 commit。
#
# 优先用 BUILD_SHA 环境变量（CI 注入最权威）；否则回退到 git rev-parse。
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${API_DIR}/dist"
OUT="${DIST_DIR}/build-info.json"

# sha: 优先环境变量，其次 git，最后 unknown
SHA="${BUILD_SHA:-}"
if [ -z "$SHA" ]; then
  SHA="$(git -C "$API_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
fi

# version: 优先环境变量，其次 package.json
VERSION="${BUILD_VERSION:-}"
if [ -z "$VERSION" ]; then
  VERSION="$(node -e "process.stdout.write(require('${API_DIR}/package.json').version||'unknown')" 2>/dev/null || echo unknown)"
fi

BUILD_TIME="${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

mkdir -p "$DIST_DIR"
cat > "$OUT" <<EOF
{
  "sha": "${SHA}",
  "version": "${VERSION}",
  "buildTime": "${BUILD_TIME}"
}
EOF

echo "✅ build-info written → ${OUT} (sha=${SHA} version=${VERSION})"
