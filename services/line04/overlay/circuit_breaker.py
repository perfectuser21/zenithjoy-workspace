import time

class CircuitBreaker:
    THRESHOLD = 8
    WINDOW_SECONDS = 3600

    def __init__(self):
        self.restarts = []
        self.circuit_open = False

    def record_restart(self, alive_seconds: float, ts: float = None):
        now = ts or time.time()
        cutoff = now - self.WINDOW_SECONDS
        self.restarts = [r for r in self.restarts if r > cutoff]
        if alive_seconds < 60:
            self.restarts.append(now)
            if len(self.restarts) >= self.THRESHOLD:
                self.circuit_open = True

    def reset(self):
        self.restarts = []
        self.circuit_open = False

    def is_webview2_crash(self, error_code: str) -> bool:
        return error_code.startswith("WEBVIEW2_")
