#!/usr/bin/env bash
# wechat-draft-auto-mode-smoke.sh — mode:auto 跳过白名单全员回复 regression smoke
#
# Path 4: mode='auto' 下 generateChatDraft 不再查飞书"客户档案"名单，
# 所有私聊均可获得 DeepSeek 回复。
# J4: auto + 陌生人 → reply 正常返回；J5: review + 陌生人 → not_in_whitelist。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

echo "[1/2] mode:auto 全员回复 + mode:review 白名单 5-case vitest"
( cd "$ROOT" && npx vitest run apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts --reporter=verbose )

echo "[2/2] 源码白名单守卫 guard 已改为 mode !== 'auto' 条件"
grep -q "mode !== 'auto'" "$ROOT/apps/api/src/services/wechat-draft.ts"
echo "  guard present OK"

echo "PASS wechat-draft-auto-mode-smoke"
