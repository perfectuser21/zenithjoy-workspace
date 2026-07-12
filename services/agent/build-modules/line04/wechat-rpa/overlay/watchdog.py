"""
watchdog.py — 浮窗守活/熔断
60min 内 8 次存活 <60s → 熔断静默，agent 重启复位。
"""
import json
import os
import time


class OverlayWatchdog:
    CIRCUIT_WINDOW_SEC = 3600
    CIRCUIT_THRESHOLD = 8
    FAST_CRASH_SEC = 60

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
        now = time.time()
        if uptime_sec < self.FAST_CRASH_SEC:
            self._crash_times.append(now)
            self._restart_count += 1
            cutoff = now - self.CIRCUIT_WINDOW_SEC
            self._crash_times = [t for t in self._crash_times if t >= cutoff]
            if len(self._crash_times) >= self.CIRCUIT_THRESHOLD:
                self._circuit_open = True

    def should_respawn(self) -> bool:
        if self._circuit_open:
            return False
        if self._user_closed:
            return False
        return True

    def on_user_close(self):
        self._user_closed = True
        state_path = os.path.join(self.state_dir, "overlay-state.json")
        state = {"user_closed": True}
        os.makedirs(self.state_dir, exist_ok=True)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f)

    def reset_on_agent_restart(self):
        self._circuit_open = False
        self._crash_times = []
        self._restart_count = 0
        self._user_closed = False

    def write_diag(self):
        diag = {
            "agent_id": os.environ.get("ZJ_AGENT_ID", "unknown"),
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
        os.makedirs(self.state_dir, exist_ok=True)
        diag_path = os.path.join(self.state_dir, "overlay-diag.json")
        with open(diag_path, "w", encoding="utf-8") as f:
            json.dump(diag, f, ensure_ascii=False, indent=2)
