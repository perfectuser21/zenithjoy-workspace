#!/usr/bin/env bash
# Path 4 ws5 — 去飞书断言 + Python wechat_rpa 真发 + 频控 smoke
#
# 去飞书第一刀（2026-06-30）：飞书审批轮询（feishu-poll.ts / draft-review-poll / startFeishuPoll）
# 已彻底删除；ws5 Step 1-3 改为「确认已去飞书」的负向断言。Python wechat_rpa 真发 + 频控不变。
#
# 验证：
#   1) feishu-poll.ts 已删除（去飞书）
#   2) routes/wechat.ts 不再有 /draft-review-poll / pollOnce（去飞书）
#   3) scheduler.ts 不再 startFeishuPoll（去飞书）
#   4) rate_limiter.py 真存在 + version + reset --wechat_id 命令可用
#   5) send_moment.py / send_chat.py REAL_PUBLISH=0 dryrun → JSON {ok:true, dryRun:true}
#   6) 朋友圈 24h 频控：第 2 条同号 → ok:false reason:rate_limited
#   7) 10 并发 can_send chat → True 数 ≤ 2（BEGIN IMMEDIATE 防竞争）
#   8) 主动发起会话 def 黑名单 0 命中
#
# 用法：bash path4-sprint-1-ws5-smoke.sh
# CI 模式（无凭据）：跑全部静态 + Python dryrun（无需飞书 token）
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

POLL_FILE=apps/api/src/services/feishu-poll.ts
SCHEDULER_FILE=apps/api/src/services/scheduler.ts
ROUTE_FILE=apps/api/src/routes/wechat.ts
RPA_DIR=services/agent/wechat-rpa

echo "=== ws5 Step 1: feishu-poll.ts 已删除（去飞书）==="

[ ! -f "$POLL_FILE" ] || { echo "FAIL: $POLL_FILE 仍存在（去飞书应彻底删除 feishu-poll.ts）"; exit 1; }
echo "  PASS feishu-poll.ts 已删除"

echo "=== ws5 Step 2: routes/wechat.ts 不再有 /draft-review-poll / pollOnce（去飞书）==="

if grep -qE "/draft-review-poll|pollOnce" "$ROUTE_FILE"; then
  echo "FAIL: routes/wechat.ts 仍残留 /draft-review-poll / pollOnce（去飞书应移除）"; exit 1
fi
echo "  PASS routes/wechat.ts 无飞书审批轮询端点"

echo "=== ws5 Step 3: scheduler.ts 不再 startFeishuPoll（去飞书）==="

if grep -q "startFeishuPoll" "$SCHEDULER_FILE"; then
  echo "FAIL: scheduler.ts 仍残留 startFeishuPoll（去飞书应移除）"; exit 1
fi
echo "  PASS scheduler.ts 无 startFeishuPoll"

echo "=== ws5 Step 4: rate_limiter.py 真版 ==="

[ -f "$RPA_DIR/rate_limiter.py" ] || { echo "FAIL: rate_limiter.py 不存在"; exit 1; }
grep -q "BEGIN IMMEDIATE" "$RPA_DIR/rate_limiter.py" \
  || { echo "FAIL: rate_limiter.py 缺 BEGIN IMMEDIATE 事务"; exit 1; }

VERSION=$(python3 "$RPA_DIR/rate_limiter.py" version)
echo "  rate_limiter version: $VERSION"
echo "$VERSION" | grep -q "rate_limiter v1.0" \
  || { echo "FAIL: version 不匹配"; exit 1; }

# reset 创建 DB 文件
python3 "$RPA_DIR/rate_limiter.py" reset --wechat_id=smoke_test >/dev/null
[ -f ~/.zenithjoy-agent/rate_limit.db ] \
  || { echo "FAIL: rate_limit.db 文件未创建"; exit 1; }
echo "  PASS rate_limit.db 真持久化"

echo "=== ws5 Step 5: send_moment.py / send_chat.py REAL_PUBLISH=0 dryrun ==="

