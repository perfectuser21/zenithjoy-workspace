"""回归测试（2026-07-08 真机取证 + 控制性复现，issue e78d98bc / skill §2.J）：

真机现象：微信重启后 mmui::LoginWindow title='微信' 常是"欢迎回来"确认屏
（Button 进入微信/切换账号/仅传输文件，不需要密码），代码只检测不自愈 →
listener 心跳持续 locked=True sessions=0，生产静默中断直到人工点击。
实证修法：AttachThreadInput 拉前台 + click_input 点"进入微信"（DPI 假设已推翻；
UIA Invoke 和不抢前台的 PostMessage 对 mmui 按钮均无效），点击后主窗口 ~10s 出现。

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
sys.path.insert(0, WECHAT_RPA_DIR)
_stub_heavy_deps()

import find_weixin  # noqa: E402
import listen_chat  # noqa: E402


def test_welcome_screen_classified_by_enter_button():
    names = ["进入微信", "切换账号", "仅传输文件", "关闭", "网络代理设置"]
    assert find_weixin.classify_login_window(names) == "welcome_screen"


def test_privacy_lock_when_no_enter_button():
    assert find_weixin.classify_login_window([]) == "privacy_lock"
    assert find_weixin.classify_login_window(["关闭"]) == "privacy_lock"


def test_should_attempt_first_time():
    assert listen_chat.should_attempt_welcome_click(0, 0.0, 1000.0) is True


def test_should_not_attempt_within_cooldown():
    assert listen_chat.should_attempt_welcome_click(1, 1000.0, 1060.0) is False


def test_should_attempt_after_cooldown():
    assert listen_chat.should_attempt_welcome_click(1, 1000.0, 1121.0) is True


def test_should_stop_after_max_attempts():
    """3 次失败后不再点击（转人工告警），绝不无限点击。"""
    assert listen_chat.should_attempt_welcome_click(3, 0.0, 99999.0) is False
