# -*- coding: utf-8 -*-
"""
Bug 5 (角标缺失) regression — 1.0.107 staging 重测发现：

WeChat 打开会话后立即清零角标（badge→0）。scan_unread 的 F1 回退保底路径
（L971）要求 badge > 0，导致已清零的角标消息永远不走 F1。TRAILING_STALL
熔断需要 N 轮后才触发，但当预览文本在等待期间变为我方回复时，
自回声护栏（L987）把触发消费掉而不 emit，消息永久丢失。

修法：F1 保底路径不再要求 badge > 0——只要 content 存在且不是我方已发送的文本
即可 emit（badge 在 WeChat 打开窗口时已不可靠，不能作为有无消息的门禁）。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 99999


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


import pytest


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: [])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    # 模拟：打开窗口后气泡读不到 trailing（角标已被 WeChat 清除）
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "好的已为您处理", "direction": "outgoing"},  # 我方上次回复
    ])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()
    listen_chat._INFLIGHT.clear()
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._SENT_TEXTS.clear()


def test_badge_zero_with_new_content_emits():
    """Bug 5 核心断言：badge=0 但预览内容不是我方发过的文本 → 应该 emit。

    场景：WeChat 打开会话后清零 badge，但 preview 内容是客户消息（非我方已发）。
    修复前：badge=0 → F1 不触发 → 进入 TRAILING_STALL → 最终可能因自回声护栏丢失。
    修复后：badge=0 但 content 不是已发文本 → F1 直接 emit，无需等 TRAILING_STALL。
    """
    # badge=0（已被清除），内容是客户问询（非我方发过的）
    lp = {"客户丙": "老预览内容"}  # prev != name → 触发候选
    item_name = "客户丙\n我要退款\n09:15\n"  # badge=0，无[N条]

    out = listen_chat.scan_unread(
        _MW([_Item(item_name)]),
        lp,
    )
    assert out, (
        "badge=0 但 content('我要退款')不是已发文本 → 必须 emit，"
        "否则客户消息永久丢失（Bug 5）"
    )
    assert out[0]["sender"] == "客户丙"


def test_badge_zero_with_own_sent_text_does_not_emit():
    """防误判：badge=0 且内容命中已发送历史（自回声）→ 不 emit（正确静默）。"""
    listen_chat._SENT_TEXTS.append("好的已为您处理")
    lp = {"客户丁": "老预览"}
    # 预览内容是我方已发的文本
    item_name = "客户丁\n好的已为您处理\n09:20\n"

    out = listen_chat.scan_unread(
        _MW([_Item(item_name)]),
        lp,
    )
    assert not out, "预览是我方已发文本（自回声）时不得 emit（防自回自话）"
