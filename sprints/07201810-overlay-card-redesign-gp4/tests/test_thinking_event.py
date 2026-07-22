"""
TDD 红绿测试 — WS2: thinking 事件写入（Gate D，L1-2/L1-3）

对应合同断言：
  L1-2：thinking event 写入 events.jsonl 不含 PII 字段
  L1-3：_write_event 3 处调用点字段无污染

实现前预期状态：RED（listen_chat.py 无 _write_event("thinking") 调用点）
实现后预期状态：GREEN

运行方式：
  cd /workspace && python -m pytest sprints/07201810-overlay-card-redesign-gp4/tests/test_thinking_event.py -v
"""

import json
import os
import sys
import tempfile
import time

import pytest

# listen_chat.py 位于 services/agent/wechat-rpa/
LISTEN_CHAT_PATH = os.path.join(
    os.path.dirname(__file__),
    "../../../services/agent/wechat-rpa/listen_chat.py",
)


class TestThinkingEventStatic:
    """L1-3：静态断言——_write_event 调用点存在且无字段污染。"""

    def test_thinking_write_event_call_exists(self):
        """listen_chat.py 中必须存在 _write_event("thinking", ...) 调用点。"""
        src = open(LISTEN_CHAT_PATH, encoding="utf-8").read()
        has_call = (
            '_write_event("thinking"' in src
            or "_write_event('thinking'" in src
        )
        assert has_call, (
            "FAIL: listen_chat.py 缺 _write_event('thinking') 调用点。\n"
            "实现 FR-3（F3.1）：在 _gen_draft 函数内 post_draft_generate 调用前插入该调用。"
        )

    def test_write_event_call_sites_count_ge_3(self):
        """_write_event 调用点必须 ≥3 处（heartbeat + thinking + reply_sent）。"""
        src = open(LISTEN_CHAT_PATH, encoding="utf-8").read()
        call_lines = [
            (i + 1, line.strip())
            for i, line in enumerate(src.splitlines())
            if "_write_event(" in line and not line.strip().startswith("#")
        ]
        assert len(call_lines) >= 3, (
            f"FAIL: _write_event 调用点 {len(call_lines)} 处，期望 ≥3。\n"
            f"现有调用点: {call_lines}"
        )

    def test_thinking_call_has_no_pollution_fields(self):
        """thinking 调用点不含 content/reply/wechat_id 多余字段（Gate D，Inv-14）。"""
        src = open(LISTEN_CHAT_PATH, encoding="utf-8").read()
        thinking_calls = [
            (i + 1, line.strip())
            for i, line in enumerate(src.splitlines())
            if "_write_event(" in line
            and "thinking" in line
            and not line.strip().startswith("#")
        ]
        assert thinking_calls, "FAIL: 未找到 thinking 调用点"
        for lineno, call in thinking_calls:
            for bad_field in ["content", "wechat_id", "reply", "message="]:
                assert bad_field not in call, (
                    f"FAIL: :{lineno} thinking 调用含多余字段 {bad_field!r}: {call}"
                )

    def test_thinking_call_near_gen_draft_function(self):
        """thinking 写入点应在 _gen_draft 函数内部（:5700 区域，容差 50 行）。"""
        src = open(LISTEN_CHAT_PATH, encoding="utf-8").read()
        lines = src.splitlines()
        gen_draft_lineno = None
        thinking_lineno = None
        for i, line in enumerate(lines, 1):
            if "def _gen_draft" in line and gen_draft_lineno is None:
                gen_draft_lineno = i
            if (
                "_write_event(" in line
                and "thinking" in line
                and not line.strip().startswith("#")
                and thinking_lineno is None
            ):
                thinking_lineno = i

        assert gen_draft_lineno is not None, "FAIL: 未找到 _gen_draft 函数"
        assert thinking_lineno is not None, "FAIL: 未找到 thinking 写入点"
        distance = abs(thinking_lineno - gen_draft_lineno)
        assert distance <= 50, (
            f"FAIL: thinking 写入点(:{thinking_lineno}) 距 _gen_draft(:{gen_draft_lineno}) "
            f"{distance} 行，期望 ≤50 行"
        )


class TestThinkingEventRuntime:
    """L1-2：运行时断言——thinking 事件写入后不含 PII 字段。"""

    def test_thinking_event_written_to_jsonl(self, tmp_path):
        """_write_event("thinking") 调用后 events.jsonl 含 type=thinking 条目。"""
        old_state = os.environ.get("ZJ_STATE_DIR")
        try:
            os.environ["ZJ_STATE_DIR"] = str(tmp_path)
            events_path = tmp_path / "events.jsonl"

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/agent/wechat-rpa"))
            import importlib
            import listen_chat as lc

            lc._write_event("thinking", "wx_test_sender")

            assert events_path.exists(), "FAIL: events.jsonl 未被创建"
            events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
            thinking_events = [e for e in events if e.get("type") == "thinking"]
            assert thinking_events, "FAIL: 未写入 thinking 事件"
        finally:
            if old_state is None:
                os.environ.pop("ZJ_STATE_DIR", None)
            else:
                os.environ["ZJ_STATE_DIR"] = old_state

    def test_thinking_event_no_pii_fields(self, tmp_path):
        """thinking 事件不含 PII 字段（content/reply/wechat_id 为 None 或不存在）。"""
        old_state = os.environ.get("ZJ_STATE_DIR")
        try:
            os.environ["ZJ_STATE_DIR"] = str(tmp_path)
            events_path = tmp_path / "events.jsonl"

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/agent/wechat-rpa"))
            import listen_chat as lc

            lc._write_event("thinking", "wx_pii_test")

            events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
            thinking = [e for e in events if e.get("type") == "thinking"]
            assert thinking, "FAIL: 未写入 thinking 事件"

            ev = thinking[-1]
            pii_fields = ["content", "reply", "wechat_id"]
            for field in pii_fields:
                val = ev.get(field)
                assert val is None, f"FAIL: thinking 事件含 PII 字段 {field!r}={val!r}"
        finally:
            if old_state is None:
                os.environ.pop("ZJ_STATE_DIR", None)
            else:
                os.environ["ZJ_STATE_DIR"] = old_state

    def test_thinking_event_reasoning_is_none(self, tmp_path):
        """thinking 事件 reasoning 字段必须为 None（不包含推理内容，Inv-14）。"""
        old_state = os.environ.get("ZJ_STATE_DIR")
        try:
            os.environ["ZJ_STATE_DIR"] = str(tmp_path)
            events_path = tmp_path / "events.jsonl"

            sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/agent/wechat-rpa"))
            import listen_chat as lc

            lc._write_event("thinking", "wx_reasoning_test")

            events = [json.loads(line) for line in events_path.read_text().splitlines() if line.strip()]
            thinking = [e for e in events if e.get("type") == "thinking"]
            assert thinking, "FAIL: 未写入 thinking 事件"

            ev = thinking[-1]
            assert ev.get("reasoning") is None, (
                f"FAIL: thinking 事件 reasoning 非 None: {ev.get('reasoning')!r}\n"
                "FR-3（F3.3）要求 thinking type 时 reasoning 字段设为 None。"
            )
            assert ev.get("contact") == "wx_reasoning_test", (
                f"FAIL: contact 字段错误: {ev.get('contact')!r}"
            )
        finally:
            if old_state is None:
                os.environ.pop("ZJ_STATE_DIR", None)
            else:
                os.environ["ZJ_STATE_DIR"] = old_state
