#!/usr/bin/env bash
# 既有分车道准入已集中到公共入口；运行真实门禁行为测试，保留两次实跑和36小时要求。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
node --test "$ROOT/scripts/release-gate/__tests__/nightly-evidence.test.mjs"
