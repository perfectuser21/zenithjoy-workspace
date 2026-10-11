#!/usr/bin/env bash
# 仅验证 Codex 发布索引与类型隔离；不连接平台、不登录、不执行发布。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
python3 -m unittest discover \
  -s "$REPO_ROOT/.agents/skills/multi-platform-publish/scripts" \
  -p 'test_*.py'
