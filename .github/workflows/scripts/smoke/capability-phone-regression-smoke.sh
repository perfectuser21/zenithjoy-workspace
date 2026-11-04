#!/usr/bin/env bash
# phone 共享底座与保留的 SDK 历史兼容合同：本地动态回归。
# 真实生产脚本/函数 + 隔离临时目录/假设备与网络适配器；不产生真实业务执行证据。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
for tool in node zsh python3 jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "缺少回归依赖: $tool" >&2; exit 1; }
done
[[ -x /usr/bin/xmllint ]] || { echo '缺少回归依赖: /usr/bin/xmllint' >&2; exit 1; }
D="$ROOT/services/phone-adb-controller/__tests__"
# 每组至少包含真实动态断言；固定清单避免引入 phone-wall 旧环境测试。
TESTS=(
  "$D/real-contract-step-protocol.test.mjs"
  "$D/wf-run-retired.test.mjs"
  "$D/legacy-harvest-retirement.test.mjs"
  "$D/runtime-receipts.test.mjs"
  "$D/discover-keyword.test.mjs"
  "$D/discover-benchmark.test.mjs"
  "$D/benchmark-profile-discovery.test.mjs"
  "$D/harvest-keyword-judge-before-collect.test.mjs"
  "$D/harvest-keyword-profile-link-retry.test.mjs"
  "$D/harvest-keyword-lock-lifecycle.test.mjs"
  "$D/qualify-video.test.mjs"
  # Current queued-video consumers use this shared deadline/bounded-process library.
  # The retired batch2 delivery/scoring retry replay has no active execution entry.
  "$D/wf-limits.test.mjs"
  "$D/pipeline-v4-integration.test.mjs"
  "$D/outreach-tick-guard.test.mjs"
  "$D/next-outreach-guard-lib.test.mjs"
  "$D/phone-lock-lifecycle.test.mjs"
  "$D/phone-recovery.test.mjs"
  "$D/lease-heartbeat.test.mjs"
)
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
# 串行文件执行，心跳/预算的真实时序断言不与其它进程争用。
node --test --test-concurrency=1 --test-reporter=tap "${TESTS[@]}" | tee "$LOG"
if grep -Eq '^# skipped [1-9][0-9]*$|# SKIP' "$LOG"; then
  echo '动态回归存在跳过用例，不能声明完整通过' >&2
  exit 1
fi
echo 'PASS capability-phone-regression-smoke evidence_kind=regression_only business_execution=not_observed'
