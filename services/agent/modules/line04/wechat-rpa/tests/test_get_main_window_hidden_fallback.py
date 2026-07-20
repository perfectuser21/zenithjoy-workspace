# -*- coding: utf-8 -*-
"""
Regression test —— 用户点 ✕ 关闭微信到托盘后 get_main_window 永久找不到窗口
（真机 9 轮实验实锤，2026-07-18）。

## 机制（全部真机证据）

用户点右上角 ✕（关闭到托盘设置）→ 微信主窗口被 SW_HIDE（窗口对象仍存活，
`IsWindow=True, IsWindowVisible=False`，真机证实非销毁）→ `get_main_window()`
用 pywinauto `Desktop.windows()` 枚举【只含可见窗口】→ 返回 None → 主循环落入
"微信进程已在运行但 UIA 找不到主窗口，跳过重复启动"分支 → 唯一出路是重量级的
"重启微信"自愈（用户实测目睹并明确否定："你应该通过什么东西把它召唤出来，
而不是直接把微信给我重启了"）。

## 修法

`get_main_window()` 尾部加隐藏窗口 fallback：
1. `_enum_hidden_main_hwnds()`：raw Win32 EnumWindows（含不可见窗口）按 win32
   类名+标题初筛候选（`_is_main_window_candidate` 纯函数）。
2. 对每个隐藏候选用 `UIAElementInfo(hwnd)` 直接构造（绕开可见性枚举限制，
   真机验证隐藏态可构造），再用 **UIA 层类名** 复核：
   - `mmui::MainWindow` → 命中（真主窗口，真机验证隐藏态 UIA 类名正是它）
   - `mmui::LoginWindow` → 排除（第二实例的登录窗，win32 外框类名/标题与主窗口
     完全相同，今天真机 9 轮里 3 轮打错窗口的元凶）
   - title=="Weixin" 空壳 → 排除
3. 命中 → 返回 UIAWrapper。此后主循环 mw 非 None，既有托盘分支
   （SW_SHOWNA 唤回+挪屏外+常驻隐身）与扫描守卫（maximize 触发排版）自动接管
   ——不重启微信。

本文件是这个 bug 的永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, patch

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls",
                 "pywinauto.uia_element_info", "pywinauto.controls.uiawrapper"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            mod.UIAElementInfo = MagicMock()
            mod.UIAWrapper = MagicMock()
            sys.modules[name] = mod
    for name in ["requests", "psutil"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            mod.process_iter = MagicMock(return_value=[])
            sys.modules[name] = mod


_stub_heavy_deps()

import find_weixin  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# ① _is_main_window_candidate：win32 层初筛纯函数
# ─────────────────────────────────────────────────────────────────────────────


def test_candidate_mmui_main_window_class():
    assert find_weixin._is_main_window_candidate("mmui::MainWindow", "微信") is True


def test_candidate_qt5_chinese_title():
    assert find_weixin._is_main_window_candidate("Qt51514QWindowIcon", "微信") is True


def test_candidate_qt5_weixin_english_title():
    """4.1.8 托盘态外框 title=Weixin（英文）也算初筛候选（终审在 UIA 类名层）。"""
    assert find_weixin._is_main_window_candidate("Qt51514QWindowIcon", "Weixin") is True


def test_candidate_rejects_other_classes_and_titles():
    assert find_weixin._is_main_window_candidate("Chrome_WidgetWin_1", "微信") is False
    assert find_weixin._is_main_window_candidate("Qt51514QWindowIcon", "别的窗口") is False
    assert find_weixin._is_main_window_candidate("", "") is False


# ─────────────────────────────────────────────────────────────────────────────
# ② get_main_window 隐藏窗口 fallback
# ─────────────────────────────────────────────────────────────────────────────


def _stub_desktop_empty():
    """可见枚举返回空（✕ 关闭态：可见窗口里没有微信）。"""
    d = MagicMock()
    d.windows.return_value = []
    return MagicMock(return_value=d)


def _make_uia_element(cls, name):
    ei = MagicMock()
    ei.class_name = cls
    ei.name = name
    return ei


def test_fallback_finds_hidden_real_main_window():
    """✕ 关闭态：可见枚举 miss + 存在隐藏真主窗口(UIA 类名 mmui::MainWindow)
    → get_main_window 必须通过 UIAElementInfo 直接构造返回它，不再返回 None。"""
    ei = _make_uia_element("mmui::MainWindow", "微信")
    wrapper = MagicMock(name="wrapped_main")
    with patch.object(find_weixin, "_enum_hidden_main_hwnds", return_value=[13961666]), \
         patch.object(find_weixin, "_build_uia_wrapper_from_hwnd",
                      return_value=(ei, wrapper)):
        with patch.dict(sys.modules, {}):
            sys.modules["pywinauto"].Desktop = _stub_desktop_empty()
            result = find_weixin.get_main_window()
    assert result is wrapper, "隐藏的真主窗口必须被 fallback 找到（✕关闭卡死的核心修复）"


def test_fallback_rejects_login_window_second_instance():
    """UIA 类名是 mmui::LoginWindow（第二实例登录窗，win32 外框与主窗口完全同名同类）
    → 必须排除，返回 None。今天真机 9 轮中 3 轮打错窗口的元凶。"""
    ei = _make_uia_element("mmui::LoginWindow", "微信")
    wrapper = MagicMock(name="login_shell")
    with patch.object(find_weixin, "_enum_hidden_main_hwnds", return_value=[12781938]), \
         patch.object(find_weixin, "_build_uia_wrapper_from_hwnd",
                      return_value=(ei, wrapper)):
        sys.modules["pywinauto"].Desktop = _stub_desktop_empty()
        result = find_weixin.get_main_window()
    assert result is None, "登录窗绝不能被当成主窗口返回"


def test_fallback_rejects_weixin_english_shell():
    """UIA 层 title=Weixin 的 Qt5 空壳（无会话列表）→ 排除。"""
    ei = _make_uia_element("Qt51514QWindowIcon", "Weixin")
    wrapper = MagicMock(name="shell")
    with patch.object(find_weixin, "_enum_hidden_main_hwnds", return_value=[21104476]), \
         patch.object(find_weixin, "_build_uia_wrapper_from_hwnd",
                      return_value=(ei, wrapper)):
        sys.modules["pywinauto"].Desktop = _stub_desktop_empty()
        result = find_weixin.get_main_window()
    assert result is None


def test_fallback_accepts_qt5_chinese_hidden_window():
    """UIA 层 Qt5 外框 + 中文"微信"标题（4.1.10+ 隐藏态）→ 命中。"""
    ei = _make_uia_element("Qt51514QWindowIcon", "微信")
    wrapper = MagicMock(name="qt5_main")
    with patch.object(find_weixin, "_enum_hidden_main_hwnds", return_value=[555]), \
         patch.object(find_weixin, "_build_uia_wrapper_from_hwnd",
                      return_value=(ei, wrapper)):
        sys.modules["pywinauto"].Desktop = _stub_desktop_empty()
        result = find_weixin.get_main_window()
    assert result is wrapper


def test_no_fallback_when_visible_enumeration_hits():
    """可见枚举命中时直接返回，不走 fallback（原行为不变，性能不受影响）。"""
    visible_win = MagicMock()
    visible_win.element_info.class_name = "mmui::MainWindow"
    visible_win.element_info.name = "微信"
    d = MagicMock()
    d.windows.return_value = [visible_win]
    sys.modules["pywinauto"].Desktop = MagicMock(return_value=d)
    with patch.object(find_weixin, "_enum_hidden_main_hwnds") as mock_enum:
        result = find_weixin.get_main_window()
    assert result is visible_win
    mock_enum.assert_not_called()


def test_fallback_failsafe_returns_none_on_exception():
    """fallback 任何异常（非 Windows/无 windll/构造失败）→ 安全返回 None，不抛。"""
    with patch.object(find_weixin, "_enum_hidden_main_hwnds", side_effect=Exception("no windll")):
        sys.modules["pywinauto"].Desktop = _stub_desktop_empty()
        result = find_weixin.get_main_window()
    assert result is None
