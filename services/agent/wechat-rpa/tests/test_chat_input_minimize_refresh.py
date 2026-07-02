"""
Regression tests: _find_chat_input 最大-Edit 回退；
_uia_send 回退到搜索框时跳过 set_focus；
reply_in_chat 使用剪贴板路径。

根因：WeChat 4.1.8 UIA 树从不暴露 chat_input_field，只有搜索框（area=2960）。
修法（v1.0.11）：
  - _find_chat_input：_iter_all_controls 扫全部 mmui 子窗口，回退到最大面积 Edit。
  - _uia_send：回退 Edit 时跳过 set_focus（避免把焦点移到搜索框），
    用剪贴板+Ctrl+V+Enter，依赖 session Invoke 后 WeChat 自然把光标放在聊天输入框。
"""

import ctypes
import platform
import sys
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


@contextmanager
def _mock_windll(user32=None, kernel32=None):
    u32 = user32 or MagicMock()
    k32 = kernel32 or MagicMock()
    windll_mock = MagicMock(user32=u32, kernel32=k32)
    had = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


def _make_edit_ctrl(aid: str, name: str, area: int, top: int = 300):
    c = MagicMock()
    c.element_info.automation_id = aid
    c.element_info.name = name
    c.element_info.handle = 0
    r = MagicMock()
    w = int(area ** 0.5) or 1
    r.left = 0; r.right = w
    r.top = top; r.bottom = top + w
    c.rectangle.return_value = r
    c.iface_value = MagicMock()
    c.iface_value.GetValue.return_value = ""
    c.get_value = MagicMock(return_value="")
    return c


def _make_main_window(edit_controls, win_top=220, win_bottom=860):
    mw = MagicMock()
    mw.element_info.handle = 12345
    mw.element_info.class_name = "mmui::MainWindow"
    wr = MagicMock()
    wr.top = win_top; wr.bottom = win_bottom
    wr.left = 0; wr.right = 880
    mw.rectangle.return_value = wr

    def descendants(control_type=None):
        if control_type == "Edit":
            return edit_controls
        return []

    mw.descendants.side_effect = descendants
    return mw


# ─────────────────────────────────────────────────────────────────────────────
# Test 1: _find_chat_input 只有搜索框时【中止返回 None】，绝不回退到搜索框
#   （修正 2026-07-02：旧行为"回退最大 Edit=搜索框"是"回复写进搜索框"bug 的根因，
#    详见 test_find_chat_input_no_search_fallback.py 的根因说明）
# ─────────────────────────────────────────────────────────────────────────────
def test_find_chat_input_aborts_when_only_search_box():
    """只有顶部搜索框（上半区、无下半区聊天输入框）→ 返回 None，绝不把搜索框当输入框。

    根因：_uia_send 对返回的 Edit 直接 SetValue；若回退搜索框 → 回复被写进搜索栏白发。
    健康态下半区必有真输入框，此中止路径不触发；脏态中止后 reply_in_chat 下轮重试。
    """
    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)  # top=266 上半区
    mw = _make_main_window([search_box], win_top=220, win_bottom=860)

    with _mock_windll():
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        result = lc._find_chat_input(mw)

    assert result is None, "下半区无聊天输入框时必须中止（None），绝不回退到顶部搜索框"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: _uia_send 回退 Edit 时不调用 set_focus
# ─────────────────────────────────────────────────────────────────────────────
def test_uia_send_skips_set_focus_for_fallback_edit():
    """uia_edit.automation_id 不是 chat_input_field 时，_uia_send 绝不调用 set_focus。
    这样 session Invoke 后 WeChat 自然把焦点放在聊天输入框，Ctrl+V 粘贴到正确位置。"""
    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)
    mw = _make_main_window([search_box])

    set_focus_called = []

    def capture_set_focus():
        set_focus_called.append(True)

    search_box.set_focus = capture_set_focus

    u32 = MagicMock()
    u32.IsIconic.return_value = False
    u32.GetForegroundWindow.return_value = 12345  # 模拟前台拉到 WeChat

    with _mock_windll(user32=u32):
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        with patch.object(lc, "_set_clipboard_text", return_value=True):
            with patch.object(lc, "_force_foreground"):
                with patch("time.sleep"):
                    lc._uia_send(search_box, mw, "hello")

    assert not set_focus_called, (
        "_uia_send 不能对回退 Edit（搜索框）调用 set_focus，"
        "否则会把焦点从聊天输入框移到搜索框"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: reply_in_chat 使用剪贴板路径并成功发送
# ─────────────────────────────────────────────────────────────────────────────
def test_reply_in_chat_succeeds_via_clipboard_path():
    """_find_chat_input 返回搜索框（fallback），剪贴板+Enter 路径成功后 replied=True。"""
    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)
    mw = _make_main_window([search_box])
    item = MagicMock()

    with _mock_windll():
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        with patch.object(lc, "_find_chat_input", return_value=search_box):
            with patch.object(lc, "_uia_send", return_value=True) as mock_send:
                with patch("time.sleep"):
                    result = lc.reply_in_chat(mw, item, "test reply", sender="")

    assert result is True, "剪贴板路径成功后 reply_in_chat 必须返回 True"
    mock_send.assert_called_once_with(search_box, mw, "test reply")
