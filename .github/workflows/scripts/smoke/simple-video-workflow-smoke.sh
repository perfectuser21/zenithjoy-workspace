#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
npm exec --workspace=apps/dashboard -- vitest run src/pages/__tests__/VideoWorkflowEntry.test.tsx
npm exec --workspace=apps/api -- vitest run src/routes/__tests__/video-projects.test.ts src/routes/__tests__/video-projects-lifecycle.test.ts src/services/__tests__/video-project-media.test.ts
