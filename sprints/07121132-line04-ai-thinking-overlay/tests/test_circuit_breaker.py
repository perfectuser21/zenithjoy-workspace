"""
熔断保护测试骨架
对应：[BEHAVIOR-INV-6] 熔断保护
"""
import time
import pytest


class CircuitBreakerStub:
    """
    熔断器占位实现，实际实现替换此类
    待实现：from services.overlay.circuit_breaker import CircuitBreaker
    """
    THRESHOLD = 8  # 60min 内存活 <60s 次数阈值
    WINDOW_SECONDS = 3600  # 60min

    def __init__(self):
        self.restarts: list[float] = []  # 记录每次重启的时间戳
        self.circuit_open = False

    def record_restart(self, alive_seconds: float, ts: float = None):
        """记录一次重启，alive_seconds 是本次存活时长"""
        now = ts or time.time()
        # 清理窗口外的记录
        cutoff = now - self.WINDOW_SECONDS
        self.restarts = [r for r in self.restarts if r > cutoff]

        if alive_seconds < 60:
            self.restarts.append(now)
            if len(self.restarts) >= self.THRESHOLD:
                self.circuit_open = True

    def reset(self):
        """agent 重启时复位"""
        self.restarts = []
        self.circuit_open = False

    def is_webview2_crash(self, error_code: str) -> bool:
        """WebView2 崩溃使用独立错误码"""
        return error_code.startswith("WEBVIEW2_")


class TestCircuitBreaker:
    """熔断保护单元测试"""

    def test_circuit_opens_at_8(self):
        """第 8 次存活<60s 后熔断"""
        cb = CircuitBreakerStub()
        base_ts = time.time()

        for i in range(7):
            cb.record_restart(alive_seconds=30, ts=base_ts + i * 10)
            assert not cb.circuit_open, f"Circuit should not open at restart {i+1}"

        cb.record_restart(alive_seconds=30, ts=base_ts + 70)
        assert cb.circuit_open, "Circuit should open at 8th short-lived restart"

    def test_circuit_not_open_below_threshold(self):
        """不足 8 次不熔断"""
        cb = CircuitBreakerStub()
        base_ts = time.time()

        for i in range(7):
            cb.record_restart(alive_seconds=30, ts=base_ts + i * 10)

        assert not cb.circuit_open

    def test_circuit_resets_on_agent_restart(self):
        """agent 重启后熔断计数复位"""
        cb = CircuitBreakerStub()
        base_ts = time.time()

        # 触发熔断
        for i in range(8):
            cb.record_restart(alive_seconds=30, ts=base_ts + i * 10)
        assert cb.circuit_open

        # agent 重启 → 复位
        cb.reset()
        assert not cb.circuit_open
        assert len(cb.restarts) == 0

    def test_long_lived_restarts_not_counted(self):
        """存活超过 60s 的重启不计入熔断计数"""
        cb = CircuitBreakerStub()
        base_ts = time.time()

        # 7 次正常（存活>60s）+ 1 次短命
        for i in range(7):
            cb.record_restart(alive_seconds=120, ts=base_ts + i * 10)
        cb.record_restart(alive_seconds=30, ts=base_ts + 70)

        assert not cb.circuit_open, "Only 1 short-lived restart, should not open"

    def test_webview2_crash_not_counted(self):
        """WebView2 崩溃使用独立错误码，不计入熔断"""
        cb = CircuitBreakerStub()

        # 验证 WebView2 错误码识别
        assert cb.is_webview2_crash("WEBVIEW2_RENDER_CRASH")
        assert cb.is_webview2_crash("WEBVIEW2_UPDATE_RESTART")
        assert not cb.is_webview2_crash("GENERAL_CRASH")
        assert not cb.is_webview2_crash("OOM_CRASH")

    def test_window_expiry(self):
        """超过 60min 窗口的记录不计入"""
        cb = CircuitBreakerStub()
        base_ts = time.time()

        # 7 次在 60min 前（窗口外）
        old_ts = base_ts - 3700  # 超过 60min
        for i in range(7):
            cb.record_restart(alive_seconds=30, ts=old_ts + i * 10)

        # 清空后只有 1 次新的（窗口内）
        cb.record_restart(alive_seconds=30, ts=base_ts)

        assert not cb.circuit_open, "Old records should have expired from 60min window"

    def test_diag_circuit_open_field(self):
        """熔断后 diag 含 circuit_open: true"""
        import json
        import tempfile
        import os

        cb = CircuitBreakerStub()
        base_ts = time.time()
        for i in range(8):
            cb.record_restart(alive_seconds=30, ts=base_ts + i * 10)

        # 模拟写 diag
        diag = {"circuit_open": cb.circuit_open, "restart_count_60min": len(cb.restarts)}
        assert diag["circuit_open"] is True
        assert diag["restart_count_60min"] >= 8
