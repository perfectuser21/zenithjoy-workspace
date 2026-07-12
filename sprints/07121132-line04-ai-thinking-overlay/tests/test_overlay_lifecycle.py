"""
test_overlay_lifecycle.py — 浮窗守活/熔断/用户关闭骨架测试

覆盖 BEHAVIOR-6：崩溃熔断触发+复位+用户关闭不重拉。

运行：pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py -v
"""
import json
import os
import time
import tempfile
from pathlib import Path
import pytest

# TODO: 实现完成后替换为真实导入
# from services.line04.overlay.watchdog import OverlayWatchdog


# ─── 守活/熔断存根 ────────────────────────────────────────────────────────────

class OverlayWatchdogStub:
    """
    守活逻辑存根（实现后替换为真实 import）。
    模拟熔断状态管理：60min 内 8 次存活 <60s → 熔断。
    """
    CIRCUIT_WINDOW_SEC = 3600   # 60 min
    CIRCUIT_THRESHOLD = 8       # 8 次
    FAST_CRASH_SEC = 60         # 存活 <60s 算快速崩溃

    def __init__(self, state_dir: str):
        self.state_dir = state_dir
        self._crash_times: list = []
        self._circuit_open = False
        self._restart_count = 0
        self._user_closed = False

    @property
    def circuit_open(self) -> bool:
        return self._circuit_open

    def record_crash(self, uptime_sec: float):
        """记录一次崩溃，uptime_sec < 60 则计入快速崩溃"""
        now = time.time()
        if uptime_sec < self.FAST_CRASH_SEC:
            self._crash_times.append(now)
            self._restart_count += 1
            # 清理 60min 窗口外的记录
            cutoff = now - self.CIRCUIT_WINDOW_SEC
            self._crash_times = [t for t in self._crash_times if t >= cutoff]
            # 检查熔断
            if len(self._crash_times) >= self.CIRCUIT_THRESHOLD:
                self._circuit_open = True

    def should_respawn(self) -> bool:
        """是否应当重拉进程"""
        if self._circuit_open:
            return False
        if self._user_closed:
            return False
        return True

    def on_user_close(self):
        """用户主动关闭"""
        self._user_closed = True
        state_path = os.path.join(self.state_dir, "overlay-state.json")
        state = {"user_closed": True}
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f)

    def reset_on_agent_restart(self):
        """agent 重启后复位熔断"""
        self._circuit_open = False
        self._crash_times = []
        self._restart_count = 0
        self._user_closed = False

    def write_diag(self):
        """写 overlay-diag.json"""
        diag = {
            "agent_id": "test-agent",
            "ts": int(time.time()),
            "overlay_pid": None,
            "rss_mb": 0.0,
            "cpu_pct": 0.0,
            "attach_state": "circuit_open" if self._circuit_open else "idle",
            "wechat_hwnd_found": False,
            "render_lag_ms_p95": 0,
            "events_tail_offset": 0,
            "restart_count_60min": self._restart_count,
            "circuit_open": self._circuit_open,
            "last_error": "circuit_breaker_triggered" if self._circuit_open else "",
        }
        diag_path = os.path.join(self.state_dir, "overlay-diag.json")
        with open(diag_path, "w", encoding="utf-8") as f:
            json.dump(diag, f)


# ─── BEHAVIOR-6 测试 ─────────────────────────────────────────────────────────

class TestOverlayLifecycle:
    """BEHAVIOR-6：崩溃熔断触发+复位+用户关闭"""

    def test_circuit_breaker_trigger(self, tmp_path):
        """60min 内 8 次存活 <60s → 熔断触发"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        assert not watchdog.circuit_open

        # 模拟 8 次快速崩溃（uptime < 60s）
        for _ in range(8):
            watchdog.record_crash(uptime_sec=30)

        assert watchdog.circuit_open, "8 次快速崩溃后应触发熔断"

    def test_circuit_not_triggered_by_slow_crashes(self, tmp_path):
        """存活 ≥60s 的崩溃不计入熔断计数"""
        watchdog = OverlayWatchdogStub(str(tmp_path))

        # 8 次正常崩溃（uptime >= 60s）
        for _ in range(8):
            watchdog.record_crash(uptime_sec=90)

        assert not watchdog.circuit_open, "存活 ≥60s 的崩溃不应触发熔断"

    def test_circuit_trigger_needs_threshold(self, tmp_path):
        """7 次快速崩溃不触发熔断，第 8 次触发"""
        watchdog = OverlayWatchdogStub(str(tmp_path))

        for _ in range(7):
            watchdog.record_crash(uptime_sec=10)
        assert not watchdog.circuit_open, "7 次不应触发熔断"

        watchdog.record_crash(uptime_sec=10)
        assert watchdog.circuit_open, "第 8 次应触发熔断"

    def test_circuit_open_no_respawn(self, tmp_path):
        """熔断后 should_respawn() 返回 False"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        for _ in range(8):
            watchdog.record_crash(uptime_sec=10)

        assert not watchdog.should_respawn(), "熔断后不应重拉"

    def test_circuit_reset_on_agent_restart(self, tmp_path):
        """agent 重启后熔断复位，restart_count 归零"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        for _ in range(8):
            watchdog.record_crash(uptime_sec=10)
        assert watchdog.circuit_open

        watchdog.reset_on_agent_restart()
        assert not watchdog.circuit_open, "agent 重启后熔断应复位"
        assert watchdog._restart_count == 0, "restart_count 应归零"
        assert watchdog.should_respawn(), "复位后应可重拉"

    def test_user_close_no_respawn(self, tmp_path):
        """用户关闭（退出码 0）→ should_respawn() 返回 False"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        watchdog.on_user_close()

        assert not watchdog.should_respawn(), "用户关闭后守活不应重拉"

        # 验证 overlay-state.json 写入
        state_path = tmp_path / "overlay-state.json"
        assert state_path.exists(), "user_close 应写 overlay-state.json"
        with open(state_path, encoding="utf-8") as f:
            state = json.load(f)
        assert state.get("user_closed") is True

    def test_diag_circuit_open_field(self, tmp_path):
        """熔断后 overlay-diag.json circuit_open = true"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        for _ in range(8):
            watchdog.record_crash(uptime_sec=10)

        watchdog.write_diag()
        diag_path = tmp_path / "overlay-diag.json"
        with open(diag_path, encoding="utf-8") as f:
            diag = json.load(f)

        assert diag["circuit_open"] is True
        assert diag["restart_count_60min"] == 8

    def test_diag_12_fields_present(self, tmp_path):
        """overlay-diag.json 必须含全部 12 字段"""
        watchdog = OverlayWatchdogStub(str(tmp_path))
        watchdog.write_diag()

        required = {
            "agent_id", "ts", "overlay_pid", "rss_mb", "cpu_pct",
            "attach_state", "wechat_hwnd_found", "render_lag_ms_p95",
            "events_tail_offset", "restart_count_60min", "circuit_open", "last_error"
        }
        diag_path = tmp_path / "overlay-diag.json"
        with open(diag_path, encoding="utf-8") as f:
            diag = json.load(f)

        missing = required - set(diag.keys())
        assert not missing, f"overlay-diag.json 缺少字段: {missing}"
