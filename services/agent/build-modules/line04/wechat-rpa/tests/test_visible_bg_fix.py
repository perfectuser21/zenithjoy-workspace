"""
Regression test — 微信可见后台（visible-normal）场景离屏修复 v1.0.30。

根因（PR #772 引入）：SPI_SETSCREENREADER 激活 UIA 后，微信不再进系统托盘，
窗口保持"IsWindowVisible=True, IsIconic=False"可见后台状态。
_ensure_tray_visible 只处理 'tray' 和 'minimized' 两种状态，对第三种可见状态
直接返回 ''（不做任何操作）。随后 _open_chat attempt 0 的 Select()/Invoke()
是激活型 UIA 调用，把微信窗口拉到前台 → 用户看到微信出现在屏幕上。

修法 v1.0.30：
  1) _ensure_tray_visible 加 'visible' 分支 —— 可见窗口 SetWindowPos 移到离屏 (-2600,60)，
     返回 'visible'，并把原始坐标存到 _saved_visible_pos。
  2) _restore_window_state('visible') —— SetWindowPos 移回原始坐标。
  3) 版本号 1.0.29 → 1.0.30。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from typing import Any
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

import listen_chat  # noqa: E402  (after stub)


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock())
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
                del ctypes.windll
            except AttributeError:
                pass


def _make_mock_mw(hwnd: int = 77) -> Any:
    mw = MagicMock()
    mw.element_info.handle = hwnd
    return mw


# ─────────────────────────────────────────────────────────────────────────────
# v1.0.30 新测试：visible-normal 状态必须移到离屏
# ─────────────────────────────────────────────────────────────────────────────


def test_ensure_tray_visible_visible_returns_visible():
    """可见非最小化窗口（SPI 激活后常见状态），_OFFSCREEN_REPLY=True 时必须返回 'visible'。

    v1.0.29 bug：此状态返回 ''（不做任何操作）→ _open_chat UIA 调用把窗口拉前台。
    v1.0.30 fix：加 'visible' 分支，移到离屏并返回 'visible'。
    """
    mw = _make_mock_mw(hwnd=201)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    # GetWindowRect 通过 ctypes.byref 传 RECT 指针；用 _obj 属性修改字段值（CPython 内部接口）。
    def _fill_rect(h, rect_byref):
        rect_byref._obj.left = 100
        rect_byref._obj.top = 200
        return 1

    user32.GetWindowRect.side_effect = _fill_rect

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            result = listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        listen_chat._saved_visible_pos.pop(201, None)

    assert result == 'visible', (
        f"可见非最小化窗口 + _OFFSCREEN_REPLY=True 必须返回 'visible'，实际返回 {result!r}"
    )


def test_ensure_tray_visible_visible_moves_to_offscreen():
    """可见非最小化窗口，_OFFSCREEN_REPLY=True 时必须调 SetWindowPos 移到 (-2600, 60)。

    v1.0.29 bug：可见状态没有 SetWindowPos 调用，窗口留在原始屏幕位置。
    v1.0.30 fix：检测到 left > -2000 则 SetWindowPos(-2600, 60, ...)。
    """
    mw = _make_mock_mw(hwnd=202)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    def _fill_rect(h, rect_byref):
        rect_byref._obj.left = 300
        rect_byref._obj.top = 100
        return 1

    user32.GetWindowRect.side_effect = _fill_rect

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        listen_chat._saved_visible_pos.pop(202, None)

    user32.SetWindowPos.assert_called()
    # SetWindowPos(hwnd, hWndInsertAfter, X, Y, cx, cy, uFlags)
    # 参数 0=hwnd, 1=hWndInsertAfter(0), 2=X(配置的 OFFSCREEN_X), 3=Y(60)
    # X 断言【配置生效的 _OFFSCREEN_X】(几何推导值，真机≈-1400)，不写死 -2600
    call_args = user32.SetWindowPos.call_args[0]
    assert call_args[2] == listen_chat._OFFSCREEN_X, \
        f"SetWindowPos X 必须是配置的 OFFSCREEN_X({listen_chat._OFFSCREEN_X})，实际是 {call_args[2]}"
    assert call_args[3] == 60, f"SetWindowPos Y 必须是 60，实际是 {call_args[3]}"


def test_ensure_tray_visible_visible_saves_original_pos():
    """可见非最小化窗口移离屏后，原始坐标必须存入 _saved_visible_pos[hwnd]。

    _restore_window_state 依赖此字典恢复原始位置。
    """
    HWND = 203
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    def _fill_rect(h, rect_byref):
        rect_byref._obj.left = 150
        rect_byref._obj.top = 250
        return 1

    user32.GetWindowRect.side_effect = _fill_rect

    listen_chat._saved_visible_pos.pop(HWND, None)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert HWND in listen_chat._saved_visible_pos, "_saved_visible_pos 必须保存原始坐标"
    orig = listen_chat._saved_visible_pos.pop(HWND)
    assert orig == (150, 250), f"保存的坐标应是 (150, 250)，实际是 {orig}"


def test_ensure_tray_visible_visible_noop_when_offscreen_false():
    """_OFFSCREEN_REPLY=False 时，可见窗口必须返回 ''（不移动）。"""
    mw = _make_mock_mw(hwnd=204)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = False
        with _mock_windll(user32), patch("time.sleep"):
            result = listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert result == '', f"_OFFSCREEN_REPLY=False 时必须返回 ''，实际返回 {result!r}"
    user32.SetWindowPos.assert_not_called()


def test_ensure_tray_visible_visible_already_offscreen_noop():
    """窗口 left <= -2000 已在离屏位置，不应再次 SetWindowPos 移动。"""
    mw = _make_mock_mw(hwnd=205)
    user32 = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    def _fill_rect(h, rect_byref):
        rect_byref._obj.left = -2600  # 已在离屏
        rect_byref._obj.top = 60
        return 1

    user32.GetWindowRect.side_effect = _fill_rect

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._ensure_tray_visible(mw)
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    user32.SetWindowPos.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# v1.0.30 新测试：_restore_window_state('visible') 必须移回原始位置
# ─────────────────────────────────────────────────────────────────────────────


def test_restore_window_state_visible_moves_back():
    """_restore_window_state(mw, 'visible') 必须调 SetWindowPos 移回原始位置。

    v1.0.29：'visible' 状态没有还原逻辑，窗口永远留在离屏 (-2600,60)。
    v1.0.30 fix：_saved_visible_pos[hwnd] 存有原始坐标，restore 时还原。
    """
    HWND = 301
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()

    listen_chat._saved_visible_pos[HWND] = (300, 100)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._restore_window_state(mw, 'visible')
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        listen_chat._saved_visible_pos.pop(HWND, None)

    user32.SetWindowPos.assert_called()
    # SetWindowPos(hwnd, hWndInsertAfter, X, Y, cx, cy, uFlags)
    # 参数 0=hwnd, 1=hWndInsertAfter(0), 2=X, 3=Y
    call_args = user32.SetWindowPos.call_args[0]
    assert call_args[2] == 300, f"还原 x 必须是 300，实际是 {call_args[2]}"
    assert call_args[3] == 100, f"还原 y 必须是 100，实际是 {call_args[3]}"


def test_restore_window_state_visible_pops_saved_pos():
    """_restore_window_state 还原后必须从 _saved_visible_pos 弹出，防止二次还原。"""
    HWND = 302
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()

    listen_chat._saved_visible_pos[HWND] = (50, 80)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._restore_window_state(mw, 'visible')
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    assert HWND not in listen_chat._saved_visible_pos, "还原后不应再保留该 hwnd"


def test_restore_window_state_visible_noop_if_no_saved_pos():
    """_saved_visible_pos 没有该 hwnd 时，不应崩溃或调 SetWindowPos。"""
    HWND = 303
    mw = _make_mock_mw(hwnd=HWND)
    user32 = MagicMock()

    listen_chat._saved_visible_pos.pop(HWND, None)

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        with _mock_windll(user32), patch("time.sleep"):
            listen_chat._restore_window_state(mw, 'visible')
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen

    user32.SetWindowPos.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# v1.0.30 版本号测试
# ─────────────────────────────────────────────────────────────────────────────


def test_version_is_1036():
    """manifest.json 版本号必须 >= 1.0.36（v1.0.36 引入 UIA 标志修复，后续 bump 不应使本测试变红）。"""
    import json
    candidates = [
        os.path.join(WECHAT_RPA_DIR, "..", "..", "build-modules", "line04", "manifest.json"),
        os.path.join(WECHAT_RPA_DIR, "..", "build-modules", "line04", "manifest.json"),
    ]
    manifest_path = None
    for c in candidates:
        p = os.path.normpath(c)
        if os.path.exists(p):
            manifest_path = p
            break

    assert manifest_path, "找不到 manifest.json"
    with open(manifest_path, encoding='utf-8') as f:
        manifest = json.load(f)
    version = manifest.get("version", "")
    parts = tuple(int(x) for x in version.split("."))
    assert parts >= (1, 0, 36), (
        f"manifest version 必须 >= 1.0.36（v1.0.36 引入UIA标志修复），实际 {version!r}"
    )


def test_ensure_tray_visible_visible_calls_dwm_cloak():
    """可见非最小化窗口 + _OFFSCREEN_REPLY=True 时，必须调 DwmSetWindowAttribute(DWMWA_CLOAK=13, 1)。

    v1.0.32 新增：DWM compositor 层 cloak，防止 WeChat 自身响应 UIA activate 时移回可视区域。
    """
    mw = _make_mock_mw(hwnd=210)
    user32 = MagicMock()
    dwmapi = MagicMock()
    user32.IsWindowVisible.return_value = 1
    user32.IsIconic.return_value = 0

    def _fill_rect(h, rect_byref):
        rect_byref._obj.left = 100
        rect_byref._obj.top = 200
        return 1

    user32.GetWindowRect.side_effect = _fill_rect

    original_offscreen = listen_chat._OFFSCREEN_REPLY
    try:
        listen_chat._OFFSCREEN_REPLY = True
        windll_mock = MagicMock(user32=user32, kernel32=MagicMock(), dwmapi=dwmapi)
        import ctypes as _ct
        had_windll = hasattr(_ct, "windll")
        original_windll = getattr(_ct, "windll", None)
        _ct.windll = windll_mock
        try:
            with patch("time.sleep"):
                listen_chat._ensure_tray_visible(mw)
        finally:
            if had_windll:
                _ct.windll = original_windll
            else:
                try:
                    del _ct.windll
                except AttributeError:
                    pass
    finally:
        listen_chat._OFFSCREEN_REPLY = original_offscreen
        listen_chat._saved_visible_pos.pop(210, None)

    dwmapi.DwmSetWindowAttribute.assert_called()
    # 第一个调用必须是 cloak（第二个参数=13, 调用参数含1）
    first_call_args = dwmapi.DwmSetWindowAttribute.call_args_list[0][0]
    assert first_call_args[1] == 13, f"DWMWA_CLOAK 属性 ID 必须是 13，实际是 {first_call_args[1]}"
