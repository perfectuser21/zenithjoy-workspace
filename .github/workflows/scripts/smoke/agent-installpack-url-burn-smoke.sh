#!/usr/bin/env bash
# agent-installpack-url-burn-smoke.sh
# agent→staging 隔离：install-pack 下载按本 API 实例对外地址烧 agent 连接 URL。
#
# 验证链路（在 clean CI 的 local apps/api 上跑，由 smoke glob-runner 起 postgres + API）：
#   1. POST /api/auth/sign-up/email                注册（cookie 落 jar）
#   2. GET  /api/agent/install-pack/dotenv         带 cookie → 返回个人 .env 文本
#   3. 断言 .env 含 ZENITHJOY_LICENSE=ZJ-...        license 已烧入（下载链路本体）
#   4. 若本实例配了 AGENT_PUBLIC_WS_URL/AGENT_PUBLIC_BASE_URL（staging/生产 slot 会配）
#      → 断言 .env 同时含 ZENITHJOY_API_URL / ZENITHJOY_API_BASE（= 本实例对外地址）。
#      CI clean 环境通常不配这两个 env → 该段自动跳过（行为同旧、no-op，仍算过）。
#
# 退出码：
#   0  全过（含 AGENT_PUBLIC_* 未配时的 no-op 跳过）
#   1  Step 1 注册失败
#   2  Step 2 /dotenv 失败 / 无 license
#   3  Step 4 配了 AGENT_PUBLIC_* 但 .env 没烧对应 URL
#
# 依赖：API_BASE 默认 http://localhost:5200。
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
TS=$(date +%s)
EMAIL="installpack-urlburn-${TS}@zenithjoy.test"
PASSWORD="$(date +%s%N | sha256sum | head -c 12)Aa1"
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  agent install-pack URL-burn smoke (API_BASE=${API_BASE})"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "▶ [1/3] POST /api/auth/sign-up/email"
curl -fsS -c "$COOKIE_JAR" -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"URLBurn Smoke\"}" \
  "${API_BASE}/api/auth/sign-up/email" >/dev/null 2>/tmp/urlburn-step1.err || {
  echo "  FAIL: sign-up HTTP failed"; cat /tmp/urlburn-step1.err; exit 1; }
sleep 1
echo "  OK: registered ${EMAIL}"

echo "▶ [2/3] GET /api/agent/install-pack/dotenv（带 cookie）"
DOTENV=$(curl -fsS -b "$COOKIE_JAR" -X GET "${API_BASE}/api/agent/install-pack/dotenv" 2>/tmp/urlburn-step2.err) || {
  echo "  FAIL: /dotenv HTTP failed"; cat /tmp/urlburn-step2.err; exit 2; }
echo "$DOTENV" | grep -qE '^ZENITHJOY_LICENSE=ZJ-' || {
  echo "  FAIL: .env 未烧入 license"; echo "  body=$DOTENV"; exit 2; }
echo "  OK: .env 含 ZENITHJOY_LICENSE"

echo "▶ [3/3] AGENT_PUBLIC_* 配置时断言 .env 含本实例对外 URL + 环境标记"
if [ -n "${AGENT_PUBLIC_BASE_URL:-}" ]; then
  echo "$DOTENV" | grep -qF "ZENITHJOY_API_BASE=${AGENT_PUBLIC_BASE_URL}" || {
    echo "  FAIL: 配了 AGENT_PUBLIC_BASE_URL=${AGENT_PUBLIC_BASE_URL} 但 .env 没烧"; exit 3; }
  echo "  OK: .env 含 ZENITHJOY_API_BASE=${AGENT_PUBLIC_BASE_URL}"
  # 遗留② 根治：个人 .env 必须自带 staging/prod 环境标记（从本实例对外地址推导），
  # 否则 agent 回落到 COS 包 .env.template 的生产默认值 → "staging 下却连生产"。
  case "$AGENT_PUBLIC_BASE_URL" in
    *staging*) EXPECT_ENV="staging" ;;
    *)         EXPECT_ENV="prod" ;;
  esac
  echo "$DOTENV" | grep -qF "ZENITHJOY_ENV=${EXPECT_ENV}" || {
    echo "  FAIL: .env 未烧 ZENITHJOY_ENV=${EXPECT_ENV}（缺 staging 标记会回落生产）"; exit 3; }
  echo "  OK: .env 含 ZENITHJOY_ENV=${EXPECT_ENV}"
else
  echo "  SKIP: 本实例未配 AGENT_PUBLIC_*（CI clean 环境），URL/env-burn no-op（行为同旧）"
fi

echo "✅ agent install-pack URL-burn smoke 全过"
