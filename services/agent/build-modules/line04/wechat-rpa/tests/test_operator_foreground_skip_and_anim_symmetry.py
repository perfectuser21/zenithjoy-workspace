# -*- coding: utf-8 -*-
"""
Regression test —— 操作者前台使用微信时扫描仍挪窗口导致肉眼可见闪烁（真机反馈 2026-07-18）。

真机反馈原话："每两三秒闪一次，或一两秒闪一次。这个东西是人能够发现的" —— 操作者
正打开着微信在用（可见非最小化，且就是当前前台窗口），但 `_ensure_tray_visible` 的
"可见非最小化"分支不管操作者是否在用都无条件挪坐标屏外再挪回，每次扫描周期
（1-3 秒一次）都产生一次可见的窗口消失/跳动。

根因：UIA 读取一个已经可见、非最小化的窗口本不需要挪动位置（挪坐标只对救活
tray/minimized 这种真正隐藏、读不到内容的窗口有意义）；操作系统语义上 tray/minimized
窗口不可能同时是前台窗口，所以"操作者是否前台"这个判断只对"可见非最小化"分支
有实际影响，不会误伤另外两个分支。

修法：
  1. `_ensure_tray_visible` 顶部加前台判断，操作者前台时整个函数直接 no-op（不挪窗口）。
  2. 最小化分支"恢复到离屏坐标"这一步（ShowWindow(4)）与 `_restore_window_state`
     的"离屏→再最小化"对称，同样临时关闭系统最小化动画，避免任务栏→离屏路径经过
     屏内可见区域产生可渲染过渡帧。

本文件是这两处回归的永久 regression test，禁止删除。
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


def _make_mock_mw(hwnd: int = 950):
    mw = MagicMock()
    mw.element_info.handle = hwnd
    mw.descendants.return_value = []
    return mw


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
# ① 操作者前台使用微信时，_ensure_tray_visible 必须整个 no-op
# ─────────────────────────────────────────────────────────────────────────────


def test_ensure_tray_visible_noop_when_operator_is_foreground():
    """可见非最小化 + 操作者前台 → 不挪窗口，直接返回 ''（真机反馈：肉眼可见闪烁）。"""
    HWND = 951
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0
    user32.GetForegroundWindow.return_value = HWND  # 操作者正在用这个窗口

    with _mock_windll(user32), __import__("unittest.mock", fromlist=["patch"]).patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)

    assert result == "", f"操作者前台时必须 no-op，实际返回 {result!r}"
    user32.SetWindowPos.assert_not_called()
    user32.GetWindowRect.assert_not_called()


def test_ensure_tray_visible_still_moves_when_visible_but_not_foreground():
    """可见非最小化 + 操作者不在用（不是前台窗口）→ 维持原行为，正常挪坐标屏外。

    回归保护：确认①的 no-op 判断没有误伤"窗口可见但操作者没在看"的正常场景
    （比如窗口被切到后台、或某些系统状态下短暂可见）。
    """
    HWND = 952
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0
    user32.GetForegroundWindow.return_value = HWND + 1  # 前台是别的窗口

    def _fill(h, rect_byref):
        rect_byref._obj.left = 300
        rect_byref._obj.top = 100
        return 1
    user32.GetWindowRect.side_effect = _fill

    with _mock_windll(user32), __import__("unittest.mock", fromlist=["patch"]).patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)
        listen_chat._saved_visible_pos.pop(HWND, None)

    assert result == "visible"
    user32.SetWindowPos.assert_called()


def test_ensure_tray_visible_noop_check_does_not_affect_minimized_branch():
    """回归保护：最小化窗口不可能同时是前台窗口，① 的判断不应影响 minimized 分支正常挪坐标。"""
    HWND = 953
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1
    user32.GetForegroundWindow.return_value = HWND + 999  # 不可能是自己（已最小化）

    def _fill_wp(hwnd, wp_byref):
        obj = wp_byref._obj
        obj.flags = 0
        obj.showCmd = 2
        obj.rcLeft, obj.rcTop, obj.rcRight, obj.rcBottom = (60, 60, 500, 480)
        return 1
    user32.GetWindowPlacement.side_effect = _fill_wp
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    with _mock_windll(user32), __import__("unittest.mock", fromlist=["patch"]).patch("time.sleep"):
        result = listen_chat._ensure_tray_visible(mw)
        listen_chat._saved_normal_pos.pop(HWND, None)

    assert result == "minimized"
    user32.SetWindowPlacement.assert_called()


# ─────────────────────────────────────────────────────────────────────────────
# ② 恢复到离屏坐标这一步（ShowWindow(4)）也临时关闭最小化动画（与 restore 对称）
# ─────────────────────────────────────────────────────────────────────────────


def test_ensure_tray_visible_minimized_toggles_animation_around_restore():
    """ShowWindow(4)（恢复到离屏坐标）前后必须临时关闭/恢复系统最小化动画——
    否则任务栏(屏内)→离屏目标 的动画路径会经过屏内可见区域产生可渲染过渡帧。"""
    HWND = 954
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 1
    user32.GetForegroundWindow.return_value = HWND + 999

    call_order: list = []
    user32.SystemParametersInfoW.side_effect = lambda *a: (
        call_order.append(("anim", a[0])) or _fill_animation_info(1)(*a)
    )
    user32.ShowWindow.side_effect = lambda *a: call_order.append(("show", a[1]))

    def _fill_wp(hwnd, wp_byref):
        obj = wp_byref._obj
        obj.flags = 0
        obj.showCmd = 2
        obj.rcLeft, obj.rcTop, obj.rcRight, obj.rcBottom = (60, 60, 500, 480)
        return 1
    user32.GetWindowPlacement.side_effect = _fill_wp
    user32.GetWindowRect.side_effect = _fill_rect(left=-2600)

    with _mock_windll(user32), __import__("unittest.mock", fromlist=["patch"]).patch("time.sleep"):
        listen_chat._ensure_tray_visible(mw)
        listen_chat._saved_normal_pos.pop(HWND, None)

    SPI_GETANIMATION, SPI_SETANIMATION = 0x0048, 0x0049
    anim_actions = [a for kind, a in call_order if kind == "anim"]
    show_positions = [i for i, (kind, a) in enumerate(call_order) if kind == "show" and a == 4]
    set_anim_positions = [i for i, (kind, a) in enumerate(call_order) if kind == "anim" and a == SPI_SETANIMATION]

    assert SPI_GETANIMATION in anim_actions, "必须先读当前动画设置以便稍后还原"
    assert SPI_SETANIMATION in anim_actions, "必须临时关闭/还原动画设置"
    assert show_positions, "必须调 ShowWindow(SW_SHOWNOACTIVATE=4)"
    assert set_anim_positions, "必须调用过 SPI_SETANIMATION"
    assert set_anim_positions[0] < show_positions[0], "关动画必须在 ShowWindow(4) 之前"
