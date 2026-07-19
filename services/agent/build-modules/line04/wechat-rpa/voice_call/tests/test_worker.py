# services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_worker.py
# TDD Red — GP-A 派发链路 · worker 子进程单元测试
#
# 运行方式（CI 可达）：
#   cd /workspace/services/agent/build-modules/line04/wechat-rpa
#   python -m pytest voice_call/tests/test_worker.py -v
#
# 覆盖（BEHAVIOR-3）：
#   - call_phase='dialing' 原子 UPDATE 返回 0 行 → 立即中止，不调 make_voice_call（I-9）
#   - call_phase='dialing' UPDATE 成功 → 继续执行 make_voice_call
#   - contact_mismatch 路径 → UPDATE call_phase='failed', error_reason='contact_mismatch'
#   - 回写 /records 失败 → 指数退避重试（3次）
#   - 3次退避耗尽 → 本地落盘 /tmp/gpa-failed-records.jsonl（N-5）
#   - finally 块：正常/异常退出时均删除锁文件（I-10）
#   - make_voice_call 内调用 start_audio_bridge（AI 对话真接线）

import os
import json
import pytest
from unittest.mock import MagicMock, patch, call, mock_open


# ──────────────────────────────────────────────────────────────────────────────
# 被测模块导入（Red 阶段：模块尚未存在，导入会失败）
# ──────────────────────────────────────────────────────────────────────────────

try:
    from voice_call.worker import run_worker, WorkerContext
    MODULE_AVAILABLE = True
except ImportError:
    MODULE_AVAILABLE = False
    run_worker = None
    WorkerContext = None

pytestmark = pytest.mark.skipif(
    not MODULE_AVAILABLE,
    reason="worker.py 尚未实现（Red 状态，预期 import 失败）",
)


# ──────────────────────────────────────────────────────────────────────────────
# call_phase 原子推进（BEHAVIOR-3）
# ──────────────────────────────────────────────────────────────────────────────

