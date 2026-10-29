#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root/apps/dashboard"
npx vitest run src/pages/__tests__/CreativeCanvasPage.test.tsx -t '可扩大画布并返回'
