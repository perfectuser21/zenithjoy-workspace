#!/usr/bin/env bash
# Bare CI smoke verifies the checker using local HTTP and real child processes.
# Deployment uses --probe: 0=unsigned rejection verified, 2=not verified, 1=failed.
# Neither mode creates an order, sends signed callbacks or verifies settlement.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  '') exec node --test "$SCRIPT_DIR/../__tests__/payment-public-check.test.mjs" ;;
  --probe) exec node "$SCRIPT_DIR/../payment-public-check.mjs" ;;
  *) echo 'Usage: payment-smoke.sh [--probe]' >&2; exit 1 ;;
esac
