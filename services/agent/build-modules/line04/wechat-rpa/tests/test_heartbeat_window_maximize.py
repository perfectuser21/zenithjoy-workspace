# -*- coding: utf-8 -*-
"""
心跳窗口最大化自愈 — regression test（issue 99741ff9，禁止删除）。

真机实锤（xian-rog 0708）：微信主窗口 630×622 小尺寸（非最大化）时，
向真实测试账号发消息后 listener 心跳持续 sessions=3~4 unread=0 约 20 分钟毫无反应；
SW_MAXIMIZE 后几秒内立即恢复 sessions=27 DELIVERED。

根因：WeChat 虚拟列表在小窗口下只渲染视口内 ListItem，大量会话（含未读）不在渲染树。
scan_unread 遍历 ListItem → 全部"离屏"→ unread=0 → 永不回复，日志不报错非常隐蔽。

本文件测：
  1. 常量 _MIN_WINDOW_WIDTH 存在且 >= 800（实证 630px 已不够，留安全余量）
  2. 纯函数 _maximize_main_window_if_needed：平台守卫（非 Windows 返回 False）
  3. 心跳块主循环接线守卫（源码文本断言）
"""
from __future__ import annotations

import io
import os
import re
import sys
import types
from unittest.mock import MagicMock, patch


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

LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")


def _source() -> str:
    with io.open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        return f.read()


class TestMinWindowWidthConstant:
    """常量存在且值合理：630px rog 实测已不够，阈值 >= 800 留安全余量。"""

    def test_constant_exists(self):
        assert hasattr(listen_chat, "_MIN_WINDOW_WIDTH"), (
            "_MIN_WINDOW_WIDTH 常量未定义 —— 窗口大小自愈需要此阈值"
        )

    def test_constant_at_least_800(self):
        assert listen_chat._MIN_WINDOW_WIDTH >= 800, (
            f"_MIN_WINDOW_WIDTH={listen_chat._MIN_WINDOW_WIDTH} 过小（rog 实测 630px 已漏检，需 >= 800）"
        )

    def test_constant_not_too_large(self):
        assert listen_chat._MIN_WINDOW_WIDTH <= 1200, (
            f"_MIN_WINDOW_WIDTH={listen_chat._MIN_WINDOW_WIDTH} 过大，可能误最大化正常小屏机器"
        )


class TestMaximizeMainWindowIfNeeded:
    """_maximize_main_window_if_needed 的平台守卫与基本行为。"""

    def test_non_windows_returns_false(self):
        mw_mock = MagicMock()
        with patch("listen_chat.platform") as mock_platform:
            mock_platform.system.return_value = "Darwin"
            result = listen_chat._maximize_main_window_if_needed(mw_mock)
        assert result is False, "非 Windows 平台应直接返回 False，不做任何操作"

    def test_exception_swallowed_returns_false(self):
        # 模拟取 rectangle 时异常 → 吞掉返回 False，绝不抛（不拖垮心跳）
        mw_mock = MagicMock()
        mw_mock.element_info.handle = 12345
        mw_mock.rectangle.side_effect = RuntimeError("UIA 树未就绪")
        with patch("listen_chat.platform") as mock_platform:
            mock_platform.system.return_value = "Windows"
            result = listen_chat._maximize_main_window_if_needed(mw_mock)
        assert result is False, "rectangle 异常应吞掉返回 False，不拖垮心跳"


class TestMainloopWiring:
    """心跳块接线守卫：必须在心跳块内调用 _maximize_main_window_if_needed。"""

    def test_heartbeat_calls_maximize_selfheal(self):
        src = _source()
        # 找心跳块
        m = re.search(r"心跳 \+ 扫描诊断上报中台", src)
        assert m is not None, "找不到心跳块标记「心跳 + 扫描诊断上报中台」"
        # 心跳块后 2000 字符内必须接 _maximize_main_window_if_needed
        window = src[m.start(): m.start() + 2000]
        assert "_maximize_main_window_if_needed" in window, (
            "心跳块未接 _maximize_main_window_if_needed —— 小窗口虚拟列表截断无自愈（issue 99741ff9）"
        )

    def test_alert_log_mentions_issue_id(self):
        src = _source()
        assert "99741ff9" in src, (
            "代码里应有 issue 99741ff9 引用，便于排障时检索根因"
        )

    def test_sw_maximize_constant_used(self):
        src = _source()
        assert "SW_MAXIMIZE" in src or "SW_maximize" in src.lower(), (
            "_maximize_main_window_if_needed 应使用 SW_MAXIMIZE 最大化窗口"
        )
