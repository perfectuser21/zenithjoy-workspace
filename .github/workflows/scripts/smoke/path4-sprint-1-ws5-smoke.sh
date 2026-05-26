#!/usr/bin/env bash
# Path 4 Sprint 1 ws5 — 飞书审批轮询 + Python wechat_rpa 真发 + 频控 smoke
#
# 验证：
#   1) feishu-poll.ts 静态：含 30s 周期 + UPDATE approval_source='feishu_user' + dispatchTask
#   2) rate_limiter.py 真存在 + version + reset --wechat_id 命令可用
#   3) ~/.zenithjoy-agent/rate_limit.db 文件可创建
#   4) send_moment.py REAL_PUBLISH=0 dryrun → JSON {ok:true, dryRun:true}
#   5) send_chat.py REAL_PUBLISH=0 dryrun → JSON {ok:true, dryRun:true}
#   6) 朋友圈 24h 频控：第 2 条同号 → ok:false reason:rate_limited
#   7) 10 并发 can_send chat → True 数 ≤ 2（BEGIN IMMEDIATE 防竞争）
#   8) 主动发起会话 def 黑名单 0 命中
#   9) routes/wechat.ts /draft-review-poll 调 pollOnce
#  10) scheduler.ts 启动 startFeishuPoll
#
# 用法：bash path4-sprint-1-ws5-smoke.sh
# CI 模式（无凭据）：跑全部静态 + Python dryrun（无需飞书 token）
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

POLL_FILE=apps/api/src/services/feishu-poll.ts
SCHEDULER_FILE=apps/api/src/services/scheduler.ts
ROUTE_FILE=apps/api/src/routes/wechat.ts
RPA_DIR=services/agent/wechat-rpa

echo "=== ws5 Step 1: feishu-poll.ts 静态契约 ==="

[ -f "$POLL_FILE" ] || { echo "FAIL: $POLL_FILE 不存在"; exit 1; }

grep -qE "30[_]?000|30 \* 1000|cron.*\*\/30|interval.*30" "$POLL_FILE" \
  || { echo "FAIL: feishu-poll.ts 缺 30s 周期"; exit 1; }
echo "  PASS feishu-poll.ts 含 30s 周期"

grep -q "UPDATE.*wechat_publish_task" "$POLL_FILE" \
  || { echo "FAIL: feishu-poll.ts 缺 UPDATE wechat_publish_task"; exit 1; }
grep -q "feishu_user" "$POLL_FILE" \
  || { echo "FAIL: feishu-poll.ts 未写 approval_source='feishu_user'"; exit 1; }
echo "  PASS feishu-poll.ts UPDATE approval_source='feishu_user'"

grep -q "dispatchTask" "$POLL_FILE" \
  || { echo "FAIL: feishu-poll.ts 未调 dispatchTask"; exit 1; }
node -e "const s=require('fs').readFileSync('$POLL_FILE','utf8'); if(!s.includes('dispatchTask')||!s.includes('startFeishuPoll')) process.exit(1);" \
  || { echo "FAIL: node 读取 feishu-poll.ts 校验失败"; exit 1; }
echo "  PASS feishu-poll.ts 调 dispatchTask"

# 禁 system / auto
if grep -qE "approval_source.*['\"]system['\"]|approval_source.*['\"]auto['\"]" "$POLL_FILE"; then
  echo "FAIL: feishu-poll.ts 出现禁用 approval_source='system'/'auto'"
  exit 1
fi
echo "  PASS feishu-poll.ts 无 system/auto approval_source"

echo "=== ws5 Step 2: routes/wechat.ts 接 pollOnce ==="

grep -q "pollOnce" "$ROUTE_FILE" \
  || { echo "FAIL: routes/wechat.ts 未调 pollOnce"; exit 1; }
grep -q "/draft-review-poll" "$ROUTE_FILE" \
  || { echo "FAIL: routes/wechat.ts 缺 /draft-review-poll"; exit 1; }
echo "  PASS /draft-review-poll → pollOnce"

echo "=== ws5 Step 3: scheduler.ts 启动 startFeishuPoll ==="

grep -q "startFeishuPoll" "$SCHEDULER_FILE" \
  || { echo "FAIL: scheduler.ts 未调 startFeishuPoll"; exit 1; }
echo "  PASS scheduler.ts startFeishuPoll"

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
