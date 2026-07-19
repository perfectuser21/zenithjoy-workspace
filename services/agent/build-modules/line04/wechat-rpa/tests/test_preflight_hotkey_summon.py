# -*- coding: utf-8 -*-
"""
test_preflight_hotkey_summon.py —— onboarding 热键召唤功能自检探针回归测试
（handoff 0719 发现1 onboarding 前置：绑号时引导用户手动把「显示/隐藏窗口」设成
Ctrl+Alt+W、范围「所有窗口」，程序不读加密配置文件，只能靠"实际发一次热键观察
窗口显隐响应"来判定用户设对没）。

覆盖：
  1. dry-run / 非 Windows → warn（不触碰真实按键）
  2. 拿不到微信主窗口 → warn（微信未登录/未启动，兼容场景）
  3. 发热键后窗口显隐无变化 → failed（热键没配对，明确提示去哪设）
  4. 发热键后窗口显隐有变化 → ok，且探针必须把状态还原回探测前（幂等，不留副作用）
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


def test_hotkey_not_configured_failed(monkeypatch):
    """发送 Ctrl+Alt+W 后 IsWindowVisible 恒不变 → 用户没把热键设成 Ctrl+Alt+W。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    monkeypatch.setattr("listen_chat._safe_hwnd", lambda mw: 12345, raising=False)
    monkeypatch.setattr("listen_chat._send_hotkey_ctrl_alt_w", lambda: None, raising=False)

    fake_windll = MagicMock()
    fake_windll.user32.IsWindowVisible.return_value = 1  # 恒可见，从不切换
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)

    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "failed"
    assert "Ctrl+Alt+W" in result["detail"]


def test_hotkey_configured_ok_and_restores_state(monkeypatch):
    """发送后窗口显隐翻转 → ok；探针必须自己再发一次把状态还原回探测前（幂等）。"""
    monkeypatch.setattr(preflight, "_is_windows", lambda: True)
    monkeypatch.setattr("find_weixin.get_main_window", lambda: object(), raising=False)
    monkeypatch.setattr("listen_chat._safe_hwnd", lambda mw: 12345, raising=False)

    send_calls = {"n": 0}
    # 每调用一次真实按键，可见性状态翻转一次（模拟 toggle 热键真的生效）
    visible_state = {"v": True}

    def _fake_send():
        send_calls["n"] += 1
        visible_state["v"] = not visible_state["v"]

    monkeypatch.setattr("listen_chat._send_hotkey_ctrl_alt_w", _fake_send, raising=False)

    fake_windll = MagicMock()
    fake_windll.user32.IsWindowVisible.side_effect = lambda hwnd: int(visible_state["v"])
    monkeypatch.setattr(preflight.ctypes, "windll", fake_windll, raising=False)

    result = check_hotkey_summon(dry_run=False)
    assert result["status"] == "ok"
    # 探针发了两次热键（探测一次 + 还原一次），且最终状态与探测前一致
    assert send_calls["n"] == 2
    assert visible_state["v"] is True
