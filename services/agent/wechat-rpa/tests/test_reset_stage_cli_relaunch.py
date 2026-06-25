"""
test_reset_stage_cli_relaunch.py — 复位台真机 driver「关 app 后重启微信再验登录」单测。

真机 bug（2026-06-25 xian-rog 实测）：reset_stage 第①步 close_running_wechat() 先把微信
taskkill，第③步 get_logged_in_account() 再去读主窗口 —— 但微信已被关，get_main_window()
返回 None → 误判「测试微信号未登录」→ 复位红，即使测试号其实好好登录着。

根因：RealWinDriver.get_logged_in_account 关掉微信后没重新启动微信就读窗口。
修复：抽出纯函数 ensure_window_ready(get_window, launch, sleep, activate, attempts)，
关掉后先 launch 再轮询等窗口出现 + 激活 UIA，拿到窗口再读登录态。本测全 mock，CI 可跑。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reset_stage_cli import ensure_window_ready  # noqa: E402


class _WindowSeq:
    """模拟 get_main_window：前 miss_times 次返回 None（微信刚被关/还没起来），之后返回窗口对象。"""

    def __init__(self, miss_times, window=object()):
        self.miss_times = miss_times
        self.window = window
        self.calls = 0

    def __call__(self):
        self.calls += 1
        if self.calls <= self.miss_times:
            return None
        return self.window


def test_window_already_up_no_relaunch():
    """微信窗口本来就在 → 直接返回，不调 launch。"""
    win = object()
    launched = []
    seq = _WindowSeq(miss_times=0, window=win)
    out = ensure_window_ready(
        get_window=seq,
        launch=lambda: launched.append(True) or True,
        sleep=lambda s: None,
        attempts=5,
    )
    assert out is win
    assert launched == [], "窗口已在不该重启微信"


def test_relaunch_then_window_appears():
    """微信被关（前 3 次读不到）→ launch 后轮询，第 4 次窗口出现 → 返回窗口。"""
    win = object()
    launched = []
    seq = _WindowSeq(miss_times=3, window=win)
    out = ensure_window_ready(
        get_window=seq,
        launch=lambda: launched.append(True) or True,
        sleep=lambda s: None,
        attempts=8,
    )
    assert out is win, "重启微信并等窗口出现后应拿到窗口"
    assert launched == [True], "读不到窗口时必须 launch 一次微信"


def test_activate_called_when_window_found():
    """窗口出现后必须激活 UIA（屏幕阅读器标志），否则微信 4.x 控件树读不到。"""
    win = object()
    activated = []
    seq = _WindowSeq(miss_times=1, window=win)
    out = ensure_window_ready(
        get_window=seq,
        launch=lambda: True,
        sleep=lambda s: None,
        activate=lambda: activated.append(True),
        attempts=5,
    )
    assert out is win
    assert activated == [True], "拿到窗口后必须激活 UIA 一次"


def test_returns_none_if_never_appears():
    """launch 后等满 attempts 仍没窗口（微信起不来/崩了）→ 返回 None（复位会红，符合预期）。"""
    seq = _WindowSeq(miss_times=999)
    out = ensure_window_ready(
        get_window=seq,
        launch=lambda: True,
        sleep=lambda s: None,
        attempts=4,
    )
    assert out is None
