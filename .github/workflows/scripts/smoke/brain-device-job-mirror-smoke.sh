#!/usr/bin/env bash
# brain-device-job-mirror-smoke.sh —— 守 worker_task → Brain device_job 桥接（Task 8 阶段：先只守
# 领单器有没有把 JOB_ID 传给 wr start；Task 9 会把桥接纯函数/收尾/租约的另外几条命门补齐）。
set -uo pipefail
D="services/phone-adb-controller"
fail() { echo "::error::brain-device-job-mirror-smoke: $1"; exit 1; }

C="$D/device-job-claimer.sh"
grep -vE '^[[:space:]]*#' "$C" | grep -q 'wr start .*JOB_ID' \
  || fail "device-job-claimer 没把 Brain 的 JOB_ID 传给 wr start —— 每条真派单都会在 Brain 再镜像一条，页面重复计数"

echo "✅ brain-device-job-mirror-smoke 全部通过"
