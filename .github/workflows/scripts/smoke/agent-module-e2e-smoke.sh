#!/usr/bin/env bash
# agent-module-e2e-smoke.sh
# Agent 模块化架构 E2E smoke：心跳 modules 字段 + module-health 全字段 oracle
# 所有步骤均受 API_UP guard 控制，API 未启动时 SKIP 不报红。

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
TEST_LICENSE="${TEST_LICENSE:-test-lic}"

# API_UP guard: 检测 API 是否可访问
API_UP=0
curl -sf "$API_BASE/api/agent/health" > /dev/null 2>&1 && API_UP=1 || true

if [ "$API_UP" -eq 0 ]; then
  echo "SKIP: API 未启动（$API_BASE 不可达），跳过 smoke（CI windows-latest 无 API 服务）"
  exit 0
fi

echo "[smoke] API UP: $API_BASE"

# Step 1: heartbeat modules — 4 个 Line 均含 status + required_version
RESP=$(curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"license\":\"$TEST_LICENSE\",\"version\":\"1.0.0\",\"hostname\":\"ci-smoke\"}") || { echo "FAIL: heartbeat 非 200"; exit 1; }
echo "$RESP" | jq -e '.modules["line04-wechat-cs"].status == "active"' || { echo "FAIL: line04 status 非 active"; exit 1; }
echo "$RESP" | jq -e '.modules["line04-wechat-cs"].required_version | type == "string"' || { echo "FAIL: required_version 缺失"; exit 1; }
echo "$RESP" | jq -e '[.modules | keys] | flatten | length >= 4' || { echo "FAIL: modules 少于 4 个 Line"; exit 1; }
echo "[smoke] Step 1 OK: heartbeat modules 4 Lines"

# Step 5: module_status 上报 → module-health oracle
curl -sf -X POST "$API_BASE/api/agent/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"license\":\"$TEST_LICENSE\",\"version\":\"1.0.0\",\"hostname\":\"ci-smoke\",\"module_status\":{\"line04-wechat-cs\":{\"ok\":true}}}" \
  | jq -e '.ok == true' || { echo "FAIL: module_status 上报失败"; exit 1; }

HEALTH=$(curl -sf "$API_BASE/api/agent/module-health" \
  -H "Authorization: Bearer $TEST_LICENSE") || { echo "FAIL: module-health 非 200"; exit 1; }
echo "$HEALTH" | jq -e '.ok == true' || { echo "FAIL: module-health ok 非 true"; exit 1; }
echo "$HEALTH" | jq -e '.data | length >= 1' || { echo "FAIL: module-health data 为空"; exit 1; }
echo "$HEALTH" | jq -e '.data[0].agent_id | type == "string"' || { echo "FAIL: agent_id 非 string"; exit 1; }
echo "$HEALTH" | jq -e '.data[0].module_status["line04-wechat-cs"].ok == true' || { echo "FAIL: module_status 未持久化"; exit 1; }
echo "[smoke] Step 5 OK: module-health oracle passed"

echo "[smoke] ALL STEPS PASSED"
