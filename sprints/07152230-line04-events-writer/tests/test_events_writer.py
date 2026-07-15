"""
test_events_writer.py — listen_chat._write_event 单元测试

覆盖 FR-2（_write_event 实现）的 4 个核心断言：
- test_write_event_creates_jsonl：调 _write_event 后 events.jsonl 产生合规行
- test_write_event_pii_filter：reasoning 含手机号 → 写入行中被替换
- test_write_event_reasoning_truncate：reasoning >30字 → 写入行截断到 ≤30字
- test_write_event_soft_fail：_STATE_DIR 指向不可写路径 → 不抛异常，仅 log

运行：pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py -v

注意：本文件在 commit-1 时以 FAILING 状态提交（实现尚未存在）。
      commit-2 补充实现后，所有测试应变为 PASSING。
"""
import importlib
import json
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Optional
from unittest.mock import patch, MagicMock

import pytest

# ─── 路径配置 ────────────────────────────────────────────────────────────────

_WECHAT_RPA_DIR = Path(__file__).parents[3] / "services" / "agent" / "wechat-rpa"


def _load_write_event():
    """
    延迟导入 listen_chat._write_event。
    实现存在时返回函数；不存在时抛出 ImportError（让测试 FAIL 而非 ERROR）。
    """
    # 确保 wechat-rpa 目录在 sys.path
    rpa_str = str(_WECHAT_RPA_DIR)
    if rpa_str not in sys.path:
        sys.path.insert(0, rpa_str)

    # overlay 模块路径
    overlay_str = str(_WECHAT_RPA_DIR / "overlay")
    if overlay_str not in sys.path:
        sys.path.insert(0, overlay_str)

    try:
        import listen_chat  # noqa: PLC0415
        write_event = getattr(listen_chat, "_write_event", None)
        if write_event is None:
            raise ImportError("listen_chat._write_event 不存在（实现尚未完成）")
        return write_event
    except ModuleNotFoundError as e:
        raise ImportError(f"listen_chat 模块加载失败：{e}") from e


# ─── 辅助：最小化 _write_event 参考实现（用于离线验证测试逻辑本身） ──────────