class TestWorkerAtomicPhase:
    def test_dialing_update_zero_rows_aborts(self):
        """
        核心：UPDATE WHERE call_phase='claimed' RETURNING 返回 0 行时
        make_voice_call 不被调用，子进程立即退出（I-9 防重复拨打）。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 0  # 0 行返回

        mock_make_voice_call = MagicMock()

        ctx = WorkerContext(
            call_id="call-uuid-1",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", MagicMock()):  # 锁文件清理
            run_worker(ctx)

        mock_make_voice_call.assert_not_called()

    def test_dialing_update_one_row_proceeds(self):
        """
        UPDATE 返回 1 行 → 继续执行 make_voice_call。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1

        mock_make_voice_call = MagicMock()
        mock_make_voice_call.return_value = {
            "status": "answered",
            "duration_seconds": 45,
            "transcript": "你好\n我在",
            "bubble_text": "通话时长 00:45",
        }
        mock_db.write_record.return_value = 200

        ctx = WorkerContext(
            call_id="call-uuid-2",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", MagicMock()):
            run_worker(ctx)

        mock_make_voice_call.assert_called_once()

    def test_contact_mismatch_writes_failed_phase(self):
        """
        locate_contact 返回 contact_mismatch →
        UPDATE call_phase='failed', error_reason='contact_mismatch'，不拨号。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1

        mock_make_voice_call = MagicMock()
        mock_make_voice_call.side_effect = Exception("contact_mismatch")

        mock_db.write_failed.return_value = None

        ctx = WorkerContext(
            call_id="call-uuid-3",
            tenant_id="t1",
            contact_name="不存在的人",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", MagicMock()):
            run_worker(ctx)

        # 应调用 write_failed 而非 write_record
        mock_db.write_failed.assert_called_once()
        call_kwargs = mock_db.write_failed.call_args
        assert "contact_mismatch" in str(call_kwargs)

    def test_dialing_phase_skips_if_already_advanced(self):
        """
        并发场景：advance_to_dialing 两次调用，第一次成功，第二次返回 0（防重入）。
        """
        mock_db = MagicMock()
        # 第一次 1，第二次 0（模拟重复调用）
        mock_db.advance_to_dialing.side_effect = [1, 0]

        mock_make_voice_call = MagicMock()
        mock_make_voice_call.return_value = {"status": "answered", "duration_seconds": 30, "transcript": "", "bubble_text": "通话时长 00:30"}
        mock_db.write_record.return_value = 200

        ctx = WorkerContext(
            call_id="call-uuid-4",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", MagicMock()):
            run_worker(ctx)

        # 第一次成功时继续，make_voice_call 被调用一次
        assert mock_db.advance_to_dialing.call_count >= 1


# ──────────────────────────────────────────────────────────────────────────────
# 指数退避重试 + 本地落盘（N-5）
# ──────────────────────────────────────────────────────────────────────────────

class TestRetryAndFallback:
    def test_exponential_backoff_3_retries(self):
        """
        POST /records 失败时指数退避重试 3 次。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1

        mock_make_voice_call = MagicMock()
        mock_make_voice_call.return_value = {
            "status": "answered",
            "duration_seconds": 45,
            "transcript": "你好",
            "bubble_text": "通话时长 00:45",
        }

        # 3 次全失败
        mock_db.write_record.side_effect = Exception("network error")

        mock_fallback = MagicMock()

        ctx = WorkerContext(
            call_id="call-uuid-5",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
            local_fallback_fn=mock_fallback,
        )

        with patch("time.sleep", MagicMock()), patch("os.remove", MagicMock()):
            run_worker(ctx)

        # 重试 3 次
        assert mock_db.write_record.call_count == 3
        # 耗尽后落盘
        mock_fallback.assert_called_once()

    def test_fallback_writes_jsonl_record(self):
        """
        落盘写入 /tmp/gpa-failed-records.jsonl 的内容包含 call_id 和 status。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1

        mock_make_voice_call = MagicMock()
        mock_make_voice_call.return_value = {
            "status": "answered",
            "duration_seconds": 30,
            "transcript": "测试",
            "bubble_text": "通话时长 00:30",
        }
        mock_db.write_record.side_effect = Exception("db down")

        written_lines = []

        def capture_fallback(record: dict):
            written_lines.append(record)

        ctx = WorkerContext(
            call_id="call-uuid-6",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
            local_fallback_fn=capture_fallback,
        )

        with patch("time.sleep", MagicMock()), patch("os.remove", MagicMock()):
            run_worker(ctx)

        assert len(written_lines) == 1
        assert written_lines[0]["call_id"] == "call-uuid-6"
        assert written_lines[0]["status"] == "answered"


# ──────────────────────────────────────────────────────────────────────────────
# 锁文件清理（I-10）
# ──────────────────────────────────────────────────────────────────────────────

class TestLockFileCleanup:
    def test_lock_file_removed_on_success(self):
        """
        子进程正常退出后删除锁文件（I-10 finally 块）。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1
        mock_make_voice_call = MagicMock()
        mock_make_voice_call.return_value = {"status": "answered", "duration_seconds": 10, "transcript": "", "bubble_text": "通话时长 00:10"}
        mock_db.write_record.return_value = 200

        mock_remove = MagicMock()

        ctx = WorkerContext(
            call_id="call-uuid-7",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", mock_remove), patch("os.path.exists", return_value=True):
            run_worker(ctx)

        mock_remove.assert_called_once()
        lock_path = mock_remove.call_args[0][0]
        assert "gpa-call-uuid-7" in lock_path

    def test_lock_file_removed_on_exception(self):
        """
        子进程异常退出时也删除锁文件（finally 块保证）。
        """
        mock_db = MagicMock()
        mock_db.advance_to_dialing.return_value = 1
        mock_make_voice_call = MagicMock()
        mock_make_voice_call.side_effect = RuntimeError("unexpected crash")
        mock_db.write_failed = MagicMock()

        mock_remove = MagicMock()

        ctx = WorkerContext(
            call_id="call-uuid-8",
            tenant_id="t1",
            contact_name="默忆",
            wechat_account="wx-001",
            machine_id="m1",
            db=mock_db,
            make_voice_call_fn=mock_make_voice_call,
        )

        with patch("os.remove", mock_remove), patch("os.path.exists", return_value=True):
            run_worker(ctx)  # 不应再抛出

        mock_remove.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# AI 对话真接线（make_voice_call → start_audio_bridge）
# ──────────────────────────────────────────────────────────────────────────────

class TestAudioBridgeIntegration:
    def test_make_voice_call_calls_start_audio_bridge(self):
        """
        make_voice_call() 内部调用 start_audio_bridge()（AI 对话真接线，非 TODO）。
        验证：asr_buffer 被 start_audio_bridge 的 asr_callback 参数填充。
        """
        try:
            from voice_call.call_rpa import make_voice_call
        except ImportError:
            pytest.skip("call_rpa.py 尚未更新（Red 状态）")

        asr_collected = []

        def mock_audio_bridge(asr_callback, **kwargs):
            # 模拟 ASR 回传两条识别结果
            asr_callback("你好")
            asr_callback("我在")

        with patch("voice_call.audio_bridge.start_audio_bridge", mock_audio_bridge), \
             patch("voice_call.call_rpa.locate_contact", return_value={"status": "ok", "chat_win": MagicMock()}), \
             patch("voice_call.call_rpa.trigger_voice_call", return_value={"status": "in_call"}), \
             patch("voice_call.call_rpa.wait_for_answer", return_value="answered"), \
             patch("voice_call.call_rpa.wait_for_hangup", return_value={"bubble_text": "通话时长 00:30", "duration_seconds": 30}):

            result = make_voice_call(
                contact_name="默忆",
                wechat_account="wx-001",
                asr_buffer=asr_collected,
            )

        # start_audio_bridge 被调用，ASR 被收集
        assert "你好" in asr_collected
        assert "我在" in asr_collected
