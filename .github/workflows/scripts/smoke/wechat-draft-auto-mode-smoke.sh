#!/usr/bin/env bash
# wechat-draft-auto-mode-smoke.sh — mode:auto 无审批自动回复闭环 regression smoke
#
# Path 4（C1 修复 PR #817）：mode='auto' 下 generateChatDraft 决策层真正接进生产路径——
# 读 getAutoAgentConfig（总开关/营业时间/daily_limit）+ 查飞书白名单 → 按真值表分流：
#   名单外 → not_in_whitelist（不烧 LLM、不发）；监控态(OFF) → 不返回 reply；
#   名单内+ON+营业时间内+未超额 → 返回 reply（真发）。
# J4: auto + 陌生人 → not_in_whitelist；J5: review + 陌生人 → not_in_whitelist。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

echo "[1/2] mode:auto 真值表分流 + mode:review 白名单 + C1 接线 vitest"
( cd "$ROOT/apps/api" && npx vitest run \
    src/services/__tests__/wechat-draft-auto-reply.test.ts \
    src/services/__tests__/wechat-draft-auto-wiring.test.ts \
    src/services/wechat/__tests__/cs-route-decision.test.ts \
    --reporter=verbose )

echo "[2/3] 源码反守卫：auto 分支不得再整段跳白名单 search（旧 bug 守卫，复发即红）"
# 旧 bug 形态：'if (mode !== "auto") {' 把整段飞书白名单 search 包起来跳过。复发即红。
# 注意：精确匹配「条件后紧跟 {」的跳过守卫，不误伤 'mode !== "auto" && !inWhitelist'（review 拒绝判定）。
if grep -Eq "if \(mode !== 'auto'\) \{" "$ROOT/apps/api/src/services/wechat-draft.ts"; then
  echo "  FAIL: auto 分支又整段跳白名单 search 了（C1 bug 复发）"; exit 1
fi
# 正守卫：auto 分支必须读 getAutoAgentConfig + 调 decideReplyRoute 决策层
grep -q "getAutoAgentConfig" "$ROOT/apps/api/src/services/wechat-draft.ts"
grep -q "decideReplyRoute" "$ROOT/apps/api/src/services/wechat-draft.ts"
echo "  决策层已接线（getAutoAgentConfig + decideReplyRoute）OK"

echo "[3/3] 无审批自动回复闭环：三态 + 名单外 + 回执 + 播报"
# 路由三态 + 回执 + 播报决策直接打到 auto_reply.py 纯函数（环境无关）。
python3 - "$ROOT" <<'PY'
import sys
sys.path.insert(0, sys.argv[1] + "/services/agent/wechat-rpa")
import auto_reply as m

# 三态路由：auto / review(监控态) / pending_human(名单外)
assert m.decide_reply_route(True, True, True, 0, 0) == "auto", "名单内全绿应 auto"
assert m.decide_reply_route(True, True, False, 0, 0) == "review", "开关 OFF 应 review(监控态)"
assert m.decide_reply_route(False, True, True, 0, 0) == "pending_human", "名单外应 pending_human"

# 回执：成功 auto_sent / 失败 send_failed 不重发
assert m.build_receipt("auto", ok=True)["status"] == "auto_sent"
fail = m.build_receipt("auto", ok=False, reason="disconnected")
assert fail["status"] == "send_failed" and fail["retry"] is False

# 开关跳变播报：OFF->ON online / ON->OFF offline / 关键人未配 skip
assert m.broadcast_action(False, True, "ks_wx")["action"] == "online"
assert m.broadcast_action(True, False, "ks_wx")["action"] == "offline"
assert m.broadcast_action(False, True, "")["action"] == "skip"
print("  auto / review / pending_human / auto_sent / send_failed / broadcast OK")
PY

# DB 状态白名单守卫：迁移文件确实放开 auto_sent / pending_human / send_failed
grep -q "auto_sent" "$ROOT/apps/api/db/migrations/20260622_090000_wechat_publish_task_auto_reply_states.sql"
grep -q "pending_human" "$ROOT/apps/api/db/migrations/20260622_090000_wechat_publish_task_auto_reply_states.sql"
echo "  migration 放开 auto_sent / pending_human OK"

echo "PASS wechat-draft-auto-mode-smoke"
