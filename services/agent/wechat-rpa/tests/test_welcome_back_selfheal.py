# -*- coding: utf-8 -*-
"""
回归测试 §2.J：_try_welcome_back_click 欢迎回来屏自愈。

根因（07-08 真机，issue e78d98bc）：is_privacy_locked() 把"欢迎回来"屏
（mmui::LoginWindow title='微信' + 含「进入微信」按钮）和真正隐私锁屏混在一起；
主循环对 screen_locked=True 直接 sleep+continue，永不自动点击 → 生产停摆直到人工干预。

修法：先检测 LoginWindow 是否含「进入微信」按钮区分两种状态，有则拉前台+click_input。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, patch, call

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


# ─── helper：构造 mock LoginWindow ─────────────────────────────────────────────

def _make_login_win(title: str = "微信", hwnd: int = 12345, buttons=None):
    """构造模拟 mmui::LoginWindow 对象。"""
    win = MagicMock()
    win.element_info.class_name = "mmui::LoginWindow"
    win.element_info.name = title
    win.element_info.handle = hwnd

    btn_mocks = []
    for btn_name in (buttons or []):
        btn = MagicMock()
        btn.element_info.name = btn_name
        btn_mocks.append(btn)

    win.descendants = MagicMock(return_value=btn_mocks)
    return win


# ─── 1. 欢迎回来屏：含「进入微信」按钮 → click 并返回 True ────────────────────────


def test_try_welcome_back_click_returns_true_and_clicks():
    """LoginWindow title='微信' + '进入微信'按钮 → click_input() 被调用，返回 True。"""
    welcome_win = _make_login_win(
        title="微信", hwnd=12345,
        buttons=["进入微信", "切换账号", "仅传输文件"]
    )

    fake_desktop = MagicMock()
    fake_desktop.windows.return_value = [welcome_win]

    import pywinauto
    pywinauto.Desktop = MagicMock(return_value=fake_desktop)

    with patch.object(listen_chat, "_force_foreground") as mock_fg:
        result = listen_chat._try_welcome_back_click()

    assert result is True, "有「进入微信」按钮时应返回 True"
    # 验证拉前台被调用
    mock_fg.assert_called_once_with(12345)
    # 验证 click_input 被调用
    enter_btn = welcome_win.descendants.return_value[0]
    enter_btn.click_input.assert_called_once()


def test_try_welcome_back_click_false_when_no_enter_button():
    """LoginWindow title='微信' 但没有「进入微信」按钮 → 真隐私锁，返回 False。"""
    privacy_lock_win = _make_login_win(
        title="微信", hwnd=99999,
        buttons=[]  # 真隐私锁没有「进入微信」按钮
    )
    fake_desktop = MagicMock()
    fake_desktop.windows.return_value = [privacy_lock_win]

    import pywinauto
    pywinauto.Desktop = MagicMock(return_value=fake_desktop)

    with patch.object(listen_chat, "_force_foreground") as mock_fg:
        result = listen_chat._try_welcome_back_click()

    assert result is False, "真隐私锁（无「进入微信」按钮）应返回 False"
    mock_fg.assert_not_called()


def test_try_welcome_back_click_false_when_no_login_window():
    """没有任何 LoginWindow → 返回 False。"""
    non_login_win = MagicMock()
    non_login_win.element_info.class_name = "mmui::MainWindow"
    non_login_win.element_info.name = "微信"

    fake_desktop = MagicMock()
    fake_desktop.windows.return_value = [non_login_win]

    import pywinauto
    pywinauto.Desktop = MagicMock(return_value=fake_desktop)

    result = listen_chat._try_welcome_back_click()
    assert result is False


def test_try_welcome_back_click_false_when_title_is_not_wechat():
    """LoginWindow title='登录'（真正扫码登录）→ 不触发欢迎回来自愈，返回 False。"""
    login_win = _make_login_win(title="登录", hwnd=11111, buttons=["进入微信"])
    # 注意：title='登录' 的 LoginWindow 是扫码登录，不是欢迎回来屏
    fake_desktop = MagicMock()
    fake_desktop.windows.return_value = [login_win]

    import pywinauto
    pywinauto.Desktop = MagicMock(return_value=fake_desktop)

    result = listen_chat._try_welcome_back_click()
    assert result is False, "title='登录'（扫码登录）不应触发欢迎回来自愈"


def test_try_welcome_back_click_absorbs_exception():
    """异常被吞掉，返回 False，不向外抛。"""
    import pywinauto
    pywinauto.Desktop = MagicMock(side_effect=RuntimeError("UIA not ready"))

    result = listen_chat._try_welcome_back_click()
    assert result is False


# ─── 2. 常量守卫 ────────────────────────────────────────────────────────────────


def test_welcome_back_cooldown_at_least_20s():
    """冷却时间 >= 20s，防止每轮循环（~3s）重复触发。"""
    assert listen_chat._WELCOME_BACK_COOLDOWN >= 20


def test_welcome_back_wait_sec_at_least_10():
    """等待主窗口出现最少 10s（exp8 实测约 10s，留充足余量）。"""
    assert listen_chat._WELCOME_BACK_WAIT_SEC >= 10
