# -*- coding: utf-8 -*-
"""
Regression test —— 最小化窗口离屏还原被 WPF_RESTORETOMAXIMIZED 吞掉（decision 433b117c）。

根因（2026-07-18 xian-rog 真机 WinAPI 高频轮询铁证）：微信窗口一旦被最大化过，
WINDOWPLACEMENT.flags 就带 WPF_RESTORETOMAXIMIZED。_ensure_tray_visible 的 minimized
分支用 SetWindowPlacement 把 rcNormalPosition 改到离屏坐标后调 ShowWindow(SW_SHOWNOACTIVATE)，
但只要该 flag 还在，Windows 还原时直接按最大化展开，完全无视刚设的离屏坐标——窗口整屏
可见（真机 rect 与显示器 work area 吻合，20 秒内复现 2 次）。即使清掉该 flag，
SetWindowPlacement 对 rcLeft 仍可能被 Windows 钳制贴边（真机实测 X 被夹到 0）。

修法：
  1. SetWindowPlacement 前清掉 WPF_RESTORETOMAXIMIZED + 强制 showCmd=SW_SHOWNORMAL
     （_neutralize_maximize_restore 纯函数）。
  2. ShowWindow(4) 后读 GetWindowRect 校验，仍在屏内就补一次 SetWindowPos（不受钳制）。
  3. _saved_normal_pos 扩展保存原始 flags/showCmd，_restore_window_state 真还原时用
     原始值写回（不能让"为隐藏做的临时调整"变成永久改动）。
  4. _restore_window_state 的 minimized 分支从离屏坐标 ShowWindow(SW_MINIMIZE) 会让
     最小化动画从离屏动画到任务栏（屏内）——临时关闭 SPI_SETANIMATION 避免中间可见帧，
     操作后立即恢复。

本文件是"最小化态离屏隐藏失效"bug 的永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock

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

WPF_RESTORETOMAXIMIZED = 0x0002
SW_SHOWNORMAL = 1
SW_SHOWMINIMIZED = 2


def _make_mock_mw(hwnd: int = 900):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


def _fill_window_placement(rect, flags, show_cmd):
    """构造 GetWindowPlacement 的 side_effect：把 rect/flags/showCmd 写进调用方传入的
    byref(_WP()) 指针指向的结构体（同 test_visible_bg_fix.py 的 `_obj` 内部接口手法）。"""
    def _side_effect(hwnd, wp_byref):
        obj = wp_byref._obj
        obj.flags = flags
        obj.showCmd = show_cmd
        obj.rcLeft, obj.rcTop, obj.rcRight, obj.rcBottom = rect
        return 1
    return _side_effect


def _capture_window_placement(sink: dict):
    """构造 SetWindowPlacement 的 side_effect：把调用方写入的 wp 字段记录到 sink。"""
    def _side_effect(hwnd, wp_byref):
        obj = wp_byref._obj
        sink["flags"] = obj.flags
        sink["showCmd"] = obj.showCmd
        sink["rect"] = (obj.rcLeft, obj.rcTop, obj.rcRight, obj.rcBottom)
        return 1
    return _side_effect


def _fill_rect(left):
    def _side_effect(h, rect_byref):
        rect_byref._obj.left = left
        rect_byref._obj.top = 60
        return 1
    return _side_effect


def _fill_animation_info(min_animate: int):
    def _side_effect(action, size, byref_ptr, fWinIni):
        byref_ptr._obj.iMinAnimate = min_animate
        return 1
    return _side_effect


# ─────────────────────────────────────────────────────────────────────────────
# 纯函数：_neutralize_maximize_restore
# ─────────────────────────────────────────────────────────────────────────────


def test_neutralize_maximize_restore_clears_flag():
    """WPF_RESTORETOMAXIMIZED 位必须被清掉，否则还原时直接按最大化展开。"""
    new_flags, _ = listen_chat._neutralize_maximize_restore(
        flags=WPF_RESTORETOMAXIMIZED, show_cmd=SW_SHOWMINIMIZED)
    assert not (new_flags & WPF_RESTORETOMAXIMIZED), (
        "WPF_RESTORETOMAXIMIZED 必须被清掉，否则 ShowWindow(SW_SHOWNOACTIVATE) 会"
        "无视离屏坐标直接按最大化还原（真机铁证 433b117c）"
    )


def test_neutralize_maximize_restore_forces_show_normal():
    """showCmd 必须强制为 SW_SHOWNORMAL，确保按 rcNormalPosition 还原。"""
    _, new_show_cmd = listen_chat._neutralize_maximize_restore(
        flags=WPF_RESTORETOMAXIMIZED, show_cmd=SW_SHOWMINIMIZED)
    assert new_show_cmd == SW_SHOWNORMAL


def test_neutralize_maximize_restore_preserves_other_flags():
    """WPF_RESTORETOMAXIMIZED 以外的其它 flag 位必须原样保留（不过度清理）。"""
    WPF_SETMINPOSITION = 0x0001
    combined = WPF_RESTORETOMAXIMIZED | WPF_SETMINPOSITION
    new_flags, _ = listen_chat._neutralize_maximize_restore(flags=combined, show_cmd=2)
    assert new_flags & WPF_SETMINPOSITION, "不应清掉 WPF_RESTORETOMAXIMIZED 以外的其它 flag"
    assert not (new_flags & WPF_RESTORETOMAXIMIZED)


def test_neutralize_maximize_restore_noop_when_flag_absent():
    """flags 本就没有 WPF_RESTORETOMAXIMIZED 时，不应引入该位（幂等/无副作用）。"""
    new_flags, new_show_cmd = listen_chat._neutralize_maximize_restore(flags=0, show_cmd=2)
    assert new_flags == 0
    assert new_show_cmd == SW_SHOWNORMAL


# ─────────────────────────────────────────────────────────────────────────────
# _ensure_tray_visible 的 minimized 分支：清 flag + SetWindowPos 兜底
# ─────────────────────────────────────────────────────────────────────────────


def test_ensure_tray_visible_minimized_clears_maximize_flag_before_setplacement():
    """GetWindowPlacement 报出的 flags 带 WPF_RESTORETOMAXIMIZED 时，
    SetWindowPlacement 实际写回的 flags 必须已清掉该位、showCmd 强制 SW_SHOWNORMAL。

    这是本次 bug 的核心回归锚点：清了这一步，真机才不会被最大化还原吞掉离屏坐标。
    """
    HWND = 901
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1

    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(67, 67, 502, 490), flags=WPF_RESTORETOMAXIMIZED, show_cmd=SW_SHOWMINIMIZED)
    captured: dict = {}
    user32.SetWindowPlacement.side_effect = _capture_window_placement(captured)
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)  # 已离屏，SetWindowPos 兜底不触发

    import time as _time_mod
    orig_sleep = _time_mod.sleep
    _time_mod.sleep = lambda *_a, **_kw: None
    try:
        with _mock_windll(user32):
            result = listen_chat._ensure_tray_visible(mw)
    finally:
        _time_mod.sleep = orig_sleep
        listen_chat._saved_normal_pos.pop(HWND, None)

    assert result == "minimized"
    assert captured, "SetWindowPlacement 必须被调用"
    assert not (captured["flags"] & WPF_RESTORETOMAXIMIZED), (
        "SetWindowPlacement 写回的 flags 必须已清掉 WPF_RESTORETOMAXIMIZED"
    )
    assert captured["showCmd"] == SW_SHOWNORMAL
    assert captured["rect"][0] == listen_chat._OFFSCREEN_X


def test_ensure_tray_visible_minimized_saves_original_flags_and_showcmd():
    """_saved_normal_pos 必须保存原始 flags/showCmd（6 元组），供 _restore_window_state
    真正还原用户原始最大化偏好，而不是永久留在"被清过的"状态。"""
    HWND = 902
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1

    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(10, 20, 630, 622), flags=WPF_RESTORETOMAXIMIZED, show_cmd=SW_SHOWMINIMIZED)
    user32.SetWindowPlacement.side_effect = _capture_window_placement({})
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    import time as _time_mod
    orig_sleep = _time_mod.sleep
    _time_mod.sleep = lambda *_a, **_kw: None
    try:
        with _mock_windll(user32):
            listen_chat._ensure_tray_visible(mw)
        saved = listen_chat._saved_normal_pos.get(HWND)
    finally:
        _time_mod.sleep = orig_sleep
        listen_chat._saved_normal_pos.pop(HWND, None)

    assert saved is not None
    assert len(saved) == 6, f"_saved_normal_pos 必须是 6 元组 (l,t,r,b,flags,showCmd)，实际 {saved!r}"
    assert saved[0:4] == (10, 20, 630, 622)
    assert saved[4] == WPF_RESTORETOMAXIMIZED, "必须保存清理前的原始 flags"
    assert saved[5] == SW_SHOWMINIMIZED, "必须保存清理前的原始 showCmd"


def test_ensure_tray_visible_minimized_setwindowpos_fallback_when_still_onscreen():
    """SetWindowPlacement 还原后，若 GetWindowRect 校验仍在屏内（钳制/未生效），
    必须补一次 SetWindowPos 强制挪走（真机实测 SetWindowPlacement 对 rcLeft 会被夹到 0）。
    """
    HWND = 903
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1

    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(767, 400, 942, 597), flags=WPF_RESTORETOMAXIMIZED, show_cmd=SW_SHOWMINIMIZED)
    user32.SetWindowPlacement.side_effect = _capture_window_placement({})
    # 还原后仍在屏内（模拟真机实测 X 被钳制到 0 的情形）
    user32.GetWindowRect.side_effect = _fill_rect(left=0)

    import time as _time_mod
    orig_sleep = _time_mod.sleep
    _time_mod.sleep = lambda *_a, **_kw: None
    try:
        with _mock_windll(user32):
            listen_chat._ensure_tray_visible(mw)
    finally:
        _time_mod.sleep = orig_sleep
        listen_chat._saved_normal_pos.pop(HWND, None)

    user32.SetWindowPos.assert_called()
    call_args = user32.SetWindowPos.call_args[0]
    assert call_args[2] == listen_chat._OFFSCREEN_X
    assert call_args[3] == listen_chat._OFFSCREEN_Y


def test_ensure_tray_visible_minimized_no_setwindowpos_fallback_when_already_offscreen():
    """还原后 GetWindowRect 已确认离屏时，不应画蛇添足再调 SetWindowPos（避免多余抖动）。"""
    HWND = 904
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1

    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(50, 50, 450, 450), flags=0, show_cmd=SW_SHOWMINIMIZED)
    user32.SetWindowPlacement.side_effect = _capture_window_placement({})
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)  # 已离屏

    import time as _time_mod
    orig_sleep = _time_mod.sleep
    _time_mod.sleep = lambda *_a, **_kw: None
    try:
        with _mock_windll(user32):
            listen_chat._ensure_tray_visible(mw)
    finally:
        _time_mod.sleep = orig_sleep
        listen_chat._saved_normal_pos.pop(HWND, None)

    user32.SetWindowPos.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# _restore_window_state 的 minimized 分支：还原原始 flags/showCmd + 动画临时关闭
# ─────────────────────────────────────────────────────────────────────────────


def test_restore_window_state_minimized_restores_original_flags_and_showcmd():
    """_restore_window_state('minimized') 必须把 _saved_normal_pos 里保存的**原始**
    flags/showCmd 写回（而不是清理过的版本），否则用户的最大化偏好被永久篡改。"""
    HWND = 905
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    listen_chat._saved_normal_pos[HWND] = (10, 20, 630, 622, WPF_RESTORETOMAXIMIZED, SW_SHOWMINIMIZED)

    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(-2600, 60, -2100, 460), flags=0, show_cmd=SW_SHOWNORMAL)
    captured: dict = {}
    user32.SetWindowPlacement.side_effect = _capture_window_placement(captured)
    user32.SystemParametersInfoW.side_effect = _fill_animation_info(1)

    try:
        with _mock_windll(user32):
            listen_chat._restore_window_state(mw, "minimized")
    finally:
        listen_chat._saved_normal_pos.pop(HWND, None)

    assert captured, "SetWindowPlacement 必须被调用以还原原始位置"
    assert captured["rect"] == (10, 20, 630, 622)
    assert captured["flags"] == WPF_RESTORETOMAXIMIZED, "必须还原用户原始的 WPF_RESTORETOMAXIMIZED 偏好"
    assert captured["showCmd"] == SW_SHOWMINIMIZED, "必须还原用户原始的 showCmd"


def test_restore_window_state_minimized_toggles_animation_around_minimize():
    """从离屏坐标 ShowWindow(SW_MINIMIZE) 前必须临时关闭系统级最小化动画，
    操作后必须恢复原值——否则最小化动画会把窗口从离屏动画穿过屏内可见区域。"""
    HWND = 906
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    listen_chat._saved_normal_pos[HWND] = (10, 20, 630, 622, 0, SW_SHOWNORMAL)

    call_order: list = []
    user32.SystemParametersInfoW.side_effect = lambda *a: (
        call_order.append(("anim", a[0])) or _fill_animation_info(1)(*a)
    )
    user32.ShowWindow.side_effect = lambda *a: call_order.append(("show", a[1]))
    user32.GetWindowPlacement.side_effect = _fill_window_placement(
        rect=(-2600, 60, -2100, 460), flags=0, show_cmd=SW_SHOWNORMAL)
    user32.SetWindowPlacement.side_effect = _capture_window_placement({})

    try:
        with _mock_windll(user32):
            listen_chat._restore_window_state(mw, "minimized")
    finally:
        listen_chat._saved_normal_pos.pop(HWND, None)

    SPI_GETANIMATION, SPI_SETANIMATION = 0x0048, 0x0049
    anim_actions = [a for kind, a in call_order if kind == "anim"]
    show_calls = [a for kind, a in call_order if kind == "show"]
    assert SPI_GETANIMATION in anim_actions, "必须先读当前动画设置以便稍后还原"
    assert SPI_SETANIMATION in anim_actions, "必须临时关闭/还原动画设置"
    assert 6 in show_calls, "必须调 ShowWindow(SW_MINIMIZE=6)"
    # 关动画（SPI_SETANIMATION 第一次出现）必须在 ShowWindow(6) 之前
    set_positions = [i for i, (kind, a) in enumerate(call_order) if kind == "anim" and a == SPI_SETANIMATION]
    show_positions = [i for i, (kind, a) in enumerate(call_order) if kind == "show" and a == 6]
    assert set_positions and show_positions
    assert set_positions[0] < show_positions[0], "关动画必须在 ShowWindow(SW_MINIMIZE) 之前"
