#!/usr/bin/env bash
# Run the locked, schema-checked regression contract; preserve every failure.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-core-regression.mjs" "$@"
