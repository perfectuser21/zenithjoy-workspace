#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
# Native Comfy graph contract and the media services used behind its nodes.
node --experimental-vm-modules --test infrastructure/comfyui/tests/starter-workflows.test.mjs infrastructure/comfyui/tests/remake-extension.test.mjs infrastructure/comfyui/tests/video-project-extension.test.mjs
python3 -m unittest discover -s infrastructure/comfyui/tests -p test_native_video_workflow.py
npm exec --workspace=apps/dashboard -- vitest run src/pages/__tests__/VideoWorkflowEntry.test.tsx src/pages/__tests__/CreativeCanvasPage.test.tsx
npm exec --workspace=apps/api -- vitest run src/routes/__tests__/video-tools-project-instance.test.ts src/routes/__tests__/video-projects.test.ts src/routes/__tests__/video-projects-lifecycle.test.ts src/services/__tests__/video-project-media.test.ts
