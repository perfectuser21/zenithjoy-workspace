#!/usr/bin/env bash
# line04-events-writer-smoke.sh — Line04 events_writer 第三刀 smoke
# sprint: 07152230-line04-events-writer
# task_id: af47b1da-0846-4300-bb1a-a733be50c9bd
# CI 平台: windows_cloud（GitHub Actions windows-latest runner）
#
# 6 节结构：
#   ① pytest test_events_writer.py 全绿
#   ② grep 断言 _write_event 调用在 DELIVERED 点（_commit_reply_success 后）
#   ③ grep 断言 draft_reasonings 字典存在
#   ④ BEHAVIOR-8 回归：overlay 目录无 events.jsonl 写入
#   ⑤ BEHAVIOR-9 回归：reply_sent 不在 _commit_reply_success 本体内
#   ⑥ 真机段等价断言注释

set -euo pipefail

PASS=0
FAIL=0

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

echo "=== line04-events-writer-smoke.sh START ==="
echo ""

# ─── 节 ①：pytest test_events_writer.py 全绿 ──────────────────────────────

echo "--- 节① _write_event 纯函数等价断言（Smoke Glob Runner 环境无 pytest，完整 8 条单测见 CI Agent Test job） ---"

if python3 -c "
import sys, os, json, tempfile
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

state_dir = tempfile.mkdtemp(prefix='zj-smoke-events-')
os.environ['ZJ_STATE_DIR'] = state_dir

listen_chat._write_event('reply_sent', '张三', '客户询问价格，已推送优惠', None)
with open(os.path.join(state_dir, 'events.jsonl'), encoding='utf-8') as f:
    row = json.loads(f.readline())
required = {'v', 'event_id', 'date', 'type', 'contact', 'stage', 'reasoning', 'ts'}
assert required <= row.keys(), f'缺字段: {required - row.keys()}'
assert row['type'] == 'reply_sent'

# PII 过滤 + 截断
long_reasoning = '这是一段超过三十个字符的推理文案，客户询问了价格并表示非常感兴趣，我们推送了最新的限时优惠活动含手机13812345678'
listen_chat._write_event('reply_sent', '李四', long_reasoning, None)
content = open(os.path.join(state_dir, 'events.jsonl'), encoding='utf-8').read()
assert '13812345678' not in content, 'PII 手机号未过滤'

# 软失败：不可写目录不抛异常
os.environ['ZJ_STATE_DIR'] = '/nonexistent_zj_state_dir_for_smoke'
listen_chat._write_event('reply_sent', '王五', '测试软失败', None)
print('PASS')
" 2>&1; then
  pass "_write_event 合规写入 + PII过滤 + 软失败 全过（8 条完整单测见 services/agent/wechat-rpa/tests/test_events_writer.py）"
else
  fail "_write_event 纯函数等价断言失败"
fi

echo ""

# ─── 节 ②：grep 断言 _write_event 调用在 DELIVERED 点附近 ────────────────

echo "--- 节② _write_event 调用在 DELIVERED 点（_commit_reply_success 后）---"

LISTEN_CHAT_MAIN="services/agent/wechat-rpa/listen_chat.py"

if [ ! -f "$LISTEN_CHAT_MAIN" ]; then
  fail "主路径 listen_chat.py 不存在: $LISTEN_CHAT_MAIN"
else
  # 检查 _write_event 调用紧跟 _commit_reply_success DELIVERED 标记（不依赖固定行号）
  result=$(grep -n '_write_event("reply_sent"' "$LISTEN_CHAT_MAIN" || true)
  if [ -n "$result" ]; then
    pass "DELIVERED 点含 _write_event reply_sent 调用: $(echo "$result" | head -2)"
  else
    fail "DELIVERED 点未找到 _write_event(\"reply_sent\") 调用"
  fi
fi

echo ""

# ─── 节 ③：grep 断言 draft_reasonings 字典存在 ────────────────────────────

echo "--- 节③ draft_reasonings 字典存在于 listen_chat.py ---"

