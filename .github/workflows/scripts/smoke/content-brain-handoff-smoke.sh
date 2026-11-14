#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT/apps/api"
npx --no-install vitest run src/controllers/__tests__/pipeline-brain-handoff.test.ts src/controllers/__tests__/pipeline-topic-intent.test.ts src/controllers/__tests__/pipelines-worker-fence.test.ts src/services/pipeline-brain-tasks.test.ts
cd "$ROOT"
node --test .github/workflows/scripts/__tests__/content-worker-e2e-contract.test.mjs
