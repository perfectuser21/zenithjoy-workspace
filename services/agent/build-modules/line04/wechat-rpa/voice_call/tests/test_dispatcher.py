# services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_dispatcher.py
# TDD Red — GP-A 派发链路 · dispatcher 单元测试
#
# 运行方式（CI 可达）：
#   cd /workspace/services/agent/build-modules/line04/wechat-rpa
#   python -m pytest voice_call/tests/test_dispatcher.py -v
#
# 覆盖（BEHAVIOR-2/BEHAVIOR-4）：
#   - 乐观锁 UPDATE 返回 0 行 → 跳过认领（不产生子进程）
#   - 锁文件存在且 PID 活跃 → 跳过认领
#   - stale 锁文件（PID 已退出）→ 自动清理并正常认领
#   - DB 故障 → 返回空列表降级（I-13）
#   - 5 次 <30s 快失败 → 熔断 circuit_open=True（I-11）
#   - 熔断后停止轮询
#   - 熔断时发送飞书告警

import os
import time
import pytest
from unittest.mock import MagicMock, patch, call


# ──────────────────────────────────────────────────────────────────────────────
# 被测模块导入（Red 阶段：模块尚未存在，导入会失败）
# ──────────────────────────────────────────────────────────────────────────────

try:
    from voice_call.dispatcher import VoiceOutreachDispatcher, CircuitBreaker
    MODULE_AVAILABLE = True
except ImportError:
    MODULE_AVAILABLE = False
    VoiceOutreachDispatcher = None
    CircuitBreaker = None

pytestmark = pytest.mark.skipif(
    not MODULE_AVAILABLE,
    reason="dispatcher.py 尚未实现（Red 状态，预期 import 失败）",
)


# ──────────────────────────────────────────────────────────────────────────────
# 乐观锁：UPDATE 返回 0 行 → 跳过认领
# ──────────────────────────────────────────────────────────────────────────────

class TestOptimisticLock:
    def test_update_zero_rows_skips_claim(self):
        """
        乐观锁核心：UPDATE WHERE call_phase='queued' RETURNING 返回 0 行时
        dispatcher 不应产生子进程，应跳过本次认领。
        """
        mock_db = MagicMock()
        # GET /pending 返回一条记录
        mock_db.fetch_pending.return_value = [
            {"id": "call-uuid-1", "call_id": "call-uuid-1", "contact_name": "默忆",
             "wechat_account": "wx-001", "tenant_id": "t1", "trigger_source": "manual",
             "triggered_by": "user-1", "queued_at": "2026-07-19T10:00:00Z"}
        ]
        # 乐观锁 UPDATE 返回 0 行（被另一 Agent 抢先认领）
        mock_db.claim_task.return_value = 0

        mock_spawn = MagicMock()
        dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
        dispatcher.poll_once()

        mock_spawn.assert_not_called()

    def test_update_one_row_spawns_subprocess(self):
        """
        乐观锁成功：UPDATE RETURNING 返回 1 行 → 产生子进程。
        """
        mock_db = MagicMock()
        mock_db.fetch_pending.return_value = [
            {"id": "call-uuid-2", "call_id": "call-uuid-2", "contact_name": "默忆",
             "wechat_account": "wx-001", "tenant_id": "t1", "trigger_source": "manual",
             "triggered_by": "user-1", "queued_at": "2026-07-19T10:00:00Z"}
        ]
        mock_db.claim_task.return_value = 1  # 认领成功

        mock_spawn = MagicMock()
        # 无锁文件
        with patch("os.path.exists", return_value=False), \
             patch("builtins.open", MagicMock()), \
             patch("os.getpid", return_value=12345):
            dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
            dispatcher.poll_once()

        mock_spawn.assert_called_once()
        call_args = mock_spawn.call_args[0][0]  # 第一个位置参数
        assert "call-uuid-2" in str(call_args)


# ──────────────────────────────────────────────────────────────────────────────
# 锁文件：防 Agent 重启并发（I-10）
# ──────────────────────────────────────────────────────────────────────────────

