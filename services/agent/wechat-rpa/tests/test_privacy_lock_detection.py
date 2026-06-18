"""
回归测试 — 隐私锁屏误判为未登录 (2026-06-15)

根因：login_window_present() 对任意 mmui::LoginWindow 都返回 True，
但微信隐私锁（已登录+锁屏）也用 mmui::LoginWindow class，title='微信'。
真正未登录（需扫码）的界面 title='登录'。

【CI 安全】顶层零 pywinauto/win32 import；纯 Fake/Mock 对象，跨平台可跑。
pywinauto 在非 Windows 环境不可安装，用 sys.modules mock 注入。
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

# 注入 fake pywinauto 到 sys.modules（非 Windows 环境无此包）
if "pywinauto" not in sys.modules:
    sys.modules["pywinauto"] = MagicMock()

import find_weixin  # noqa: E402


class _FakeEI:
    def __init__(self, class_name="", name=""):
        self.class_name = class_name
        self.name = name


class _FakeWindow:
    def __init__(self, class_name="", title=""):
        self.element_info = _FakeEI(class_name=class_name, name=title)


def _set_windows(windows):
    """让 pywinauto.Desktop(backend='uia').windows() 返回指定列表。

    直接把 Desktop 替换成可调用 mock —— rog runner 真装了 pywinauto，
    若只设 .Desktop.return_value 对真 Desktop 类无效，会调真 pywinauto 读真窗口。
    """
    mock_desktop_inst = MagicMock()
    mock_desktop_inst.windows.return_value = windows
    sys.modules["pywinauto"].Desktop = MagicMock(return_value=mock_desktop_inst)


@pytest.fixture(autouse=True)
def _restore_pywinauto_desktop():
    """还原 pywinauto.Desktop，避免污染真 pywinauto 影响别的测试。"""
    mod = sys.modules.get("pywinauto")
    orig = getattr(mod, "Desktop", None)
    yield
    if mod is not None and orig is not None:
        mod.Desktop = orig


# ─── login_window_present ─────────────────────────────────────────────────────


def test_login_window_present_returns_false_for_privacy_lock():
    """隐私锁屏（mmui::LoginWindow title='微信'）不应被误判为未登录。"""
    _set_windows([
        _FakeWindow("Shell_TrayWnd", "任务栏"),
        _FakeWindow("mmui::LoginWindow", "微信"),  # 隐私锁屏，非真正未登录
    ])
    result = find_weixin.login_window_present()
    assert result is False, (
        "mmui::LoginWindow title='微信' 是隐私锁，login_window_present() 应返回 False"
    )


def test_login_window_present_returns_true_for_real_login():
    """真正未登录界面（mmui::LoginWindow title='登录'）应返回 True。"""
    _set_windows([
        _FakeWindow("Shell_TrayWnd", "任务栏"),
        _FakeWindow("mmui::LoginWindow", "登录"),  # 真正的登录/扫码界面
    ])
    result = find_weixin.login_window_present()
    assert result is True, (
        "mmui::LoginWindow title='登录' 是真正未登录，login_window_present() 应返回 True"
    )


def test_login_window_present_returns_false_for_empty_title():
    """mmui::LoginWindow title='' 空标题保守处理：不触发 login_window_present=True。"""
    _set_windows([
        _FakeWindow("mmui::LoginWindow", ""),
    ])
    result = find_weixin.login_window_present()
    assert result is False, (
        "mmui::LoginWindow title='' 空标题：保守处理，不触发 login_window_present=True"
    )


def test_login_window_present_qt5_login_still_detected():
    """Qt5 登录窗口（Qt51514QWindowIcon title='登录'）仍应返回 True。"""
    _set_windows([
        _FakeWindow("Qt51514QWindowIcon", "登录"),
    ])
    result = find_weixin.login_window_present()
    assert result is True, "Qt5 title='登录' 应返回 True"


def test_login_window_present_returns_false_when_no_login_window():
    """无任何登录窗口时返回 False。"""
    _set_windows([
        _FakeWindow("mmui::MainWindow", "微信"),
        _FakeWindow("Chrome_WidgetWin_1", "Google Chrome"),
    ])
    result = find_weixin.login_window_present()
    assert result is False


# ─── is_privacy_locked ────────────────────────────────────────────────────────


def test_is_privacy_locked_returns_true_for_login_window_titled_weixin():
    """隐私锁屏（mmui::LoginWindow title='微信'）→ is_privacy_locked()=True。"""
    _set_windows([
        _FakeWindow("Shell_TrayWnd", "任务栏"),
        _FakeWindow("mmui::LoginWindow", "微信"),
    ])
    result = find_weixin.is_privacy_locked()
    assert result is True, "mmui::LoginWindow title='微信' 应被识别为隐私锁屏"


def test_is_privacy_locked_returns_false_when_real_login():
    """真正未登录界面（title='登录'）→ is_privacy_locked()=False。"""
    _set_windows([
        _FakeWindow("mmui::LoginWindow", "登录"),
    ])
    result = find_weixin.is_privacy_locked()
    assert result is False, "真正未登录界面 title='登录' 不是隐私锁，应返回 False"


def test_is_privacy_locked_returns_false_when_main_window_visible():
    """主窗口可见时（无 LoginWindow）→ is_privacy_locked()=False。"""
    _set_windows([
        _FakeWindow("mmui::MainWindow", "微信"),
    ])
    result = find_weixin.is_privacy_locked()
    assert result is False


def test_is_privacy_locked_returns_false_when_no_windows():
    """无窗口时 → is_privacy_locked()=False。"""
    _set_windows([])
    result = find_weixin.is_privacy_locked()
    assert result is False
