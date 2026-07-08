# -*- coding: utf-8 -*-
"""
TDD — wechat-rpa 三修自愈：
  A (P0 #99741ff9): 心跳检测窗口非最大化→SW_MAXIMIZE 自愈（单栏模式静默丢消息根治）
  B (P1 #e78d98bc): 识别欢迎回来屏→click_input("进入微信")→15s 验证
  C (P1 #8e163d87): _find_left_nav_button_point 窗口相对坐标 +
                    _reset_session_list_to_top 点击前拉前台

07-08 下午真机诊断闭环（§2.K/§2.J/§2.I）。
"""
from __future__ import annotations

import os
import sys
import time
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
            sys.modules[name] = mod
    # find_weixin stub（_click_welcome_back_screen 内部 from find_weixin import get_main_window）
    if "find_weixin" not in sys.modules:
        mod = types.ModuleType("find_weixin")
        mod.get_main_window = MagicMock(return_value=None)
        sys.modules["find_weixin"] = mod


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


# ─── 工具 Fake 类 ─────────────────────────────────────────────────────────────

class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _FakeEI:
    def __init__(self, class_name="", name="", handle=0):
        self.class_name = class_name
        self.name = name
        self.handle = handle


class _FakeCtrl:
    def __init__(self, name="", rect=None, handle=0):
        self.element_info = _FakeEI(name=name, handle=handle)
        self._rect = rect or _Rect(0, 0, 0, 0)
        self.click_input_calls = 0

    def rectangle(self):
        return self._rect

    def click_input(self):
        self.click_input_calls += 1


class _FakeWindow:
    def __init__(self, class_name="", title="", handle=0, children=None):
        self.element_info = _FakeEI(class_name=class_name, name=title, handle=handle)
        self._children = children or []
        self._rect = _Rect(100, 50, 1000, 800)

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        if control_type is None:
            return self._children
        return [c for c in self._children
                if getattr(c, '_ctrl_type', None) == control_type]


# ═══════════════════════════════════════════════════════════════════════════════
# C: _find_left_nav_button_point 窗口相对坐标修正
# ═══════════════════════════════════════════════════════════════════════════════

class TestFindLeftNavButtonPointWindowRelative:
    """C 修法：left_max 判断改成窗口相对坐标 r.left - win_left < left_max。"""

    def test_absolute_left_zero_still_works(self):
        """win_left=0 时（贴屏左边缘/默认），行为与旧版完全相同（向后兼容）。"""
        buttons = [
            ("微信", _Rect(20, 100, 60, 140)),
            ("通讯录", _Rect(20, 160, 60, 200)),
        ]
        pt = listen_chat._find_left_nav_button_point(buttons, "微信", left_max=90, win_left=0)
        assert pt == (40, 120)

    def test_window_in_center_absolute_would_fail_but_relative_passes(self):
        """旧BUG复现：窗口左边=964时，按钮 r.left=984；
        旧版 984 < 90 = False → 永远找不到。
        新版(窗口相对) 984-964=20 < 90 = True → 找到。"""
        buttons = [
            ("微信", _Rect(984, 200, 1024, 240)),     # 窗口内 x=20，应命中
            ("通讯录", _Rect(984, 260, 1024, 300)),   # 窗口内 x=20，应命中
            ("微信", _Rect(1600, 200, 1640, 240)),     # 窗口内 x=636，应不选
        ]
        win_left = 964
        pt_wx = listen_chat._find_left_nav_button_point(buttons, "微信", left_max=90, win_left=win_left)
        pt_ct = listen_chat._find_left_nav_button_point(buttons, "通讯录", left_max=90, win_left=win_left)
        assert pt_wx == (1004, 220), f"期望(1004,220), 实得{pt_wx}"
        assert pt_ct == (1004, 280), f"期望(1004,280), 实得{pt_ct}"

    def test_window_in_center_right_side_button_excluded(self):
        """窗口相对坐标下，右侧同名按钮（窗口内 x≥90）不应被选中。"""
        buttons = [
            ("微信", _Rect(1064, 200, 1104, 240)),    # 窗口内 x=100，超出 left_max=90 → 不选
        ]
        pt = listen_chat._find_left_nav_button_point(buttons, "微信", left_max=90, win_left=964)
        assert pt is None

    def test_missing_button_returns_none(self):
        buttons = [("微信", _Rect(984, 200, 1024, 240))]
        assert listen_chat._find_left_nav_button_point(
            buttons, "通讯录", left_max=90, win_left=964
        ) is None


# ═══════════════════════════════════════════════════════════════════════════════
# C: _reset_session_list_to_top 拉前台 + click_input
# ═══════════════════════════════════════════════════════════════════════════════

