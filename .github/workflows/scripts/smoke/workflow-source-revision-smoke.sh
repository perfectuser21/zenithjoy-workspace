#!/usr/bin/env bash
# line02/keyword_acquisition · preflight 回执来源；仅隔离夹具，无生产写入。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
command -v jq >/dev/null
command -v git >/dev/null
node --check services/phone-adb-controller/workflow-source.mjs
node --test services/phone-adb-controller/__tests__/workflow-source-revision.test.mjs
node --test .github/workflows/scripts/tests/phone-adb-deploy-fixture.test.mjs
