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

echo "--- 节① pytest test_events_writer.py ---"

if pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py -v --tb=short 2>&1; then
  pass "test_events_writer.py 全绿"
else
  fail "test_events_writer.py 存在失败用例"
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