# moment dryrun
python3 "$RPA_DIR/rate_limiter.py" reset --wechat_id="smoke_group" >/dev/null
RESULT_MOMENT=$(echo '{"content":"smoke test","visible_group":"smoke_group"}' | \
  REAL_PUBLISH=0 python3 "$RPA_DIR/send_moment.py")
echo "  send_moment dryrun: $RESULT_MOMENT"
echo "$RESULT_MOMENT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL ok'
assert out.get('dryRun') is True, 'FAIL dryRun'
print('PASS')
"

# chat dryrun
python3 "$RPA_DIR/rate_limiter.py" reset --wechat_id="smoke_chat" >/dev/null
RESULT_CHAT=$(echo '{"target":"smoke","wechat_id":"smoke_chat","message":"hi"}' | \
  REAL_PUBLISH=0 python3 "$RPA_DIR/send_chat.py")
echo "  send_chat dryrun: $RESULT_CHAT"
echo "$RESULT_CHAT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, 'FAIL ok'
assert out.get('dryRun') is True, 'FAIL dryRun'
print('PASS')
"

echo "=== ws5 Step 6: 朋友圈 24h 频控（第 2 条拒）==="

python3 "$RPA_DIR/rate_limiter.py" reset --wechat_id="smoke_24h" >/dev/null
echo '{"content":"first","visible_group":"smoke_24h"}' | \
  REAL_PUBLISH=0 python3 "$RPA_DIR/send_moment.py" >/dev/null
sleep 2  # 跨过操作间隔 1s
RESULT_DUP=$(echo '{"content":"second","visible_group":"smoke_24h"}' | \
  REAL_PUBLISH=0 python3 "$RPA_DIR/send_moment.py")
echo "  第 2 条 send_moment: $RESULT_DUP"
echo "$RESULT_DUP" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is False, 'FAIL: 第 2 条应拒'
assert out.get('reason') == 'rate_limited', 'FAIL: reason'
assert out.get('next_allowed_at'), 'FAIL: 缺 next_allowed_at'
print('PASS: 朋友圈 24h 频控生效')
"

echo "=== ws5 Step 7: 10 并发 can_send chat（True 数 ≤ 2）==="

python3 "$RPA_DIR/rate_limiter.py" reset --wechat_id="smoke_concur" >/dev/null
TRUE_COUNT=$(python3 -c "
import sys
sys.path.insert(0, '$RPA_DIR')
from concurrent.futures import ThreadPoolExecutor
import rate_limiter
with ThreadPoolExecutor(max_workers=10) as e:
    results = list(e.map(lambda _: rate_limiter.can_send('chat', 'smoke_concur'), range(10)))
print(sum(1 for r in results if (r[0] if isinstance(r, tuple) else r) is True))
")
echo "  10 并发 True 数: $TRUE_COUNT"
[ "$TRUE_COUNT" -le "2" ] || { echo "FAIL: True 数 $TRUE_COUNT > 2"; exit 1; }
echo "  PASS BEGIN IMMEDIATE 防 race"

echo "=== ws5 Step 8: 主动发起会话 def 黑名单 ==="

set +o pipefail
FOUND_RAW=$(grep -rE "^[[:space:]]*def[[:space:]]+(send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" "$RPA_DIR/" 2>/dev/null || true)
set -o pipefail
FOUND=$(printf "%s" "$FOUND_RAW" | grep -c "^" 2>/dev/null || echo 0)
# 当 FOUND_RAW 为空时 grep -c "^" 返回 0
if [ -z "$FOUND_RAW" ]; then
  FOUND=0
fi
[ "$FOUND" = "0" ] || { echo "FAIL: 找到 $FOUND 个主动发起 def: $FOUND_RAW"; exit 1; }
echo "  PASS 主动发起 def 0 命中"

echo ""
echo "ws5-smoke: ALL PASS (静态 + 真 Python dryrun + 频控 + 并发)"
