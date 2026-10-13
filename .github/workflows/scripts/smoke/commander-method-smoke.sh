#!/usr/bin/env bash
# GP-Anchor: line01/android_worker_publish keep-green
# 固定Git对象、真实安装目录与子进程、显式HTTP替身；不访问生产设备/运行账。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node --test services/phone-adb-controller/__tests__/commander-method.test.mjs services/phone-adb-controller/__tests__/deployment-method.test.mjs
