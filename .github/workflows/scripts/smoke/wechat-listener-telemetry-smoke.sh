#!/usr/bin/env bash
# wechat-listener-telemetry-smoke.sh — 微信客服监听诊断上报 + 中台监听健康看板冒烟。
#
# 验证客户机监听的"可观测性"链路：监听上报扫描诊断(diag) → 中台存储 → GET 暴露给看板。
# 让运营在中台一眼定位客户监听卡在哪，无需 SSH / 进客户桌面。可进 CI 的真实链路：
#   1) 中台心跳服务 diag 存取 + wechat 路由注册（含新增 GET /listener-heartbeat）
#   2) Agent 监听 python 脚本（scan_unread 解析 + 频控）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="$ROOT/apps/api"
AGENT="$ROOT/services/agent"

echo "[1/2] 中台心跳 diag 存取 + wechat 路由（含 GET /api/wechat/listener-heartbeat）"
( cd "$API" && npx vitest run \
  src/services/__tests__/wechat-heartbeat.test.ts \
  src/routes/__tests__/wechat.test.ts )

echo "[2/2] Agent 监听 python 脚本（scan_unread 解析 + 频控）"
python3 -m pytest "$AGENT/wechat-rpa/tests/" -q

echo "PASS wechat-listener-telemetry-smoke"
