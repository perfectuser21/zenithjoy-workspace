#!/usr/bin/env bash
# 无设备验收：真实进程、socket、冻结入口与原件读回；不是实机业务通过。
set -euo pipefail
TASK_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$TASK_REPO_ROOT"
node scripts/ci/implementation-skill-source.mjs --install-regression-skills "$TASK_REPO_ROOT"
node --test --test-concurrency=1 \
  services/phone-adb-controller/__tests__/agent-first-input.test.mjs \
  services/phone-adb-controller/__tests__/agent-first-runtime.test.mjs \
  services/phone-adb-controller/__tests__/agent-first-executor.test.mjs \
  services/phone-adb-controller/__tests__/agent-first-transport.test.mjs \
  services/phone-adb-controller/__tests__/activity-skill-primary-broker.test.mjs \
  services/phone-adb-controller/__tests__/leadgen-agent-tools.test.mjs \
  services/phone-adb-controller/__tests__/leadgen-agent-resource.test.mjs \
  services/phone-adb-controller/__tests__/leadgen-agent-artifacts.test.mjs \
  services/phone-adb-controller/__tests__/agent-native-comment-panel.test.mjs
echo 'agent-first-leadgen-smoke: PASS（无设备）'