class TestResetSessionListForegroundAndClickInput:
    """C 修法：_reset_session_list_to_top 点击前调用 _set_foreground_window，
    并用 click_input() 而非 PostMessage 点击导航按钮。"""

    def _make_button(self, name, rect, ctrl_type="Button"):
        b = _FakeCtrl(name=name, rect=rect)
        b._ctrl_type = ctrl_type
        return b

    def _make_mw(self, buttons, win_left=0):
        """构造一个带导航按钮的 FakeWindow。"""
        mw = _FakeWindow(handle=1234)
        mw._rect = _Rect(win_left, 50, win_left + 900, 800)
        mw._iter_all_ctrls = buttons
        return mw

    def test_brings_window_to_foreground_before_clicking(self):
        """点击导航按钮前必须调用 _set_foreground_window。"""
        fg_calls = []

        def fake_set_fg(hwnd):
            fg_calls.append(hwnd)

        # 窗口 left=964
        btn_contacts = self._make_button("通讯录", _Rect(984, 260, 1024, 300))
        btn_wechat = self._make_button("微信", _Rect(984, 200, 1024, 240))
        mw = self._make_mw([btn_contacts, btn_wechat], win_left=964)

        with patch.object(listen_chat, "_iter_all_controls",
                          side_effect=lambda mw, ct: mw._iter_all_ctrls):
            with patch.object(listen_chat, "_set_foreground_window", side_effect=fake_set_fg):
                result = listen_chat._reset_session_list_to_top(mw)

        assert len(fg_calls) >= 1, "_set_foreground_window 未被调用"
        assert 1234 in fg_calls, f"hwnd 1234 未传入 _set_foreground_window，实际: {fg_calls}"

    def test_uses_click_input_for_nav_buttons(self):
        """导航按钮点击必须用 click_input()（PostMessage 对 mmui 导航无效）。"""
        btn_contacts = self._make_button("通讯录", _Rect(984, 260, 1024, 300))
        btn_wechat = self._make_button("微信", _Rect(984, 200, 1024, 240))
        mw = self._make_mw([btn_contacts, btn_wechat], win_left=964)

        with patch.object(listen_chat, "_iter_all_controls",
                          side_effect=lambda mw, ct: mw._iter_all_ctrls):
            with patch.object(listen_chat, "_set_foreground_window"):
                result = listen_chat._reset_session_list_to_top(mw)

        # 两个导航按钮都应被 click_input 过（通讯录至少1次，微信至少1次）
        assert btn_contacts.click_input_calls >= 1, "通讯录按钮未用 click_input"
        assert btn_wechat.click_input_calls >= 1, "微信按钮未用 click_input"

    def test_skips_when_buttons_not_found_in_window_relative(self):
        """窗口在中间且按钮 x ≥ win_left+90 时（旧Bug），找不到按钮→跳过、返回False、不崩。"""
        # 按钮 r.left=1064，win_left=964，窗口相对 x=100 ≥ 90 → 应不选
        btn_contacts = self._make_button("通讯录", _Rect(1064, 260, 1104, 300))
        btn_wechat = self._make_button("微信", _Rect(1064, 200, 1104, 240))
        mw = self._make_mw([btn_contacts, btn_wechat], win_left=964)

        with patch.object(listen_chat, "_iter_all_controls",
                          side_effect=lambda mw, ct: mw._iter_all_ctrls):
            with patch.object(listen_chat, "_set_foreground_window"):
                result = listen_chat._reset_session_list_to_top(mw)

        assert result is False
        assert btn_contacts.click_input_calls == 0
        assert btn_wechat.click_input_calls == 0


# ═══════════════════════════════════════════════════════════════════════════════
# A: _ensure_window_maximized 心跳自愈
# ═══════════════════════════════════════════════════════════════════════════════

class TestEnsureWindowMaximized:
    """A 修法：心跳检测窗口非最大化 → ShowWindow(SW_MAXIMIZE)。"""

    def _make_mw(self, handle=5678, rect=None):
        mw = _FakeWindow(handle=handle)
        mw._rect = rect or _Rect(0, 0, 630, 622)
        return mw

    def test_maximizes_when_not_zoomed(self):
        """IsZoomed 返回 False → 调用 ShowWindow(hwnd, SW_MAXIMIZE=3)。"""
        show_calls = []
        import ctypes
        fake_u32 = MagicMock()
        fake_u32.IsZoomed.return_value = 0  # 未最大化
        fake_u32.ShowWindow.side_effect = lambda hwnd, sw: show_calls.append((hwnd, sw))

        fake_windll = MagicMock()
        fake_windll.user32 = fake_u32

        mw = self._make_mw(handle=5678)

        with patch.object(ctypes, "windll", fake_windll, create=True):
            listen_chat._ensure_window_maximized(mw)

        assert len(show_calls) == 1, f"ShowWindow 应被调用1次，实际: {show_calls}"
        hwnd, sw = show_calls[0]
        assert hwnd == 5678
        assert sw == 3, f"SW_MAXIMIZE=3，实际传入: {sw}"

    def test_skips_when_already_zoomed(self):
        """IsZoomed 返回非零 → 不调用 ShowWindow（已最大化，无需操作）。"""
        show_calls = []
        import ctypes
        fake_u32 = MagicMock()
        fake_u32.IsZoomed.return_value = 1  # 已最大化
        fake_u32.ShowWindow.side_effect = lambda *a: show_calls.append(a)

        fake_windll = MagicMock()
        fake_windll.user32 = fake_u32

        mw = self._make_mw()
        with patch.object(ctypes, "windll", fake_windll, create=True):
            listen_chat._ensure_window_maximized(mw)

        assert show_calls == [], "已最大化时不应调用 ShowWindow"

    def test_no_crash_on_non_windows(self):
        """非 Windows（无 windll）→ 不崩，noop。"""
        import ctypes
        mw = self._make_mw()
        # windll 不存在时应安静返回
        original_windll = getattr(ctypes, "windll", None)
        if hasattr(ctypes, "windll"):
            del ctypes.windll
        try:
            listen_chat._ensure_window_maximized(mw)
        finally:
            if original_windll is not None:
                ctypes.windll = original_windll


