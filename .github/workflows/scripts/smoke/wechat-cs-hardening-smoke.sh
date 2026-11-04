#!/usr/bin/env bash
# Current Android CS required gate routing; no Windows listener / installer pins.
# Real router draft/receipt/config assertions execute in middleware-chain; the
# Android service suite executes in android-cs and the existing L3 Python job.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --test --test-name-pattern='^wechat:' .github/workflows/scripts/__tests__/adjacent-required-gates.test.mjs
