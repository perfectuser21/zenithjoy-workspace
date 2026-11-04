#!/usr/bin/env bash
# Runs the real notification transport/receipt validator against isolated provider fixtures.
# No browser, message, screenshot or external API is invoked.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
node --test scripts/sessions/qr-notification.test.mjs
