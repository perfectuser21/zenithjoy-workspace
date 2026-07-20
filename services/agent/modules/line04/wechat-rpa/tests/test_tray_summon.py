# -*- coding: utf-8 -*-
"""
Regression test —— ✕关闭恢复优先托盘召唤(不重启)的纯逻辑单测（2026-07-18 真机实证）。

用户拍板正解："塌了它只是进入到托盘了，你应该在托盘里边把它召唤出来，而不是
直接把微信给我重启"。真机实证：SW_SHOWNA/最大化/任务栏按钮/UIA Invoke 均救不回
✕关闭被微信撕掉的内容树；唯有真实鼠标双击通知区微信托盘图标触发微信自身恢复
→ content 0→12 会话 ~5s，不杀进程。

CI 只测纯逻辑（坐标中心计算、溢出宿主窗口类名判定）——真实鼠标点击/pywinauto
枚举走真机端到端验证，不进 CI。本文件是这两个纯函数的永久 regression test。
"""
from __future__ import annotations

import os
import sys
import types
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

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


def test_rect_center_basic():
    assert listen_chat._rect_center(_Rect(2116, 1268, 2160, 1316)) == (2138, 1292)


def test_rect_center_zero_area():
    assert listen_chat._rect_center(_Rect(100, 100, 100, 100)) == (100, 100)


def test_overflow_host_win11_xaml_island():
    """rog Win11 Build 26100 实测：微信托盘图标落在此类窗口。"""
    assert listen_chat._is_tray_overflow_host("TopLevelWindowForOverflowXamlIsland") is True


def test_overflow_host_loose_matches():
    assert listen_chat._is_tray_overflow_host("SystemTrayOverflowWindow") is True
    assert listen_chat._is_tray_overflow_host("NotifyIconOverflowWindow") is True


def test_overflow_host_rejects_unrelated():
    assert listen_chat._is_tray_overflow_host("Shell_TrayWnd") is False
    assert listen_chat._is_tray_overflow_host("mmui::MainWindow") is False
    assert listen_chat._is_tray_overflow_host("") is False
    assert listen_chat._is_tray_overflow_host(None) is False


def test_summon_returns_false_on_non_windows(monkeypatch):
    """非 Windows（CI Linux/mac）→ 直接 False，绝不抛（上层退回重启兜底）。"""
    import platform
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    assert listen_chat._summon_wechat_from_tray() is False
