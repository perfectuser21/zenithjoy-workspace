# -*- coding: utf-8 -*-
"""
欢迎回来屏自动点击自愈 — regression test（issue e78d98bc，禁止删除）。

真机实锤（xian-rog 0708）：系统重启 / UIA 自愈重启后微信自动启动，
出现 mmui::LoginWindow title='微信' + 含"进入微信"按钮的"欢迎回来"确认屏。
原 is_privacy_locked() 也返回 True（共用 cls+title），导致 bot 在此卡死无自愈，
两次生产中断均需人工手动点击"进入微信"恢复。

修法：先检测是否含"进入微信"按钮区分欢迎回来屏与真实隐私锁屏
→ AttachThreadInput 拉前台 + click_input 点击 → 15s 验证 → 失败告警。

本文件测：
  1. find_weixin.is_welcome_back_screen() 纯逻辑（stub Desktop/pywinauto）
  2. 主循环接线守卫（源码文本断言）：欢迎回来检测必须在 is_privacy_locked 之前
"""
from __future__ import annotations

import io
import os
import re
import sys
import types
from unittest.mock import MagicMock


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


HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

_stub_heavy_deps()

# 确保 find_weixin 刷新（如果被其他测试缓存了旧版）
if "find_weixin" in sys.modules:
    del sys.modules["find_weixin"]

import find_weixin  # noqa: E402
import listen_chat  # noqa: E402

LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
FIND_WEIXIN_PATH = os.path.join(WECHAT_RPA_DIR, "find_weixin.py")


def _lc_source() -> str:
    with io.open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        return f.read()


def _fw_source() -> str:
    with io.open(FIND_WEIXIN_PATH, "r", encoding="utf-8") as f:
        return f.read()


class _FakeButton:
    def __init__(self, name):
        self.element_info = MagicMock()
        self.element_info.name = name

    def descendants(self, **kw):
        return []


class _FakeLoginWindow:
    def __init__(self, cls, title, button_names=()):
        self.element_info = MagicMock()
        self.element_info.class_name = cls
        self.element_info.name = title
        self._buttons = [_FakeButton(n) for n in button_names]

    def descendants(self, control_type=None):
        if control_type == "Button":
            return self._buttons
        return self._buttons


class TestIsWelcomeBackScreen:
    """find_weixin.is_welcome_back_screen() 逻辑测试（stub pywinauto Desktop）。"""

    def _run(self, windows):
        fake_desktop = MagicMock()
        fake_desktop.windows.return_value = windows
        import pywinauto
        pywinauto.Desktop.return_value = fake_desktop
        if "find_weixin" in sys.modules:
            del sys.modules["find_weixin"]
        import find_weixin as fw
        return fw.is_welcome_back_screen()

    def test_no_login_window_returns_false(self):
        # 没有任何登录窗口 → False
        main_win = MagicMock()
        main_win.element_info.class_name = "mmui::MainWindow"
        main_win.element_info.name = "微信"
        main_win.descendants.return_value = []
        result = self._run([main_win])
        assert result is False

    def test_login_window_without_enter_button_returns_false(self):
        # mmui::LoginWindow title='微信' 但没有"进入微信"按钮 → 真实隐私锁屏 → False
        win = _FakeLoginWindow("mmui::LoginWindow", "微信", button_names=["取消"])
        result = self._run([win])
        assert result is False

    def test_login_window_with_enter_button_returns_true(self):
        # mmui::LoginWindow title='微信' + 有"进入微信"按钮 → 欢迎回来屏 → True
        win = _FakeLoginWindow("mmui::LoginWindow", "微信",
                               button_names=["进入微信", "切换账号", "仅传输文件"])
        result = self._run([win])
        assert result is True

    def test_login_window_wrong_class_ignored(self):
        # 非 mmui::LoginWindow → 不认
        win = _FakeLoginWindow("SomeOtherClass", "微信",
                               button_names=["进入微信"])
        result = self._run([win])
        assert result is False

    def test_function_exists_in_find_weixin(self):
        assert hasattr(find_weixin, "is_welcome_back_screen"), (
            "find_weixin 必须导出 is_welcome_back_screen() 函数"
        )

    def test_click_function_exists_in_find_weixin(self):
        assert hasattr(find_weixin, "click_welcome_back_enter"), (
            "find_weixin 必须导出 click_welcome_back_enter() 函数"
        )


class TestMainloopWiring:
    """主循环接线守卫：欢迎回来检测必须在 is_privacy_locked 之前，15s 验证+失败告警。"""

    def test_welcome_back_checked_before_privacy_locked(self):
        src = _lc_source()
        m_wb = re.search(r"is_welcome_back_screen", src)
        m_pl = re.search(r"is_privacy_locked\(\)", src)
        assert m_wb is not None, "主循环未调用 is_welcome_back_screen —— 欢迎回来屏无自愈（issue e78d98bc）"
        assert m_pl is not None, "主循环应保留 is_privacy_locked() 调用"
        # 欢迎回来检测必须在 is_privacy_locked 之前（源码位置靠前）
        assert m_wb.start() < m_pl.start(), (
            "is_welcome_back_screen 调用位置应在 is_privacy_locked 之前，"
            "否则欢迎回来屏会被误判为隐私锁屏跳过"
        )

    def test_15s_verification_in_mainloop(self):
        src = _lc_source()
        assert "range(15)" in src, (
            "主循环欢迎回来自愈应包含 15s 验证逻辑（range(15) 循环）"
        )

    def test_alert_on_failure_in_mainloop(self):
        src = _lc_source()
        assert "欢迎回来自愈失败" in src, (
            "自愈失败必须打 ALERT 日志通知人工介入（issue e78d98bc）"
        )

    def test_issue_id_in_source(self):
        src = _lc_source()
        assert "e78d98bc" in src, (
            "listen_chat.py 应有 issue e78d98bc 引用，便于排障检索"
        )

    def test_click_welcome_back_imported(self):
        src = _lc_source()
        assert "click_welcome_back_enter" in src, (
            "listen_chat.py 应导入并调用 click_welcome_back_enter"
        )
