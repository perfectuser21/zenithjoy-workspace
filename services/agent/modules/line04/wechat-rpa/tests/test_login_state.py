"""
回归测试（遗留④，xian-rog 4.1.8 实地坐实 2026-06-29）：

真机现象：listen_chat 心跳 sessions=16（读到 16 个会话 = 微信实际已登录）但 login=False。
根因：心跳日志 login= 这一项打的是 login_present（登录窗口是否存在）。微信 4.1.8 主窗口就绪后
      login_window_present() 返回 False（无登录窗口），login 变量从初始 False 一路没被改写 →
      心跳日志打 login=False。运营把 "login=False" 误读成 "未登录"，与 sessions>0 矛盾、误导排障。

修法（纯函数 interpret_logged_in）：
  主窗口就绪 + 无登录窗口 + 能读到会话(sessions>0) → 视为已登录。
  心跳日志改打 interpret_logged_in 的真实登录态，消除 "sessions>0 却 login=False" 的矛盾。
  注意：login_present 诊断字段语义不动（dashboard/api 依赖它 = 需扫码标志），只新增登录态派生。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
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

import listen_chat  # noqa: E402


class TestInterpretLoggedIn:
    """主窗口就绪 + 无登录窗口 + sessions>0 = 已登录。"""

    def test_main_window_with_sessions_is_logged_in(self):
        # 真机场景：sessions=16、主窗口就绪、无登录窗口 → 必须判已登录（消除 login=False 矛盾）
        assert listen_chat.interpret_logged_in(
            main_window_found=True, login_window_present=False, sessions_seen=16) is True

    def test_main_window_one_session_is_logged_in(self):
        assert listen_chat.interpret_logged_in(
            main_window_found=True, login_window_present=False, sessions_seen=1) is True

    def test_login_window_present_is_not_logged_in(self):
        # 残留/真在扫码：有登录窗口 → 未登录，哪怕 sessions 误读非 0
        assert listen_chat.interpret_logged_in(
            main_window_found=True, login_window_present=True, sessions_seen=5) is False

    def test_no_main_window_is_not_logged_in(self):
        # 微信没起来 / UIA 没就绪 → 未登录
        assert listen_chat.interpret_logged_in(
            main_window_found=False, login_window_present=False, sessions_seen=0) is False

    def test_main_window_zero_sessions_not_yet_logged_in(self):
        # 主窗口在但一个会话都读不到 → 还不能宣称已登录（树未建/刚启动过渡），不自欺
        assert listen_chat.interpret_logged_in(
            main_window_found=True, login_window_present=False, sessions_seen=0) is False