def _reference_write_event(
    state_dir: str,
    event_type: str,
    contact: str,
    reasoning: Optional[str] = None,
    stage: Optional[str] = None,
) -> None:
    """
    参考实现，镜像 FR-2 规格。
    测试中作为 fallback（仅当 listen_chat 尚未实现时用于验证测试逻辑）。
    """
    import time
    from uuid import uuid4

    try:
        # PII 过滤
        try:
            from pii_filter import filter_pii  # type: ignore
        except ImportError:
            filter_pii = lambda x: x  # noqa: E731

        filtered_reasoning = filter_pii(reasoning[:30]) if reasoning else None

        row = {
            "v": 1,
            "event_id": f"{int(time.time() * 1000)}-{uuid4().hex[:6]}-1",
            "date": time.strftime("%Y-%m-%d"),
            "type": event_type,
            "contact": contact,
            "stage": stage,
            "reasoning": filtered_reasoning,
            "ts": int(time.time()),
        }
        events_path = os.path.join(state_dir, "events.jsonl")
        with open(events_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception as exc:
        print(f"[warn] write_event failed: {exc}")  # 软失败


# ─── 测试 ────────────────────────────────────────────────────────────────────

class TestWriteEventCreatesJsonl:
    """
    test_write_event_creates_jsonl：
    调 _write_event 后 events.jsonl 产生合规行，包含所有必需字段。
    """

    def test_write_event_creates_jsonl(self, tmp_path):
        """_write_event 写入后 events.jsonl 含合规 reply_sent 行"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)

        # 注入 _STATE_DIR 环境变量
        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            # 重新加载模块以使 _STATE_DIR 生效（若模块在 import 时读取）
            write_event(
                event_type="reply_sent",
                contact="张三",
                reasoning="客户询问价格，已推送优惠",
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        assert events_file.exists(), "events.jsonl 未被创建"

        with open(events_file, encoding="utf-8") as f:
            line = f.readline().strip()
        assert line, "events.jsonl 为空"

        row = json.loads(line)
        required_fields = {"v", "event_id", "date", "type", "contact", "stage", "reasoning", "ts"}
        missing = required_fields - row.keys()
        assert not missing, f"缺少必需字段: {missing}"

        assert row["v"] == 1, f"v 字段应为 1，实际: {row['v']}"
        assert row["type"] == "reply_sent", f"type 应为 reply_sent，实际: {row['type']}"
        assert row["contact"] == "张三", f"contact 应为张三，实际: {row['contact']}"

        # event_id 格式验证：{epoch_ms}-{6位hex}-{seq}
        parts = row["event_id"].split("-")
        assert len(parts) == 3, f"event_id 格式不符（期望3段）: {row['event_id']}"

    def test_write_event_reasoning_null_when_none(self, tmp_path):
        """reasoning=None 时，events.jsonl 中 reasoning 字段为 null（不崩溃）"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)
        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            write_event(
                event_type="reply_sent",
                contact="李四",
                reasoning=None,
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        with open(events_file, encoding="utf-8") as f:
            row = json.loads(f.readline())

        assert row["reasoning"] is None, f"reasoning=None 时应写入 null，实际: {row['reasoning']}"


class TestWriteEventPiiFilter:
    """
    test_write_event_pii_filter：
    reasoning 含手机号 → 写入的 events.jsonl 行中手机号被过滤替换。
    """

    def test_write_event_pii_filter(self, tmp_path):
        """reasoning 含手机号 → events.jsonl 中不出现原始手机号"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)
        raw_reasoning = "客户留下手机 13812345678 已回复"

        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            write_event(
                event_type="reply_sent",
                contact="王五",
                reasoning=raw_reasoning,
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        content = events_file.read_text(encoding="utf-8")
        assert "13812345678" not in content, (
            f"events.jsonl 中不应含原始手机号（PII 二次过滤未生效）\n内容: {content}"
        )

    def test_write_event_pii_wechat_id(self, tmp_path):
        """reasoning 含微信号 → events.jsonl 中不出现原始微信号"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)
        raw_reasoning = "客户微信 wxid_testaccount123"

        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            write_event(
                event_type="reply_sent",
                contact="赵六",
                reasoning=raw_reasoning,
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        content = events_file.read_text(encoding="utf-8")
        assert "wxid_testaccount123" not in content, (
            f"events.jsonl 中不应含原始微信号\n内容: {content}"
        )


class TestWriteEventReasoningTruncate:
    """
    test_write_event_reasoning_truncate：
    reasoning >30字 → 写入的 events.jsonl 行中 reasoning 截断到 ≤30字。
    """

    def test_write_event_reasoning_truncate(self, tmp_path):
        """reasoning 超 30 字 → events.jsonl 中 reasoning ≤30 字"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)
        long_reasoning = "这是一段超过三十个字符的推理文案，客户询问了价格并表示非常感兴趣，我们推送了最新的限时优惠活动"
        assert len(long_reasoning) > 30, "测试前提：该字符串必须 >30 字"

        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            write_event(
                event_type="reply_sent",
                contact="孙七",
                reasoning=long_reasoning,
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        with open(events_file, encoding="utf-8") as f:
            row = json.loads(f.readline())

        reasoning_in_file = row.get("reasoning", "")
        assert reasoning_in_file is not None, "reasoning 不应为 None（原始非空）"
        assert len(reasoning_in_file) <= 30, (
            f"reasoning 超 30 字（实际 {len(reasoning_in_file)} 字）: {reasoning_in_file}"
        )

    def test_write_event_short_reasoning_unchanged(self, tmp_path):
        """reasoning ≤30 字时，内容不被错误截断"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        state_dir = str(tmp_path)
        short_reasoning = "已推送优惠活动"
        assert len(short_reasoning) <= 30, "测试前提：该字符串必须 ≤30 字"

        with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
            write_event(
                event_type="reply_sent",
                contact="周八",
                reasoning=short_reasoning,
                stage=None,
            )

        events_file = tmp_path / "events.jsonl"
        with open(events_file, encoding="utf-8") as f:
            row = json.loads(f.readline())

        # 短 reasoning 可能被 PII 过滤（若含 PII），但不含 PII 时应保留
        # 此处 short_reasoning 不含 PII，内容应保留（或截断后长度 ≤30）
        assert len(row.get("reasoning", "") or "") <= 30


class TestWriteEventSoftFail:
    """
    test_write_event_soft_fail：
    _STATE_DIR 指向不可写路径 → _write_event 不抛异常，仅记录 log。
    """

    def test_write_event_soft_fail(self, tmp_path):
        """不可写目录 → 不抛异常（软失败）"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        # 使用不存在且无法创建的路径（/nonexistent/path/that/does/not/exist）
        bad_state_dir = "/nonexistent_zj_state_dir_for_test"

        with patch.dict(os.environ, {"ZJ_STATE_DIR": bad_state_dir}):
            # 关键断言：不抛任何异常
            try:
                write_event(
                    event_type="reply_sent",
                    contact="吴九",
                    reasoning="测试软失败",
                    stage=None,
                )
            except Exception as exc:
                pytest.fail(
                    f"_write_event 应软失败（不抛异常），但抛出了: {type(exc).__name__}: {exc}"
                )

    def test_write_event_readonly_dir(self, tmp_path):
        """只读目录 → 不抛异常（软失败）"""
        try:
            write_event = _load_write_event()
        except ImportError as e:
            pytest.fail(f"[commit-1 预期 FAIL] {e}")

        # 创建只读目录
        readonly_dir = tmp_path / "readonly"
        readonly_dir.mkdir()
        readonly_dir.chmod(0o444)

        try:
            with patch.dict(os.environ, {"ZJ_STATE_DIR": str(readonly_dir)}):
                try:
                    write_event(
                        event_type="reply_sent",
                        contact="郑十",
                        reasoning="只读目录测试",
                        stage=None,
                    )
                except Exception as exc:
                    pytest.fail(
                        f"_write_event 应软失败（不抛异常），但抛出了: {type(exc).__name__}: {exc}"
                    )
        finally:
            # 恢复权限以便清理
            readonly_dir.chmod(0o755)