# ═══════════════════════════════════════════════════════════════════════════════
# B: _click_welcome_back_screen 欢迎回来屏自动点击
# ═══════════════════════════════════════════════════════════════════════════════

class TestClickWelcomeBackScreen:
    """B 修法：识别欢迎回来屏 → fg + click_input("进入微信")。"""

    def _make_login_win(self, title="微信", has_enter_btn=True, handle=9999):
        class _BtnCtrl:
            def __init__(self, name, ctrl_type="Button"):
                self.element_info = _FakeEI(name=name)
                self._ctrl_type = ctrl_type
                self.clicked = False
            def click_input(self):
                self.clicked = True

        enter_btn = _BtnCtrl("进入微信") if has_enter_btn else None
        children = [
            _BtnCtrl("切换账号"),
            _BtnCtrl("仅传输文件"),
        ]
        if enter_btn:
            children.insert(0, enter_btn)

        class _LoginWin:
            def __init__(self):
                self.element_info = _FakeEI(
                    class_name="mmui::LoginWindow", name=title, handle=handle
                )
                self._children = children
                self._enter_btn = enter_btn
            def descendants(self, control_type=None):
                return [c for c in self._children
                        if control_type is None or c._ctrl_type == control_type]

        return _LoginWin()

    def test_clicks_enter_button_when_welcome_back_screen(self):
        """欢迎回来屏（含"进入微信"按钮）→ 调用 click_input 并返回 True。"""
        login_win = self._make_login_win(title="微信", has_enter_btn=True)

        def fake_desktop(*a, **kw):
            m = MagicMock()
            m.windows.return_value = [login_win]
            return m

        mw_sequence = [None, MagicMock()]  # 第一次查 None，等待后返回有值
        call_idx = [0]

        def fake_get_main_window():
            idx = call_idx[0]
            call_idx[0] += 1
            return mw_sequence[min(idx, len(mw_sequence)-1)]

        sys.modules["pywinauto"].Desktop = fake_desktop

        with patch("find_weixin.get_main_window", side_effect=fake_get_main_window):
            with patch.object(listen_chat, "_set_foreground_window") as fg_mock:
                with patch("time.sleep"):
                    result = listen_chat._click_welcome_back_screen()

        assert result is True, "欢迎回来屏应返回 True"
        assert login_win._enter_btn.clicked, '"进入微信"按钮未被 click_input'
        fg_mock.assert_called()

    def test_returns_false_when_no_login_window(self):
        """无 LoginWindow → 返回 False（不是欢迎回来屏）。"""
        def fake_desktop(*a, **kw):
            m = MagicMock()
            m.windows.return_value = []
            return m

        sys.modules["pywinauto"].Desktop = fake_desktop

        result = listen_chat._click_welcome_back_screen()
        assert result is False

    def test_returns_false_when_no_enter_button(self):
        """LoginWindow 没有"进入微信"按钮 = 真隐私锁 → 不点击，返回 False。"""
        login_win = self._make_login_win(title="微信", has_enter_btn=False)

        def fake_desktop(*a, **kw):
            m = MagicMock()
            m.windows.return_value = [login_win]
            return m

        sys.modules["pywinauto"].Desktop = fake_desktop

        result = listen_chat._click_welcome_back_screen()
        assert result is False

    def test_logs_warning_when_main_window_not_restored_in_15s(self):
        """点击后15s内主窗口未出现 → 仍返回 True（已点，不重复点）+ 有告警日志。"""
        login_win = self._make_login_win(title="微信", has_enter_btn=True)

        def fake_desktop(*a, **kw):
            m = MagicMock()
            m.windows.return_value = [login_win]
            return m

        sys.modules["pywinauto"].Desktop = fake_desktop

        with patch("find_weixin.get_main_window", return_value=None):
            with patch.object(listen_chat, "_set_foreground_window"):
                with patch("time.sleep"):
                    logged = []
                    with patch.object(listen_chat, "_log", side_effect=logged.append):
                        result = listen_chat._click_welcome_back_screen()

        assert result is True, "即使等待超时也应返回 True（避免反复点击）"
        # 应有告警日志
        assert any("WARNING" in s or "未出现" in s for s in logged), \
            f"应有超时告警日志，实际日志: {logged}"