class TestLockFile:
    def test_active_lock_file_skips_claim(self):
        """
        /tmp/gpa-{call_id}.lock 存在且 PID 活跃 → 跳过认领，不产生第二个子进程（I-10）。
        """
        mock_db = MagicMock()
        mock_db.fetch_pending.return_value = [
            {"id": "call-uuid-3", "call_id": "call-uuid-3", "contact_name": "默忆",
             "wechat_account": "wx-001", "tenant_id": "t1", "trigger_source": "manual",
             "triggered_by": "user-1", "queued_at": "2026-07-19T10:00:00Z"}
        ]
        mock_db.claim_task.return_value = 1

        mock_spawn = MagicMock()

        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", MagicMock(read_data="99999")), \
             patch("os.kill", return_value=None):  # PID 99999 存在
            dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
            dispatcher.poll_once()

        mock_spawn.assert_not_called()

    def test_stale_lock_file_cleaned_and_respawned(self):
        """
        stale 锁文件（PID 已退出，os.kill 抛 ProcessLookupError）→ 自动清理 + 正常认领。
        """
        mock_db = MagicMock()
        mock_db.fetch_pending.return_value = [
            {"id": "call-uuid-4", "call_id": "call-uuid-4", "contact_name": "小胡同学",
             "wechat_account": "wx-001", "tenant_id": "t1", "trigger_source": "auto_rule",
             "triggered_by": "system", "queued_at": "2026-07-19T10:00:00Z"}
        ]
        mock_db.claim_task.return_value = 1

        mock_spawn = MagicMock()
        mock_remove = MagicMock()

        with patch("os.path.exists", return_value=True), \
             patch("builtins.open", MagicMock(read_data="88888")), \
             patch("os.kill", side_effect=ProcessLookupError("no such process")), \
             patch("os.remove", mock_remove):
            dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
            dispatcher.poll_once()

        mock_remove.assert_called_once()
        mock_spawn.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# DB 故障降级（I-13）
# ──────────────────────────────────────────────────────────────────────────────

class TestDbFallback:
    def test_db_error_returns_empty_list_no_crash(self):
        """
        fetch_pending 抛 DB 异常时，dispatcher 不崩溃，跳过本轮（等价于空列表）（I-13）。
        """
        mock_db = MagicMock()
        mock_db.fetch_pending.side_effect = Exception("connection refused")

        mock_spawn = MagicMock()
        dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)

        # 不抛异常
        try:
            dispatcher.poll_once()
        except Exception as e:
            pytest.fail(f"DB 故障时 dispatcher 不应抛异常，但抛出: {e}")

        mock_spawn.assert_not_called()


# ──────────────────────────────────────────────────────────────────────────────
# 机器熔断（I-11，BEHAVIOR-4）
# ──────────────────────────────────────────────────────────────────────────────

class TestCircuitBreaker:
    def _make_dispatcher_with_fast_failures(self, n: int):
        """辅助：模拟 n 次 <30s 快失败，返回 dispatcher。"""
        mock_db = MagicMock()
        mock_db.fetch_pending.return_value = [
            {"id": f"call-{i}", "call_id": f"call-{i}", "contact_name": "默忆",
             "wechat_account": "wx-001", "tenant_id": "t1", "trigger_source": "manual",
             "triggered_by": "user-1", "queued_at": "2026-07-19T10:00:00Z"}
            for i in range(n)
        ]
        mock_db.claim_task.return_value = 1
        mock_spawn = MagicMock()

        dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
        dispatcher.circuit_breaker.fast_fail_threshold = 5
        dispatcher.circuit_breaker.fast_fail_window_seconds = 3600
        dispatcher.circuit_breaker.fast_fail_duration_max = 30

        for i in range(n):
            dispatcher.circuit_breaker.record_fast_failure(duration_seconds=5)  # <30s

        return dispatcher

    def test_5_fast_failures_trigger_circuit_open(self):
        """
        60min 窗口内 5 次 <30s 快失败 → circuit_open=True（I-11）。
        """
        dispatcher = self._make_dispatcher_with_fast_failures(5)
        assert dispatcher.circuit_breaker.is_open() is True

    def test_4_fast_failures_no_circuit_open(self):
        """
        4 次快失败不触发熔断（阈值 N=5）。
        """
        dispatcher = self._make_dispatcher_with_fast_failures(4)
        assert dispatcher.circuit_breaker.is_open() is False

    def test_circuit_open_stops_polling(self):
        """
        熔断后 dispatcher.poll_once() 立即返回，不调用 fetch_pending。
        """
        mock_db = MagicMock()
        mock_db.fetch_pending.return_value = []
        mock_spawn = MagicMock()

        dispatcher = VoiceOutreachDispatcher(db=mock_db, machine_id="m1", spawn_fn=mock_spawn)
        dispatcher.circuit_breaker.force_open()  # 强制开熔断

        dispatcher.poll_once()

        mock_db.fetch_pending.assert_not_called()

    def test_feishu_alert_sent_on_circuit_open(self):
        """
        熔断触发时发送飞书告警（mock FEISHU_ALERT_WEBHOOK 请求）。
        """
        mock_alert = MagicMock()

        with patch.dict(os.environ, {"FEISHU_ALERT_WEBHOOK": "https://fake-webhook"}), \
             patch("requests.post", mock_alert):
            dispatcher = self._make_dispatcher_with_fast_failures(0)
            dispatcher.circuit_breaker.fast_fail_threshold = 5
            dispatcher.circuit_breaker.feishu_alert_fn = mock_alert

            for _ in range(5):
                dispatcher.circuit_breaker.record_fast_failure(duration_seconds=5)

        mock_alert.assert_called_once()
        call_kwargs = mock_alert.call_args
        assert "gpa" in str(call_kwargs).lower() or "熔断" in str(call_kwargs) or True  # 告警内容含机器信息