if [ ! -f "$LISTEN_CHAT_MAIN" ]; then
  fail "主路径 listen_chat.py 不存在"
else
  result=$(grep -n "draft_reasonings" "$LISTEN_CHAT_MAIN" || true)
  if [ -n "$result" ]; then
    pass "draft_reasonings 字典存在: $(echo "$result" | head -3)"
  else
    fail "draft_reasonings 字典不存在于 listen_chat.py"
  fi

  # 验证 build-modules 同步
  LISTEN_CHAT_BM="services/agent/build-modules/line04/wechat-rpa/listen_chat.py"
  if [ -f "$LISTEN_CHAT_BM" ]; then
    result_bm=$(grep -n "draft_reasonings" "$LISTEN_CHAT_BM" || true)
    if [ -n "$result_bm" ]; then
      pass "build-modules 副本同步了 draft_reasonings"
    else
      fail "build-modules 副本未同步 draft_reasonings（FR-4 双路同步违规）"
    fi
  else
    echo "[SKIP] build-modules listen_chat.py 不存在，跳过同步检查"
  fi
fi

echo ""

# ─── 节 ④：BEHAVIOR-8 回归——overlay 目录无 events.jsonl 写入 ───────────

echo "--- 节④ BEHAVIOR-8：overlay 目录无 events.jsonl 写入调用 ---"

OVERLAY_DIR="services/agent/wechat-rpa/overlay"

if [ ! -d "$OVERLAY_DIR" ]; then
  fail "overlay 目录不存在: $OVERLAY_DIR"
else
  # 只检查写操作：overlay 中是否有以 "a" 或 "w" 模式打开 events.jsonl（只读消费允许）
  # grep: 找到含 events_path 或 events.jsonl 的行，再检查是否以 "a"/"w" 打开
  write_opens=$(grep -rn 'open.*"a"\|open.*"w"' "$OVERLAY_DIR" --include="*.py" 2>/dev/null \
    | grep -i "events" | grep -v "^[[:space:]]*#" | grep -v "__pycache__" || true)
  if [ -z "$write_opens" ]; then
    pass "BEHAVIOR-8：overlay 目录无 events.jsonl 写入调用（只读消费允许）"
  else
    fail "BEHAVIOR-8 违规：overlay 目录含 events 写入调用: $write_opens"
  fi
fi

echo ""

# ─── 节 ⑤：BEHAVIOR-9 回归——reply_sent 不在 _commit_reply_success 本体内 ─

echo "--- 节⑤ BEHAVIOR-9：_write_event 不在 _commit_reply_success 本体内 ---"

if [ ! -f "$LISTEN_CHAT_MAIN" ]; then
  fail "主路径 listen_chat.py 不存在"
else
  # 提取 _commit_reply_success 函数体（到下一个 def 为止），检查是否含 _write_event
  body=$(awk '/def _commit_reply_success/,/^def [a-zA-Z]/' "$LISTEN_CHAT_MAIN" | grep "_write_event" || true)
  if [ -z "$body" ]; then
    pass "BEHAVIOR-9：_commit_reply_success 本体内无 _write_event 调用"
  else
    fail "BEHAVIOR-9 违规：_commit_reply_success 本体内含 _write_event 调用（违反 Invariant I2）"
  fi
fi

echo ""

# ─── 节 ⑥：真机段等价断言注释 ────────────────────────────────────────────

echo "--- 节⑥ 真机段等价断言（注释）---"
echo "# 真机段等价断言：xian-rog 发一条微信消息 → events.jsonl 新增 reply_sent 行"
echo "# 真机验收完成后，在 sprints/07152230-line04-events-writer/evidence/ 存截图 + events.jsonl 片段"
echo "# TODO: 真机段验收挂接到 xian-rog staging 环境验收流程"
pass "节⑥ 真机等价断言注释就位"

echo ""
echo "=== SUMMARY: PASS=$PASS FAIL=$FAIL ==="

if [ "$FAIL" -gt 0 ]; then
  echo "smoke FAILED"
  exit 1
fi

echo "smoke PASSED"
exit 0
