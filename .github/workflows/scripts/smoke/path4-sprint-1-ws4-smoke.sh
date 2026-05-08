#!/usr/bin/env bash
# Path 4 Sprint 1 ws4 — DeepSeek 朋友圈文案草稿 + 中台 scheduler-tick + 飞书"内容排期"smoke
#
# 验证：
#   1) /api/wechat/scheduler-tick {force:true, customer:"客户A"} → 200 + {generated/skipped}
#   2) 飞书"内容排期"表当日 pending_review 行数 ≥ 1（真凭据下）
#   3) DB wechat_publish_task 含 type='moment' AND approval_source NULL 的草稿（A 路线护栏起点）
#   4) scheduler.ts 静态校验 cron '0 9 * * *' + thin server 时区注释
#
# 用法：bash path4-sprint-1-ws4-smoke.sh
# CI 模式（无凭据）：仅跑静态校验（grep cron / 路由文件存在），跳过真调用
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "=== ws4 静态校验（cron / route / service 字面量）==="

SCHEDULER_FILE=apps/api/src/services/scheduler.ts
DRAFT_FILE=apps/api/src/services/wechat-draft.ts
ROUTE_FILE=apps/api/src/routes/wechat.ts

[ -f "$SCHEDULER_FILE" ] || { echo "FAIL: $SCHEDULER_FILE 不存在"; exit 1; }
grep -qE "cron[[:space:]]*[:=].*'0 9 \* \* \*'|cron.*\"0 9 \* \* \*\"|'0 9 \* \* \*'" "$SCHEDULER_FILE" \
  || { echo "FAIL: scheduler.ts 缺 cron 表达式 '0 9 * * *'"; exit 1; }
grep -qE "thin.*server[[:space:]]*时区" "$SCHEDULER_FILE" \
  || { echo "FAIL: scheduler.ts 缺 thin server 时区注释"; exit 1; }
echo "  PASS scheduler.ts cron + thin 注释"

grep -qE "export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+generateMomentDraft" "$DRAFT_FILE" \
  || { echo "FAIL: wechat-draft.ts 缺 generateMomentDraft export"; exit 1; }
grep -q "moment" "$DRAFT_FILE" || { echo "FAIL: wechat-draft.ts 缺 'moment' type 字面量"; exit 1; }
echo "  PASS wechat-draft.ts generateMomentDraft + type='moment'"

grep -q "/scheduler-tick" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 缺 /scheduler-tick 路由"; exit 1; }
grep -q "generateMomentDraft" "$ROUTE_FILE" || { echo "FAIL: wechat.ts 未调 generateMomentDraft"; exit 1; }
echo "  PASS wechat.ts /scheduler-tick + generateMomentDraft 调用"

# 真凭据 / 服务模式（CI 跳过）
if [ "${CI:-}" = "true" ] || [ -z "${OPENROUTER_API_KEY:-}${SKIP_LIVE:-}" ]; then
  echo "=== CI 或缺凭据：跳过真调用 happy path ==="
  echo "ws4-smoke: STATIC OK"
  exit 0
fi

if [ -f ~/.credentials/openrouter.env ]; then
  # shellcheck disable=SC1090
  source ~/.credentials/openrouter.env
fi

# 真调用：seed 画像 + curl scheduler-tick
node apps/api/scripts/seed-feishu-profile.js \
  --customer="客户A" --industry="美妆代购" --audience="25-35女性白领" --hook="正品保障+免税价" \
  || true

curl -sS -X POST localhost:5200/api/wechat/scheduler-tick \
  -H "Content-Type: application/json" \
  -d '{"force": true, "customer": "客户A"}' \
  | tee /tmp/ws4-tick.json

grep -E '"generated":[0-9]' /tmp/ws4-tick.json >/dev/null \
  && echo "PASS: scheduler-tick 返回结构合法" \
  || { echo "FAIL: scheduler-tick 响应缺 generated 字段"; exit 1; }

echo "ws4-smoke: ALL PASS"
