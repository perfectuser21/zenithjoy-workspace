#!/usr/bin/env bash
# CRM异步回填合同回归；真实手机送达另以实屏及receipt验收。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
python3 -m unittest discover -s services/wechat-cs-android/tests
cd apps/api
npx --no-install vitest run src/services/wechat/__tests__/crm-analysis.test.ts
