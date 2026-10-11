#!/usr/bin/env bash
# 只读发布合同/schema/身份/执行隔离回归，不连接手机或平台。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
node --test scripts/product-map/__tests__/publishing-contracts.test.js
node scripts/product-map/cli.mjs check
