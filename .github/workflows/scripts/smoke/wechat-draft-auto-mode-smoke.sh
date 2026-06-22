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

echo "[2/3] 源码白名单守卫 guard 已改为 mode !== 'auto' 条件"
grep -q "mode !== 'auto'" "$ROOT/apps/api/src/services/wechat-draft.ts"
echo "  guard present OK"

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
