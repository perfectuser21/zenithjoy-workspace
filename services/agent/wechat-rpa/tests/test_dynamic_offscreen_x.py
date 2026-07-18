# -*- coding: utf-8 -*-
"""
Regression test —— 离屏 X 用启动时的固定假设宽度(1200px)算死，最大化窗口更宽导致
右边缘露出屏幕（真机实时反馈，2026-07-18）。

真机反馈原话："你现在的 ROG 又是一个最大化的，过两秒它在左边...但它没有移出屏幕外"。

根因：模块级 `_OFFSCREEN_X` 是 `compute_offscreen_x(win_width=1200)` 在**模块加载时**
算好的固定常量（ROG 单屏 vleft=0 时 = -1400）。窗口若处于最大化态（真机实测宽度约
1707px），挪窗口时仍用这个假设 1200px 算出的 -1400——窗口右边缘落在
-1400+1707=307，屏幕左侧 307px 那一块露出来。窗口越宽，固定偏移量越不够用。

修法：`_safe_offscreen_x(width)` 每次挪窗口前用**这一次实际的窗口宽度**重新推导，
取现算值与模块级常量中更负的一个（双保险）。_ensure_tray_visible 的三个分支
（tray/minimized/visible）+ _uia_send 共 5 处 SetWindowPos/SetWindowPlacement 调用
全部换用现算值。

本文件是这个 bug 的永久 regression test，禁止删除。
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


def _make_mock_mw(hwnd: int = 970):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


def _fill_rect(left, right):
    def _side_effect(h, rect_byref):
        rect_byref._obj.left = left
        rect_byref._obj.top = 60
        rect_byref._obj.right = right
        rect_byref._obj.bottom = 500
        return 1
    return _side_effect


# ─────────────────────────────────────────────────────────────────────────────
# _safe_offscreen_x 纯函数
# ─────────────────────────────────────────────────────────────────────────────


def test_safe_offscreen_x_uses_actual_width_not_fixed_assumption():
    """真机场景复现：vleft=0 时固定常量 _OFFSCREEN_X=-1400（假设 1200px 推出来的）。
    最大化窗口实际宽度 1707px 时，现算值必须比 -1400 更负，覆盖真实宽度。"""
    original_compute = listen_chat._compute_offscreen_x
    try:
        listen_chat._compute_offscreen_x = lambda win_width=1200: 0 - win_width - 200
        listen_chat._OFFSCREEN_X = 0 - 1200 - 200  # 模拟 ROG 单屏启动时算出的 -1400

        safe_x_maximized = listen_chat._safe_offscreen_x(1707)
        assert safe_x_maximized < listen_chat._OFFSCREEN_X, (
            "最大化宽度(1707)的安全离屏 X 必须比固定假设(1200px推出的-1400)更负"
        )
        # 核心断言：窗口右边缘(safe_x + width)必须真正落在屏幕外(<=0)
        assert safe_x_maximized + 1707 <= 0, (
            f"最大化窗口右边缘必须在屏幕外，实际 safe_x+width={safe_x_maximized + 1707}"
        )
    finally:
        listen_chat._compute_offscreen_x = original_compute


def test_safe_offscreen_x_normal_width_matches_static_constant():
    """普通宽度（≤1200px 假设值）时，现算值应与固定常量一致或更保守，不应该退化变差。"""
    original_compute = listen_chat._compute_offscreen_x
    try:
        listen_chat._compute_offscreen_x = lambda win_width=1200: 0 - win_width - 200
        listen_chat._OFFSCREEN_X = 0 - 1200 - 200
        safe_x = listen_chat._safe_offscreen_x(435)
        assert safe_x + 435 <= 0
    finally:
        listen_chat._compute_offscreen_x = original_compute


def test_safe_offscreen_x_falls_back_on_exception():
    """现算函数异常时 fail-safe 回退模块级常量，不抛出。"""
    original_compute = listen_chat._compute_offscreen_x
    try:
        def _boom(win_width=1200):
            raise RuntimeError("boom")
        listen_chat._compute_offscreen_x = _boom
        listen_chat._OFFSCREEN_X = -2600
        assert listen_chat._safe_offscreen_x(1707) == -2600
    finally:
        listen_chat._compute_offscreen_x = original_compute


# ─────────────────────────────────────────────────────────────────────────────
# 集成：_ensure_tray_visible 三分支挪窗口时使用现算安全值
# ─────────────────────────────────────────────────────────────────────────────


def test_ensure_tray_visible_visible_branch_maximized_window_fully_offscreen():
    """可见非最小化分支：窗口当前是最大化宽度(1707px)时，SetWindowPos 传入的 X
    必须让窗口右边缘真正落在屏幕外，不能用固定的小窗假设值。"""
    HWND = 971
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0
    user32.GetWindowRect.side_effect = _fill_rect(left=0, right=1707)

    original_compute = listen_chat._compute_offscreen_x
    original_offscreen_x = listen_chat._OFFSCREEN_X
    try:
        listen_chat._compute_offscreen_x = lambda win_width=1200: 0 - win_width - 200
        listen_chat._OFFSCREEN_X = 0 - 1200 - 200  # 固定假设值 -1400（bug 复现基线）
        with _mock_windll(user32), patch("time.sleep"):
            result = listen_chat._ensure_tray_visible(mw)
            listen_chat._saved_visible_pos.pop(HWND, None)
    finally:
        listen_chat._compute_offscreen_x = original_compute
        listen_chat._OFFSCREEN_X = original_offscreen_x

    assert result == "visible"
    user32.SetWindowPos.assert_called()
    call_args = user32.SetWindowPos.call_args[0]
    used_x = call_args[2]
    assert used_x + 1707 <= 0, (
        f"最大化窗口(1707px)挪窗口后右边缘必须在屏幕外，实际用的 X={used_x}，"
        f"右边缘={used_x + 1707}（固定假设值 -1400 会算出 307，露出屏幕）"
    )


def test_ensure_tray_visible_minimized_branch_wide_saved_size_fully_offscreen():
    """最小化分支：GetWindowPlacement 读到的原始尺寸是宽窗口(1707px)时，
    SetWindowPlacement 写入的 rcLeft 也必须让右边缘真正落在屏幕外。"""
    HWND = 972
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1

    captured = {}

    def _fill_wp(hwnd, wp_byref):
        obj = wp_byref._obj
        obj.flags = 0
        obj.showCmd = 2
        obj.rcLeft, obj.rcTop, obj.rcRight, obj.rcBottom = (0, 60, 1707, 1019)
        return 1

    def _capture_wp(hwnd, wp_byref):
        obj = wp_byref._obj
        captured["rcLeft"] = obj.rcLeft
        captured["rcRight"] = obj.rcRight
        return 1

    user32.GetWindowPlacement.side_effect = _fill_wp
    user32.SetWindowPlacement.side_effect = _capture_wp
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600, right=-2600 + 1707)

    original_compute = listen_chat._compute_offscreen_x
    original_offscreen_x = listen_chat._OFFSCREEN_X
    try:
        listen_chat._compute_offscreen_x = lambda win_width=1200: 0 - win_width - 200
        listen_chat._OFFSCREEN_X = 0 - 1200 - 200
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
            listen_chat._saved_normal_pos.pop(HWND, None)
    finally:
        listen_chat._compute_offscreen_x = original_compute
        listen_chat._OFFSCREEN_X = original_offscreen_x

    assert captured, "SetWindowPlacement 必须被调用"
    width = captured["rcRight"] - captured["rcLeft"]
    assert captured["rcLeft"] + width <= 0, (
        f"宽窗口(1707px)最小化恢复到离屏坐标后右边缘必须在屏幕外，"
        f"实际 rcLeft={captured['rcLeft']} width={width}"
    )
