#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --test services/listing-workflow/__tests__/*.test.mjs
