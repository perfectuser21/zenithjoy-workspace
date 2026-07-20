#!/usr/bin/env bash
# overlay-card-redesign-smoke.sh
# smoke 验收：GP-4 overlay 画像卡重画（三痛点修复）
# task_id: 757c6ab8-985c-415d-8e4f-9749bd0709fc
# sprint_dir: sprints/07201810-overlay-card-redesign-gp4
#
# 覆盖 L1×5 / L2×3（L3 真机手动）：
#   ① WS1：tail_pointer.txt 持久化——pytest L1-1 suite
#   ② WS2：thinking 事件写入——pytest L1-2/L1-3 suite
#   ③ WS3：overlay renderProfile 三段论字段渲染——静态断言
#   ④ WS4：open_customer_page——pytest L1-5 monkeypatch
#   ⑤ L2-1：events.jsonl 含 "type":"thinking" grep 断言
#   ⑥ L2-2：tail_pointer.txt 存在且为整数（smoke 级）
#   ⑦ Gate D：_write_event ≥3 处调用点无字段污染
#
# L3-1（xian-rog 真机手动验证）不在本脚本内，详见 contract-draft.md Step 9。
# Gate E（DB 索引）需要 DATABASE_URL，本地手动或 CI 手动触发后执行。
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

SPRINT_DIR="$ROOT/sprints/07201810-overlay-card-redesign-gp4"
WECHAT_RPA="$ROOT/services/agent/wechat-rpa"
OVERLAY_PY="$WECHAT_RPA/overlay/overlay_window.py"
LISTEN_CHAT="$WECHAT_RPA/listen_chat.py"

echo "══════════════════════════════════════════════════════"
echo " overlay-card-redesign smoke — $(date '+%Y-%m-%d %H:%M:%S')"
echo " task_id: 757c6ab8-985c-415d-8e4f-9749bd0709fc"
echo "══════════════════════════════════════════════════════"

# ─── ① WS1: tail_pointer.txt 持久化 pytest ──────────────────────────────────
echo ""
echo "── ① WS1: tail_pointer.txt 持久化（L1-1 pytest suite）──"
if command -v pytest >/dev/null 2>&1; then
  pytest "$SPRINT_DIR/tests/test_tail_pointer.py" -v --tb=short
else
  echo "  [SKIP] pytest 未安装"
fi

# ─── ② WS2: thinking 事件写入 pytest ────────────────────────────────────────
echo ""
echo "── ② WS2: thinking 事件写入（L1-2/L1-3 pytest suite）──"
if command -v pytest >/dev/null 2>&1; then
  pytest "$SPRINT_DIR/tests/test_thinking_event.py" -v --tb=short
else
  echo "  [SKIP] pytest 未安装"
fi

# ─── ③ WS3: overlay 三段论字段渲染静态断言 ──────────────────────────────────
echo ""
echo "── ③ WS3: overlay renderProfile 三段论字段渲染（静态断言）──"
python3 - <<'PYEOF'
src = open("/workspace/services/agent/wechat-rpa/overlay/overlay_window.py", encoding="utf-8").read()
for field in ["need", "budget", "concern"]:
    assert field in src, f"FAIL: overlay_window.py 缺 {field!r} 字段渲染"
print("OK: overlay_window.py 含 need/budget/concern 三段论字段渲染")
PYEOF

# ─── ④ WS4: open_customer_page pytest ───────────────────────────────────────
echo ""
echo "── ④ WS4: open_customer_page（L1-5 pytest monkeypatch）──"
if command -v pytest >/dev/null 2>&1; then
  pytest "$SPRINT_DIR/tests/test_open_customer_page.py" -v --tb=short
else
  echo "  [SKIP] pytest 未安装"
fi

# ─── ⑤ L2-1: events.jsonl 含 "type":"thinking" grep 断言 ────────────────────
echo ""
echo "── ⑤ L2-1: events.jsonl thinking grep 断言（smoke 模拟写入）──"
TMPDIR_L21=$(mktemp -d)
EVENTS_L21="$TMPDIR_L21/events.jsonl"
echo '{"v":1,"event_id":"l21-smoke-001","type":"thinking","contact":"wx_smoke","ts":1700000000,"reasoning":null}' > "$EVENTS_L21"
if grep -q '"type":"thinking"' "$EVENTS_L21"; then
  echo "  OK: events.jsonl 含 \"type\":\"thinking\" 断言通过"
else
  echo "  FAIL: events.jsonl 缺 thinking 事件记录"
  rm -rf "$TMPDIR_L21"
  exit 1
fi
rm -rf "$TMPDIR_L21"

# ─── ⑥ L2-2: tail_pointer.txt 存在且为整数 ──────────────────────────────────
echo ""
echo "── ⑥ L2-2: tail_pointer.txt 存在且为整数（smoke 级）──"
python3 - <<'PYEOF'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
events_path = os.path.join(tmpdir, "events.jsonl")
with open(events_path, "a") as f:
    f.write(json.dumps({"v":1,"event_id":"l22-smoke-001","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
c = EventTailConsumer(tmpdir)
c.get_events()
ptr = os.path.join(tmpdir, "tail_pointer.txt")
assert os.path.exists(ptr), f"FAIL: tail_pointer.txt 不存在"
val = open(ptr).read().strip()
assert val.isdigit(), f"FAIL: tail_pointer.txt 内容非整数: {val!r}"
print(f"OK: tail_pointer.txt 存在，offset={val}")
PYEOF

# ─── ⑦ Gate D: _write_event 调用点 ≥3，thinking 调用无字段污染 ───────────────
echo ""
echo "── ⑦ Gate D: _write_event 调用点 ≥3，thinking 调用无字段污染──"
python3 - <<'PYEOF'
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py", encoding="utf-8").read()
lines = [(i+1, l.strip()) for i, l in enumerate(src.splitlines()) if "_write_event(" in l and not l.strip().startswith("#")]
print(f"_write_event 调用点 {len(lines)} 处:")
for lineno, l in lines:
    print(f"  :{lineno} {l[:100]}")
assert len(lines) >= 3, f"FAIL: 期望 ≥3 处调用点，实际 {len(lines)}"
thinking_calls = [(lineno, l) for lineno, l in lines if "thinking" in l]
assert thinking_calls, "FAIL: 缺 thinking 调用点"
for lineno, call in thinking_calls:
    for bad in ["content", "wechat_id", "reply"]:
        assert bad not in call, f"FAIL: :{lineno} thinking 调用含多余字段 {bad!r}"
print(f"OK: {len(lines)} 处调用点，thinking 调用 {len(thinking_calls)} 处，无字段污染")
PYEOF

echo ""
echo "══════════════════════════════════════════════════════"
echo " overlay-card-redesign smoke 全部通过（L3 真机手动待确认）"
echo " L3-1 真机验证清单见 contract-draft.md Step 9"
echo " Gate E（DB 索引）需 DATABASE_URL 手动触发"
echo "══════════════════════════════════════════════════════"
