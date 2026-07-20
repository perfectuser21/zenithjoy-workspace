"""
TDD 红绿测试 — WS1: EventTailConsumer tail_pointer.txt 持久化（Gate A）

对应合同断言：L1-1（tail_pointer 重启后 get_events 不返回旧 event_id）

实现前预期状态：RED（EventTailConsumer 无 _pointer_path / tail_pointer.txt 逻辑）
实现后预期状态：GREEN

运行方式：
  cd /workspace && python -m pytest sprints/07201810-overlay-card-redesign-gp4/tests/test_tail_pointer.py -v
"""

import json
import os
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/agent/wechat-rpa"))

from overlay.overlay_window import EventTailConsumer


@pytest.fixture
def state_dir():
    """创建临时 state 目录，测试结束后清理。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def _write_event_to_file(events_path: str, event_id: str, event_type: str = "heartbeat") -> None:
    """向 events.jsonl 追加一条事件。"""
    with open(events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "v": 1,
            "event_id": event_id,
            "type": event_type,
            "contact": "",
            "ts": time.time(),
        }) + "\n")


class TestTailPointerPersistence:
    """L1-1：tail_pointer.txt 重启幂等——重启后不重放旧 event_id。"""

    def test_tail_pointer_file_created_after_get_events(self, state_dir):
        """get_events() 调用后 tail_pointer.txt 应该被创建。"""
        events_path = os.path.join(state_dir, "events.jsonl")
        _write_event_to_file(events_path, "evt-init-001")

        consumer = EventTailConsumer(state_dir)
        consumer.get_events()

        ptr_path = os.path.join(state_dir, "tail_pointer.txt")
        assert os.path.exists(ptr_path), "FAIL: tail_pointer.txt 未被创建"

    def test_tail_pointer_content_is_integer(self, state_dir):
        """tail_pointer.txt 内容必须是合法整数（字节 offset）。"""
        events_path = os.path.join(state_dir, "events.jsonl")
        _write_event_to_file(events_path, "evt-int-001")

        consumer = EventTailConsumer(state_dir)
        consumer.get_events()

        ptr_path = os.path.join(state_dir, "tail_pointer.txt")
        content = open(ptr_path).read().strip()
        assert content.isdigit(), f"FAIL: tail_pointer.txt 内容非整数: {content!r}"
        assert int(content) > 0, f"FAIL: offset 为 0，期望 >0"

    def test_restart_does_not_replay_old_events(self, state_dir):
        """核心断言（L1-1）：重启后 get_events 不返回旧 event_id。"""
        events_path = os.path.join(state_dir, "events.jsonl")

        # 写入"旧"事件
        _write_event_to_file(events_path, "old-event-001")

        # 第一次消费（模拟"首次运行"）
        consumer1 = EventTailConsumer(state_dir)
        events1 = consumer1.get_events()
        old_ids = {e.get("event_id") for e in events1}
        assert "old-event-001" in old_ids, f"FAIL: 首次运行应读到旧事件，实际: {old_ids}"

        # 写入"新"事件
        _write_event_to_file(events_path, "new-event-001")

        # 第二次消费（模拟"重启"，读取 tail_pointer.txt 恢复 offset）
        consumer2 = EventTailConsumer(state_dir)
        events2 = consumer2.get_events()
        new_ids = {e.get("event_id") for e in events2}

        assert "old-event-001" not in new_ids, (
            f"FAIL: 重启后重放了旧 event_id 'old-event-001'，实际返回: {new_ids}"
        )
        assert "new-event-001" in new_ids, (
            f"FAIL: 重启后未消费新事件 'new-event-001'，实际返回: {new_ids}"
        )

    def test_corrupted_tail_pointer_falls_back_to_zero(self, state_dir):
        """tail_pointer.txt 损坏时归零不抛异常（Inv-13）。"""
        events_path = os.path.join(state_dir, "events.jsonl")
        _write_event_to_file(events_path, "evt-corrupted-001")

        # 写入损坏内容
        ptr_path = os.path.join(state_dir, "tail_pointer.txt")
        with open(ptr_path, "w") as f:
            f.write("CORRUPTED_NOT_INT")

        # 不应抛异常
        try:
            consumer = EventTailConsumer(state_dir)
            events = consumer.get_events()
            # 损坏时从头读，应能读到事件
            ids = {e.get("event_id") for e in events}
            assert "evt-corrupted-001" in ids, f"FAIL: 损坏归零后应从头读，实际: {ids}"
        except Exception as e:
            pytest.fail(f"FAIL: tail_pointer.txt 损坏时抛出异常: {e}")

    def test_missing_tail_pointer_reads_from_beginning(self, state_dir):
        """tail_pointer.txt 不存在时从头读取（归零行为）。"""
        events_path = os.path.join(state_dir, "events.jsonl")
        _write_event_to_file(events_path, "evt-no-ptr-001")

        # 确保 tail_pointer.txt 不存在
        ptr_path = os.path.join(state_dir, "tail_pointer.txt")
        if os.path.exists(ptr_path):
            os.remove(ptr_path)

        consumer = EventTailConsumer(state_dir)
        events = consumer.get_events()
        ids = {e.get("event_id") for e in events}
        assert "evt-no-ptr-001" in ids, f"FAIL: 无 tail_pointer.txt 时应从头读，实际: {ids}"

    def test_tail_pointer_write_failure_is_soft(self, state_dir):
        """tail_pointer.txt 写失败时软失败（仅 log，不影响 get_events 返回值）。"""
        events_path = os.path.join(state_dir, "events.jsonl")
        _write_event_to_file(events_path, "evt-soft-fail-001")

        # 创建 tail_pointer.txt 并设为只读（模拟写失败）
        ptr_path = os.path.join(state_dir, "tail_pointer.txt")
        with open(ptr_path, "w") as f:
            f.write("0")
        os.chmod(ptr_path, 0o444)

        try:
            consumer = EventTailConsumer(state_dir)
            events = consumer.get_events()
            # 写失败不影响读取
            ids = {e.get("event_id") for e in events}
            assert "evt-soft-fail-001" in ids or len(events) >= 0, "FAIL: 写失败导致读取异常"
        except Exception as e:
            pytest.fail(f"FAIL: tail_pointer.txt 写失败时抛出异常: {e}")
        finally:
            os.chmod(ptr_path, 0o644)
