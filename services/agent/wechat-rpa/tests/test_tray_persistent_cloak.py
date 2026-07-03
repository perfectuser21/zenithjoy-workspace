# -*- coding: utf-8 -*-
"""托盘常驻隐身守卫（2026-07-03 生产频闪，1.0.105）：

扫描周期 3s→1s（1.0.100）后，托盘态每秒"cloak+弹出→读→收回+uncloak"一次——
弹/收瞬间的漏帧在 1Hz 下聚合成肉眼可见的持续频闪（"不停地闪、前台不停拉回来"）。

修法：托盘弹出后**保持隐身常驻**（_CLOAK_OWNED=True，不再每轮收窗/uncloak），
零弹收动作=零频闪；检测到操作者本人激活微信（前台=微信）→ 立即 uncloak
归还窗口（_release_cloak_to_operator）。minimized/visible 态行为不变。
本文件是频闪回归的永久 regression test。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _MW:
    def __init__(self):
        self.element_info = _EI()

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        return []


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._CLOAK_OWNED = False
    listen_chat._SCAN_WINDOW_STATE = ""
    yield
    listen_chat._CLOAK_OWNED = False


def test_tray_scan_no_emit_keeps_cloaked_shown(monkeypatch):
    """托盘态 + 无 emit → 绝不收窗（不 SW_HIDE 不 uncloak）——每秒弹收=频闪根源。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "tray")
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    listen_chat._CLOAK_OWNED = True  # ensure 的托盘分支置位（本测试直接模拟）
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    out = listen_chat.scan_unread(_MW(), {})
    assert not out
    assert not restored, "托盘态无 emit 也不收窗（常驻隐身，零弹收零频闪）"
    assert listen_chat._CLOAK_OWNED is True


def test_non_tray_states_still_restore(monkeypatch):
    """minimized 态维持旧行为：无 emit 扫完立即还原。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "minimized")
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    out = listen_chat.scan_unread(_MW(), {})
    assert not out
    assert restored == ["minimized"]


def test_operator_activation_releases_cloak(monkeypatch):
    """操作者激活微信（前台=微信）且我们持有隐身 → 立即 uncloak 归还窗口。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: True)
    listen_chat._CLOAK_OWNED = True
    released = []
    monkeypatch.setattr(listen_chat, "_uncloak_window",
                        lambda mw: released.append(1))
    listen_chat.scan_unread(_MW(), {})
    assert released, "操作者点开微信必须立即解除隐身"
    assert listen_chat._CLOAK_OWNED is False


def test_finish_scan_window_skips_tray_when_cloak_owned(monkeypatch):
    """回复后统一收窗：托盘态持有隐身 → 同样不收（保持常驻）。"""
    restored = []
    monkeypatch.setattr(listen_chat, "_restore_window_state",
                        lambda mw, s: restored.append(s))
    listen_chat._CLOAK_OWNED = True
    listen_chat._SCAN_WINDOW_STATE = "tray"
    listen_chat._finish_scan_window(_MW())
    assert not restored
    assert listen_chat._SCAN_WINDOW_STATE == ""
