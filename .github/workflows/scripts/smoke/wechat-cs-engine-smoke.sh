#!/usr/bin/env bash
# wechat-cs-engine-smoke.sh — Path 4 Step 3 微信客服回复引擎 Sprint A 冒烟。
#
# 验三件事（用户三诉求）：①风格净化（剥 <think>+禁用客服腔）②三层客户记忆（短/中/长，跨轮记得住）
# ③回复带人设个性。可进 CI 的真实链路：
#   1) 纯函数单测：人设 persona / 企业知识库 business-kb / 上下文装配 context-assembler
#   2) contact-memory 单测（mock pool，三层读写 + 固化逻辑）
#   3) 端到端 mock 集成（真 Postgres + mock 飞书/OpenRouter，跨轮长期记忆 + 净化 + 三口井落库）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="$ROOT/apps/api"

echo "[1/3] 纯函数单测：persona + business-kb + context-assembler"
( cd "$API" && npx vitest run \
  src/services/wechat/__tests__/persona.test.ts \
  src/services/wechat/__tests__/business-kb.test.ts \
  src/services/wechat/__tests__/context-assembler.test.ts )

echo "[2/3] contact-memory 三层记忆单测（mock pool）"
( cd "$API" && npx vitest run src/services/wechat/__tests__/contact-memory.test.ts )

echo "[3/3] 端到端 mock 集成（真 DB + mock 飞书/OpenRouter）"
( cd "$API" && npx vitest run --config vitest.integration.config.ts \
  tests/integration/p4-wechat-cs-engine/wechat-cs-engine.integration.test.ts )

echo "PASS wechat-cs-engine-smoke"
