#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
# Local contract smoke; real ffmpeg media tests run with the API integration suite.
npm exec --workspace=apps/dashboard -- vitest run src/pages/__tests__/VideoWorkflowEntry.test.tsx src/pages/__tests__/VideoWorkflowPage.test.tsx
npm exec --workspace=apps/api -- vitest run src/routes/__tests__/video-projects.test.ts src/services/__tests__/video-project-media.test.ts
