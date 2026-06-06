#!/usr/bin/env bash
# lint-wechat-rpa-runner.sh
# Regression guard: wechat-rpa E2E workflows must use [self-hosted, wechat-capable] runner.
# Prevents re-introduction of fake green CI (fixed in PR #661, 2026-06-06).
# windows-latest runner has no WeChat client → dryrun-print-version passes but real RPA never runs.

set -euo pipefail
FAIL=0

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Lint — WeChat RPA Runner Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. wechat-cs-e2e.yml: agent-windows job must NOT use windows-latest
WCEF=".github/workflows/wechat-cs-e2e.yml"
if [ ! -f "$WCEF" ]; then
  echo "❌ $WCEF not found"
  FAIL=1
else
  # Skip comment lines, find first real runs-on: inside agent-windows job
  JOB_RUNS_ON=$(awk '/^  agent-windows:/{found=1} found && /^[^#]*runs-on:/{print; exit}' "$WCEF")
  if echo "$JOB_RUNS_ON" | grep -q "windows-latest"; then
    echo "❌ $WCEF agent-windows job uses 'windows-latest' — must use [self-hosted, wechat-capable]"
    echo "   Found: $(echo "$JOB_RUNS_ON" | xargs)"
    echo "   windows-latest has no WeChat client → fake green CI."
    FAIL=1
  else
    echo "✅ $WCEF agent-windows: $(echo "$JOB_RUNS_ON" | xargs)"
  fi
fi

# 2. e2e-wechat-rpa.yml must exist and use [self-hosted, wechat-capable]
WCRPA=".github/workflows/e2e-wechat-rpa.yml"
if [ ! -f "$WCRPA" ]; then
  echo "❌ $WCRPA not found — Harness Evaluator cannot route windows_wechat sprints"
  FAIL=1
else
  # Skip comment lines (lines starting with optional spaces then #)
  RPA_RUNS_ON=$(awk '!/^[[:space:]]*#/ && /runs-on:/{print; exit}' "$WCRPA")
  if echo "$RPA_RUNS_ON" | grep -q "windows-latest"; then
    echo "❌ $WCRPA uses 'windows-latest' — must use [self-hosted, wechat-capable]"
    echo "   Found: $(echo "$RPA_RUNS_ON" | xargs)"
    FAIL=1
  elif echo "$RPA_RUNS_ON" | grep -q "wechat-capable"; then
    echo "✅ $WCRPA: $(echo "$RPA_RUNS_ON" | xargs)"
  else
    echo "❌ $WCRPA runs-on missing 'wechat-capable' label"
    echo "   Found: $(echo "$RPA_RUNS_ON" | xargs)"
    FAIL=1
  fi
fi

echo ""
if [ "$FAIL" = "1" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ WeChat RPA Runner Check FAILED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  wechat-rpa E2E workflows must use [self-hosted, wechat-capable] runner."
  echo "  windows-latest has no WeChat client → tests pass trivially = fake green CI."
  echo "  Reference: PR #661 (2026-06-06)"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ WeChat RPA Runner Check PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
