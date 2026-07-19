# -*- coding: utf-8 -*-
"""
test_preflight_hotkey_summon.py —— onboarding 热键召唤功能自检探针回归测试
（handoff 0719 发现1 onboarding 前置：绑号时引导用户手动把「显示/隐藏窗口」设成
Ctrl+Alt+W、范围「所有窗口」，程序不读加密配置文件，只能靠"实际发一次热键观察
窗口显隐响应"来判定用户设对没）。

覆盖：
  1. dry-run / 非 Windows → warn（不触碰真实按键）
  2. 拿不到微信主窗口 → warn（微信未登录/未启动，兼容场景）
  3. 发热键后微信状态(前台/显隐/最小化)无任何变化 → failed（热键没配对/被别的软件抢注）
  4. 发热键后微信被拉到前台(可见性不变) → ok（真机铁证：微信响应是置顶不是隐藏，
     旧判据只看 IsWindowVisible 翻转会误报 failed —— 本 bug 的核心回归）
  5. 发热键后窗口显隐翻转 → ok，且探针必须把状态还原回探测前（幂等，不留副作用）
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import preflight  # noqa: E402
from preflight import check_hotkey_summon  # noqa: E402


def _no_sleep(monkeypatch):
    """轮询 sleep 置空，单测秒过。"""
    monkeypatch.setattr(preflight.time, "sleep", lambda *_a, **_k: None)


def test_dry_run_warn():
    result = check_hotkey_summon(dry_run=True)
    assert result["status"] == "warn"


def test_non_windows_warn(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: False)
    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "warn"


def test_no_main_window_warn(monkeypatch):
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: None, raising=False)
    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "warn"


def test_hotkey_no_response_failed(monkeypatch):
    """发送 Ctrl+Alt+W 后微信状态(前台/显隐/最小化)全无变化 → 热键没配对/被别的软件抢注。"""
    _no_sleep(monkeypatch)
    WX = 12345
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    monkeypatch.setattr("listen_chat._safe_hwnd", lambda mw: WX, raising=False)
    monkeypatch.setattr("listen_chat._send_hotkey_ctrl_alt_w", lambda: None, raising=False)

    fake = MagicMock()
    fake.user32.GetForegroundWindow.return_value = 999999  # 前台恒为别的窗口
    fake.user32.IsWindowVisible.return_value = 1           # 恒可见
    fake.user32.IsIconic.return_value = 0                  # 恒非最小化
    monkeypatch.setattr(preflight.ctypes, "windll", fake, raising=False)

    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "failed"
    assert "Ctrl+Alt+W" in result["detail"]


def test_hotkey_response_is_foreground_change_not_visibility(monkeypatch):
    """⭐核心回归（真机 rog 铁证）：微信响应 Ctrl+Alt+W 是"被拉到前台"，可见性完全不变。

    旧判据只看 IsWindowVisible 翻转 → 微信 onboarding 时本来就可见、置顶不改变可见性 →
    误报 failed（热键明明好用）。新判据看(前台/显隐/最小化)任一变化 → 正确报 ok。
    改回"只看可见性"会让本测试报红。"""
    _no_sleep(monkeypatch)
    WX = 461008  # 真机实测的微信 hwnd
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    monkeypatch.setattr("listen_chat._safe_hwnd", lambda mw: WX, raising=False)

    fg = {"hwnd": 999999}   # 初始前台是别的窗口（微信在后台但可见）
    send_calls = {"n": 0}

    def _fake_send():
        send_calls["n"] += 1
        # 奇数次发键把微信拉到前台，偶数次(还原)再切回别的窗口 → 模拟 toggle
        fg["hwnd"] = WX if send_calls["n"] % 2 == 1 else 999999

    monkeypatch.setattr("listen_chat._send_hotkey_ctrl_alt_w", _fake_send, raising=False)

    fake = MagicMock()
    fake.user32.GetForegroundWindow.side_effect = lambda: fg["hwnd"]
    fake.user32.IsWindowVisible.return_value = 1   # ⭐可见性恒为 True，全程不变
    fake.user32.IsIconic.return_value = 0          # 恒非最小化
    monkeypatch.setattr(preflight.ctypes, "windll", fake, raising=False)

    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "ok"
    # 幂等：探测一次 + 还原一次 = 2 次，且前台还原回探测前的别的窗口
    assert send_calls["n"] == 2
    assert fg["hwnd"] == 999999


def test_hotkey_visibility_flip_also_ok(monkeypatch):
    """微信响应表现为显隐翻转(而非置顶)时同样判 ok，且幂等还原。"""
    _no_sleep(monkeypatch)
    WX = 12345
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    monkeypatch.setattr("listen_chat._safe_hwnd", lambda mw: WX, raising=False)

    send_calls = {"n": 0}
    visible_state = {"v": True}

    def _fake_send():
        send_calls["n"] += 1
        visible_state["v"] = not visible_state["v"]

    monkeypatch.setattr("listen_chat._send_hotkey_ctrl_alt_w", _fake_send, raising=False)

    fake = MagicMock()
    fake.user32.GetForegroundWindow.return_value = 999999   # 前台恒别的窗口(不干扰)
    fake.user32.IsWindowVisible.side_effect = lambda hwnd: int(visible_state["v"])
    fake.user32.IsIconic.return_value = 0
    monkeypatch.setattr(preflight.ctypes, "windll", fake, raising=False)

    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "ok"
    assert send_calls["n"] == 2
    assert visible_state["v"] is True
