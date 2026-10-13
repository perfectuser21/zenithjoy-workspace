#!/usr/bin/env bash
# 非手机报告的真实CLI边界回归，使用隔离目录和只读来源替身，不发生产请求。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --test services/phone-adb-controller/__tests__/commander-report.test.mjs
