"""
Regression tests: _find_chat_input 不能回退到搜索框；
reply_in_chat 找不到 chat_input_field 时必须执行 minimize→SW_SHOWNA 刷新 UIA。

根因：WeChat 4.1.8 后台时 UIA 树只暴露搜索框（mmui::XValidatorTextEdit, name='搜索'）
作为唯一 Edit 控件，chat_input_field 不可见；minimize→SW_SHOWNA 触发刷新后才出现。
诊断证据：probe_chat2_out.txt 确认 area=2960 name='搜索' 是唯一 Edit 控件。
"""

import ctypes
import platform
import sys
import time
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

# ── macOS/Linux 下注入 ctypes.windll stub（避免 ImportError）─────────────────
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
# Test 1: _find_chat_input 搜索框绝不被返回
# ─────────────────────────────────────────────────────────────────────────────
def test_find_chat_input_never_returns_search_box():
    """只有搜索框时，_find_chat_input 必须返回 None，不能返回搜索框。"""
    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)
    mw = _make_main_window([search_box], win_top=220, win_bottom=860)

    with _mock_windll():
        import importlib, types
        # 确保模块以新 windll 加载
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        result = lc._find_chat_input(mw)

    # 搜索框不得被返回
    assert result is None or (
        result.element_info.name != "搜索"
    ), "_find_chat_input 不能回退到搜索框（name='搜索'）"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: reply_in_chat 找不到 chat_input_field 时必须调用 minimize→SW_SHOWNA
# ─────────────────────────────────────────────────────────────────────────────
def test_reply_in_chat_calls_minimize_swshowna_when_input_missing():
    """chat_input_field 缺失时 reply_in_chat 必须 ShowWindow(SW_MINIMIZE=6)
    再 ShowWindow(SW_SHOWNA=8)，绝不调用 ShowWindow(SW_RESTORE=9)。"""
    SW_MINIMIZE = 6
    SW_SHOWNA = 8
    SW_RESTORE = 9

    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)

    call_log = []
    u32 = MagicMock()
    u32.IsIconic.return_value = False

    def show_window(hwnd, cmd):
        call_log.append(("ShowWindow", hwnd, cmd))
        return 1

    u32.ShowWindow.side_effect = show_window

    mw = _make_main_window([search_box])
    item = MagicMock()

    # patch time.sleep 加速测试
    with _mock_windll(user32=u32):
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        with patch.object(lc, "_find_chat_input", side_effect=[None, None, None, None]):
            with patch("time.sleep"):
                lc.reply_in_chat(mw, item, "hello", sender="")

    sw_cmds = [cmd for (_ev, _hwnd, cmd) in call_log if _ev == "ShowWindow"]
    assert SW_RESTORE not in sw_cmds, "禁止调用 SW_RESTORE=9"
    assert SW_MINIMIZE in sw_cmds, "必须调用 SW_MINIMIZE=6 触发 UIA 刷新"
    assert SW_SHOWNA in sw_cmds, "必须调用 SW_SHOWNA=8 无前台还原"
    # minimize 必须在 SW_SHOWNA 之前
    idx_min = next(i for i, (_ev, _hwnd, c) in enumerate(call_log) if c == SW_MINIMIZE)
    idx_show = next(i for i, (_ev, _hwnd, c) in enumerate(call_log) if c == SW_SHOWNA)
    assert idx_min < idx_show, "SW_MINIMIZE 必须在 SW_SHOWNA 之前"


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: minimize→SW_SHOWNA 后找到 chat_input_field → 成功发送
# ─────────────────────────────────────────────────────────────────────────────
def test_reply_in_chat_succeeds_after_minimize_refresh():
    """首轮找不到 chat_input_field，minimize→SW_SHOWNA 后第二轮找到 → 成功发送，
    全程无 SW_RESTORE。"""
    SW_RESTORE = 9

    chat_input = _make_edit_ctrl(aid="chat_input_field", name="", area=70818, top=700)
    search_box = _make_edit_ctrl(aid="", name="搜索", area=2960, top=266)

    call_log = []
    u32 = MagicMock()
    u32.IsIconic.return_value = False
    u32.GetWindowThreadProcessId.return_value = 99
    u32.AttachThreadInput.return_value = True
    u32.SetFocus.return_value = 1
    u32.PostMessageW.return_value = True

    def show_window(hwnd, cmd):
        call_log.append(("ShowWindow", hwnd, cmd))
        return 1

    u32.ShowWindow.side_effect = show_window

    mw = _make_main_window([search_box])
    item = MagicMock()

    # _find_chat_input: 第一次 None（触发 minimize），第二次返回真正输入框
    find_results = [None, chat_input]

    with _mock_windll(user32=u32):
        if "listen_chat" in sys.modules:
            del sys.modules["listen_chat"]
        sys.path.insert(0, str(
            __file__.replace("/tests/test_chat_input_minimize_refresh.py", "")
        ))
        import listen_chat as lc

        with patch.object(lc, "_find_chat_input", side_effect=find_results):
            with patch.object(lc, "_uia_send", return_value=True) as mock_send:
                with patch("time.sleep"):
                    result = lc.reply_in_chat(mw, item, "test reply", sender="")

    assert result is True, "minimize→SW_SHOWNA 后应成功发送"
    mock_send.assert_called_once()
    sw_cmds = [cmd for (_, _, cmd) in call_log]
    assert SW_RESTORE not in sw_cmds, "全程禁止 SW_RESTORE=9"
