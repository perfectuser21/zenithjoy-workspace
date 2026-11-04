#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# This suite exercises the current producer and delivery safety contracts with
# isolated boundaries. It does not operate a phone or prove actual delivery.
python3 - "$repo_root" <<'PY'
from pathlib import Path
import sys
import unittest

directory = Path(sys.argv[1]) / 'services/wechat-cs-android/tests'
suite = unittest.TestLoader().discover(str(directory))
if not suite.countTestCases():
    raise SystemExit('Android CS contract suite is empty')
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful() or result.skipped or result.expectedFailures:
    raise SystemExit('Android CS contracts failed or contain unverified cases')
print('PASS scope=offline_contracts device_delivery=not_verified')
PY
