# -*- coding: utf-8 -*-
"""
Regression test —— 回复态屏内可见不变量 + _open_chat 每次重试前幽灵态复查
（2026-07-18 真机幽灵坐标实锤，根治"最小化也静默回复"与"24秒切不到会话"两症状）。

## 结构性根因（本 sprint 之前五个补丁都没打中的同一个问题）

主循环每轮的真实执行序列是：扫描先跑 `_ensure_tray_visible()`（扫描态），把
托盘/最小化窗口弹出并挪到屏外、保持常驻隐身；随后同一轮里 `reply_in_chat` 再调
`_ensure_tray_visible(for_reply=True)`——此刻窗口已处于"可见但在屏外"状态，落入
"可见"分支，而该分支对回复态是**空操作**。结果：

1. "静默回复"：用户把微信最小化后，扫描把窗口弄成屏外可见 → 回复全程发生在
   屏外，PR #1383 修的托盘分支在真实流程里根本执行不到（回复时窗口从不处于
   托盘态）。
2. "24 秒切不到会话"：回复中途窗口被上一轮的收窗竞态收回最小化（本体停在幽灵
   坐标 -32000），item 坐标缓存在旧值 → `ScreenToClient` 算出 client=(3xxxx,3xxxx)
   幽灵点击坐标（真机日志 (30153,32228)，复现实测 (32352,32168)，数学上就是
   旧 item 坐标 − (-32000)）→ 三次点击全点在虚空，`_open_chat` 的幽灵检查只在
   循环开头查一次、重试中不复查，24 秒全灭。

## 修法（不变量式，不是第六个分支补丁）

1. `_ensure_onscreen_for_reply(hwnd)`：回复态（OFFSCREEN_REPLY=False）发送前窗口
   必须屏内可见——不管进入时是最小化/幽灵/屏外/隐藏，统一收口在这一个函数，
   在 `reply_in_chat` 里 `_ensure_tray_visible` 之后调用，不再依赖各分支副作用。
2. `_refresh_ghost_item(mw, item, sender, main_hwnd)`：窗口幽灵/最小化恢复 +
   item 幽灵坐标重扫，`_open_chat` **每次重试前**都调（不是只在循环开头一次）。

本文件是这两个症状的永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

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


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had_windll:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


# 禁止 del sys.modules 重导入（2026-07-03 教训，见 test_tray_flash_fix.py 注释）。
import listen_chat  # noqa: E402


def _fill_rect(left, top=60):
    def _side_effect(h, rect_byref):
        rect_byref._obj.left = left
        rect_byref._obj.top = top
        rect_byref._obj.right = left + 400
        rect_byref._obj.bottom = top + 400
        return 1
    return _side_effect


def _fill_animation_info(min_animate: int):
    def _side_effect(action, size, byref_ptr, fWinIni):
        byref_ptr._obj.iMinAnimate = min_animate
        return 1
    return _side_effect


# ─────────────────────────────────────────────────────────────────────────────
# ① _ensure_onscreen_for_reply：回复态屏内可见不变量
# ─────────────────────────────────────────────────────────────────────────────


def test_onscreen_invariant_restores_iconic_ghost_window():
    """最小化（幽灵 -32000）窗口 → 必须 ShowWindow(4) 还原 + 挪回屏内坐标。

    真机实锤：窗口本体 (-32000,-32000)、item 缓存旧坐标 → 幽灵点击坐标 (3xxxx,3xxxx)。
    """
    HWND = 990
    user32 = MagicMock()
    user32.IsIconic.return_value = 1
    user32.IsWindowVisible.return_value = 1
    user32.GetWindowRect.side_effect = _fill_rect(left=-32000, top=-32000)
    user32.SystemParametersInfoW.side_effect = _fill_animation_info(1)

    listen_chat._saved_visible_pos.pop(HWND, None)
    with _mock_windll(user32), patch("time.sleep"):
        listen_chat._ensure_onscreen_for_reply(HWND)

    show_calls = [c[0] for c in user32.ShowWindow.call_args_list]
    assert (HWND, 4) in show_calls, "最小化窗口必须 ShowWindow(SW_SHOWNOACTIVATE=4) 还原"
    user32.SetWindowPos.assert_called()
    x = user32.SetWindowPos.call_args[0][2]
    assert -2000 < x < 20000, f"必须挪回屏内坐标，实际 X={x}"


def test_onscreen_invariant_moves_scan_offscreen_window_back():
    """扫描态留在屏外(-2600)的可见窗口（真实回复路径的实际状态）→ 必须挪回
    _saved_visible_pos 记录的位置。这是"最小化也静默回复"的核心回归锚点。"""
    HWND = 991
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    user32.IsWindowVisible.return_value = 1
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    listen_chat._saved_visible_pos[HWND] = (321, 234)
    try:
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_onscreen_for_reply(HWND)
    finally:
        listen_chat._saved_visible_pos.pop(HWND, None)

    user32.SetWindowPos.assert_called()
    args = user32.SetWindowPos.call_args[0]
    assert (args[2], args[3]) == (321, 234)


def test_onscreen_invariant_noop_when_already_onscreen():
    """窗口已在屏内可见 → 不动任何东西（不产生多余的窗口操作/闪动）。"""
    HWND = 992
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    user32.IsWindowVisible.return_value = 1
    user32.GetWindowRect.side_effect = _fill_rect(left=200)

    listen_chat._saved_visible_pos.pop(HWND, None)
    with _mock_windll(user32), patch("time.sleep"):
        listen_chat._ensure_onscreen_for_reply(HWND)

    user32.SetWindowPos.assert_not_called()
    user32.ShowWindow.assert_not_called()


def test_onscreen_invariant_default_position_when_no_saved_pos():
    """无历史记录时退回安全屏内默认位置，不能留在屏外。"""
    HWND = 993
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    user32.IsWindowVisible.return_value = 1
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    listen_chat._saved_visible_pos.pop(HWND, None)
    with _mock_windll(user32), patch("time.sleep"):
        listen_chat._ensure_onscreen_for_reply(HWND)

    user32.SetWindowPos.assert_called()
    x, y = user32.SetWindowPos.call_args[0][2], user32.SetWindowPos.call_args[0][3]
    assert x > -2000 and y > -2000, f"默认位置必须在屏内，实际 ({x},{y})"


# ─────────────────────────────────────────────────────────────────────────────
# ② _refresh_ghost_item：_open_chat 每次重试前的幽灵态复查
# ─────────────────────────────────────────────────────────────────────────────


def _make_item(name="默忆", left=100, top=120):
    item = MagicMock()
    r = MagicMock()
    r.left, r.top, r.right, r.bottom = left, top, left + 500, top + 90
    item.rectangle.return_value = r
    item.element_info.name = name
    return item


def test_refresh_ghost_item_restores_minimized_window():
    """窗口本体中途被收窗竞态最小化 → 必须 ShowWindow(4) 还原，点击才有意义。"""
    user32 = MagicMock()
    user32.IsIconic.return_value = 1
    user32.SystemParametersInfoW.side_effect = _fill_animation_info(1)
    mw = MagicMock()
    mw.descendants.return_value = []
    item = _make_item()

    with _mock_windll(user32), patch("time.sleep"):
        listen_chat._refresh_ghost_item(mw, item, "默忆", 995)

    show_calls = [c[0] for c in user32.ShowWindow.call_args_list]
    assert (995, 4) in show_calls, "窗口最小化时必须 ShowWindow(4) 还原"


def test_refresh_ghost_item_rescans_when_item_rect_ghost():
    """item 坐标幽灵(|坐标|>20000) → Select 激活 + 重扫返回新 item 引用。"""
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    mw = MagicMock()
    stale = _make_item(left=31989, top=32000)
    fresh = _make_item(left=90, top=120)
    fresh.element_info.name = "默忆\n[1条] 你好\n12:00\n"
    mw.descendants.return_value = [fresh]

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._refresh_ghost_item(mw, stale, "默忆", 996)

    assert result is fresh, "幽灵坐标 item 必须被重扫出的新引用替换"


def test_refresh_ghost_item_keeps_item_when_rect_sane():
    """item 坐标正常 → 原样返回，不做多余重扫。"""
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    mw = MagicMock()
    item = _make_item(left=90, top=120)

    with _mock_windll(user32), patch("time.sleep"):
        result = listen_chat._refresh_ghost_item(mw, item, "默忆", 997)

    assert result is item
    mw.descendants.assert_not_called()


def test_open_chat_refreshes_ghost_state_every_attempt():
    """_open_chat 必须在【每次】重试前调 _refresh_ghost_item——旧代码只在循环
    开头查一次，重试中窗口被收窗竞态弄成幽灵态后，后续 PostMessage 全点虚空
    （真机 24 秒三连灭实锤）。"""
    user32 = MagicMock()
    user32.IsIconic.return_value = 0
    mw = MagicMock()
    mw.element_info.handle = 998
    mw.rectangle.side_effect = Exception("no rect")  # _chat_title_matches → None
    item = _make_item()
    item.iface_selection_item.Select.side_effect = Exception("select dead")
    item.iface_selection_item.CurrentIsSelected = False  # 选中态验证恒不命中
    item.iface_invoke.Invoke.side_effect = Exception("invoke dead")

    calls = []
    original_refresh = getattr(listen_chat, "_refresh_ghost_item", None)

    def _counting_refresh(mw_, item_, sender_, hwnd_):
        calls.append(1)
        return item_

    listen_chat._refresh_ghost_item = _counting_refresh
    try:
        with _mock_windll(user32), patch("time.sleep"):
            ok = listen_chat._open_chat(mw, item, "默忆")
    finally:
        if original_refresh is not None:
            listen_chat._refresh_ghost_item = original_refresh

    assert ok is False
    assert len(calls) == listen_chat._OPEN_CHAT_MAX_ATTEMPTS, (
        f"每次重试前都必须复查幽灵态，期望 {listen_chat._OPEN_CHAT_MAX_ATTEMPTS} 次，"
        f"实际 {len(calls)} 次"
    )


# ─────────────────────────────────────────────────────────────────────────────
# ③ reply_in_chat 接线：回复态必须调用屏内可见不变量
# ─────────────────────────────────────────────────────────────────────────────


def test_reply_in_chat_enforces_onscreen_invariant_when_visible_reply():
    """OFFSCREEN_REPLY=False（B 方案默认）时 reply_in_chat 必须调用
    _ensure_onscreen_for_reply——这是把"分支副作用"收口成"单一不变量"的接线锚点。"""
    mw = MagicMock()
    mw.element_info.handle = 999
    item = MagicMock()

    called = []
    original_helper = getattr(listen_chat, "_ensure_onscreen_for_reply", None)
    original_offscreen = listen_chat._OFFSCREEN_REPLY

    def _spy(hwnd):
        called.append(hwnd)

    listen_chat._ensure_onscreen_for_reply = _spy
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with patch.object(listen_chat, "_ensure_tray_visible", return_value=""), \
             patch.object(listen_chat, "_restore_window_state"), \
             patch.object(listen_chat, "_open_chat", return_value=False), \
             patch.object(listen_chat, "_get_foreground_window", return_value=0), \
             patch("time.sleep"):
            listen_chat.reply_in_chat(mw, item, "test", sender="默忆")
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        if original_helper is not None:
            listen_chat._ensure_onscreen_for_reply = original_helper

    assert called, "回复态(OFFSCREEN_REPLY=False)必须调用 _ensure_onscreen_for_reply"
