# -*- coding: utf-8 -*-
"""TDD — scan_unread 扫描期间开窗读消息不能永久抢走用户前台键鼠焦点（真机反馈根治）。

真机反馈（2026-07-17 用户实测）：Line04 微信客服运行时"抢键盘鼠标，人没法用"。

根因排查（对齐 test_focus_no_steal.py 已验证的机制）：
  reply_in_chat（发送回复）早已用 _get_foreground_window/_set_foreground_window/
  _should_restore_foreground 三件套，操作完把前台焦点还给操作前的窗口（PrepPRD 需求 2，
  memory wechat_qt_uia_works_dont_downgrade）。

  但 scan_unread（后台扫描未读消息，每轮 ≤SCAN_OPEN_BUDGET 个候选人）内部循环调用
  _read_trailing_for → _open_chat（同一个会短暂抢前台 ~2s 的 Select() 调用），
  却从未接入这套归还机制——扫描比回复频繁得多（每 6-10 秒一轮，参见 scan_unread
  文档字符串"2026-07-02 22:59 实况"），是用户感知"抢键盘鼠标"的真正主因。

守卫（proven-to-fire）：
  - 扫描期间实际打开过候选会话（opened>0）且操作前前台是别的窗口 → 扫描结束必须
    把焦点还回去。
  - 操作前前台本来就是微信（用户在自己操作微信）→ 不还（避免把焦点推给微信自己，
    与 reply_in_chat 语义一致）。
  - 本轮没有任何候选被打开（无未读/角标）→ 不触发任何前台操作（没偷、不用还）。
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
    def __init__(self, name="", handle=12345):
        self.name = name
        self.handle = handle


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name)


class _MW:
    def __init__(self, items, handle=12345):
        self.element_info = _EI(handle=handle)
        self._items = items

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


@pytest.fixture(autouse=True)
def _no_window_ops(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户"])
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._ANCHOR_STALL.clear()


def _mk(name):
    return _Item(name)


def test_scan_restores_foreground_when_candidate_opened(monkeypatch):
    """扫描期间开了至少一个候选会话（Select() 短暂抢前台）→ 结束后必须把焦点还给
    操作前的前台窗口（hwnd=100，用户正在用的其他程序，≠微信 12345）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
    ])
    monkeypatch.setattr(listen_chat, "_get_foreground_window", lambda: 100)
    restored = []
    monkeypatch.setattr(listen_chat, "_set_foreground_window", lambda h: restored.append(h))

    mw = _MW([_mk("默忆\n[1条] \n在吗\n14:43\n")])
    listen_chat.scan_unread(mw, {})

    assert restored == [100], "扫描打开过会话后必须把前台焦点还给操作前的窗口（真机反馈：抢键盘鼠标）"


def test_scan_no_restore_when_prev_foreground_was_wechat(monkeypatch):
    """操作前前台本来就是微信（用户自己在用微信）→ 不还焦点，避免把焦点推给微信自己。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
    ])
    monkeypatch.setattr(listen_chat, "_get_foreground_window", lambda: 12345)  # == 微信 hwnd
    restored = []
    monkeypatch.setattr(listen_chat, "_set_foreground_window", lambda h: restored.append(h))

    mw = _MW([_mk("默忆\n[1条] \n在吗\n14:43\n")], handle=12345)
    listen_chat.scan_unread(mw, {})

    assert restored == [], "操作前前台就是微信时不应还焦点"


def test_scan_no_foreground_ops_when_nothing_opened(monkeypatch):
    """本轮没有未读/角标候选（scan_unread 内部不会调 _open_chat）→ 没偷焦点，不该有任何还焦点动作。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_get_foreground_window", lambda: 100)
    restored = []
    monkeypatch.setattr(listen_chat, "_set_foreground_window", lambda h: restored.append(h))

    mw = _MW([_mk("默忆\n你好\n14:43\n")])  # 无 [N条] 角标，首见只 seed 不触发
    listen_chat.scan_unread(mw, {})

    assert restored == [], "没有候选被打开时不该有任何还焦点动作"
