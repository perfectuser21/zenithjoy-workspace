#!/usr/bin/env bash
# Real current controller function in isolated zsh + fake ADB child processes.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
runner="$root/.github/workflows/scripts/smoke/helpers/media-extra-node-contracts.mjs"
test -f "$runner"
exec node "$runner" ime
