# -*- coding: utf-8 -*-
"""
扫描态挪坐标决策纯函数单测（2026-07-17，decision 7b8857f7 / ee2890bb）。

根因：cloak 跨进程永久 E_ACCESSDENIED 从不生效（真机铁证 ee2890bb），扫描态
      （for_reply=False）分支只 cloak 不挪坐标 → 窗口真实可见每 ~10s 弹闪。
      真机 OFFSCREEN_REPLY=False（config.py:36 默认）。
修法：把"是否挪坐标屏外"抽成纯函数 _should_move_offscreen，扫描态无论 OFFSCREEN_REPLY
      都挪（唯一真正生效的隐藏手段）；回复态维持 OFFSCREEN_REPLY 语义（B 方案可见）。

CI 安全：顶层 stub pywinauto/requests，纯逻辑不碰 ctypes。
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


def test_scan_state_moves_offscreen_even_when_offscreen_reply_false():
    """扫描态(for_reply=False)即使 OFFSCREEN_REPLY=False 也必须挪坐标屏外。

    本次修复的核心：cloak 无效(ee2890bb)，只有挪坐标才真隐藏。变异守卫锚点。
    """
    assert listen_chat._should_move_offscreen(offscreen_reply=False, for_reply=False) is True


def test_reply_state_respects_offscreen_reply_flag():
    """回复态(for_reply=True)：挪不挪由 OFFSCREEN_REPLY 决定，保 B 方案(#811/#812)可见+送达。"""
    assert listen_chat._should_move_offscreen(offscreen_reply=False, for_reply=True) is False
    assert listen_chat._should_move_offscreen(offscreen_reply=True, for_reply=True) is True


def test_offscreen_reply_true_always_moves():
    """OFFSCREEN_REPLY=True：扫描态和回复态都挪（不破坏旧的全离屏行为）。"""
    assert listen_chat._should_move_offscreen(offscreen_reply=True, for_reply=False) is True
