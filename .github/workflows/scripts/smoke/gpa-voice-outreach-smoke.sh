#!/usr/bin/env bash
# User retained prototype: these tests exercise code, not delivered outreach.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$root"
python3 - <<'PY'
import unittest
suite = unittest.defaultTestLoader.discover('services/agent/wechat-rpa/voice_call/tests', pattern='test_call_rpa.py')
if suite.countTestCases() == 0:
    raise SystemExit('Voice implementation contracts are empty')
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful() or result.skipped or result.expectedFailures:
    raise SystemExit(1)
PY
node .github/workflows/scripts/smoke/helpers/business-contracts.mjs voice
printf '%s\n' 'LOCAL_CODE_CONTRACTS_ONLY: retained prototype; product route not mounted and dispatcher not connected'
