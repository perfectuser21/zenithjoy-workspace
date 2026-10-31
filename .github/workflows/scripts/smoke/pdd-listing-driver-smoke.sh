#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node services/listing-workflow/listing-driver-cli.mjs --help
node --test services/listing-workflow/__tests__/listing-driver.test.mjs
node --test services/listing-workflow/__tests__/listing-driver-cli.test.mjs
node --test services/listing-workflow/__tests__/pdd-form.test.mjs
