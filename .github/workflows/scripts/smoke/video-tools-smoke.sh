#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$repo_root/apps/api"
npx vitest run src/routes/__tests__/video-tools.test.ts src/routes/__tests__/video-tools-direct-upload.test.ts src/services/__tests__/ali-video-provider.test.ts
cd "$repo_root/apps/dashboard"
npx vitest run src/pages/__tests__/VideoToolsPage.test.tsx src/config/__tests__/navigation.config.test.ts
