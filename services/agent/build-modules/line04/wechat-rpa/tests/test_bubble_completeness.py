# -*- coding: utf-8 -*-
"""1.0.97 三刀守卫（2026-07-03 08:18 真机实况定义）：

1. 气泡完整性校验：角标说 N 条未读、trailing 只捞到 M<N 条 → 判定"读不全"
   （探针实锤：消息 2/3 显示在屏幕上、y 坐标留着 198px 空洞，但微信没把节点
   挂进 UIA 树）→ 滚动 jiggle 强制 Qt 重建列表后重读一次，取更全的结果。
   绝不带着残缺结果直接回（用户视角=没看到消息）。
2. 拟人等待删除（用户决策）：pick_reply_delay 返回 0。
3. SENDER_COOLDOWN 15→2s（用户决策）：连发按到达节奏逐条/小批回。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat
import auto_reply


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


class _MW:
    def __init__(self):
        self.element_info = _EI()

    def rectangle(self):
        return _Rect(0, 0, 800, 600)

    def descendants(self, control_type=None):
        return []


def test_incomplete_bubble_read_triggers_jiggle_reread(monkeypatch):
    """badge=4 但首读 trailing 只有 2 条 → 必须 jiggle 重读；重读拿到 4 条 → 用全的。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()

    first = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "4. 你们公司信息", "direction": "incoming"},
        {"text": "5. 怎么联系你", "direction": "incoming"},
    ]
    full = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "2. 什么价格", "direction": "incoming"},
        {"text": "3. 发下资料", "direction": "incoming"},
        {"text": "4. 你们公司信息", "direction": "incoming"},
        {"text": "5. 怎么联系你", "direction": "incoming"},
    ]
    reads = []

    def fake_read(mw):
        reads.append(1)
        return first if len(reads) == 1 else full

    jiggled = []
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", fake_read)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))

    cand = {"sender": "默忆", "content": "5. 怎么联系你", "badge": 4,
            "name": "默忆\n[4条] \n5. 怎么联系你\n08:18\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)
    assert jiggled, "badge=4 只读到 2 条 trailing 必须触发 jiggle 重读"
    assert msgs == ["2. 什么价格", "3. 发下资料", "4. 你们公司信息", "5. 怎么联系你"], (
        f"重读拿到全量后必须用全的，实际 {msgs!r}"
    )


def test_complete_read_does_not_jiggle(monkeypatch):
    """badge 数与读到数吻合 → 不 jiggle（不加无谓延迟）。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "在吗", "direction": "incoming"},
    ])
    jiggled = []
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))
    cand = {"sender": "默忆", "content": "在吗", "badge": 1,
            "name": "默忆\n[1条] \n在吗\n08:18\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)
    assert msgs == ["在吗"]
    # v1.0.99：双读无条件 jiggle 一次（角标数不可信——自动已读消息不计入），
    # 但读全后不再第三次加严重读。
    assert len(jiggled) == 1


def test_reply_delay_removed():
    """拟人等待已删（用户决策 2026-07-03）：pick_reply_delay 恒为 0。"""
    for _ in range(5):
        assert auto_reply.pick_reply_delay() == 0.0


def test_sender_cooldown_is_2s():
    """SENDER_COOLDOWN 15→2（用户决策 2026-07-03）：只防同秒重复，不再压响应。"""
    import config
    assert config.SENDER_COOLDOWN_SECONDS == 2.0


def test_image_plus_text_no_spurious_third_jiggle(monkeypatch):
    """badge=2（图片+文字）但 UIA 只见到 1 条文字 且 双读无改善 → 不得触发第三次 jiggle。

    根因 Issue 4024c90b：完整性校验用原始 badge_n（含图片/语音计数）比对纯文本 msgs
    条数，图片场景 badge=2 而 msgs=1（图片 ListItem name 为空被 read_chat_bubbles 过滤）
    → 恒判"不完整"触发第三次 jiggle，可能把新到文字消息滚出视口被丢弃。

    修复后：双读无改善（节点已稳定，gap 来自非文本消息）时跳过第三次 jiggle。
    """
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户A"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()

    # 图片消息在 UIA 树里 ListItem name 为空 → read_chat_bubbles 过滤掉，只剩文字
    bubbles_text_only = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "好的", "direction": "incoming"},
    ]
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: bubbles_text_only)

    jiggled = []
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))

    # badge=2（图片1条 + 文字"好的"1条），msgs 只能看到 1 条文字
    cand = {"sender": "客户A", "content": "好的", "badge": 2,
            "name": "客户A\n[2条] \n好的\n10:00\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)

    assert msgs == ["好的"], f"文字消息必须正确返回，实际 {msgs!r}"
    # 关键断言：双读未改善（稳定状态，gap 来自图片），不应有第三次 jiggle
    # 无条件双读（第一次 jiggle）是允许的，但不应再有第三次
    assert len(jiggled) == 1, (
        f"图片+文字双读无改善，不应触发第三次 jiggle，实际触发了 {len(jiggled)} 次"
    )


def test_third_jiggle_fires_when_double_read_improved(monkeypatch):
    """双读有改善（UIA 节点仍在加载）且仍少于角标 → 第三次 jiggle 必须触发（回归守卫）。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户B"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()

    reads = []

    def fake_read(mw):
        reads.append(1)
        if len(reads) == 1:
            return [{"text": "旧回复", "direction": "outgoing"},
                    {"text": "消息1", "direction": "incoming"}]
        elif len(reads) == 2:
            # 双读改善：从 1 条 → 2 条，仍少于 badge=3
            return [{"text": "旧回复", "direction": "outgoing"},
                    {"text": "消息1", "direction": "incoming"},
                    {"text": "消息2", "direction": "incoming"}]
        else:
            # 第三次 jiggle 后读到完整 3 条
            return [{"text": "旧回复", "direction": "outgoing"},
                    {"text": "消息1", "direction": "incoming"},
                    {"text": "消息2", "direction": "incoming"},
                    {"text": "消息3", "direction": "incoming"}]

    jiggled = []
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", fake_read)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))

    # badge=3，纯文字场景，UIA 节点逐步加载中
    cand = {"sender": "客户B", "content": "消息3", "badge": 3,
            "name": "客户B\n[3条] \n消息3\n10:00\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)

    assert len(jiggled) == 2, (
        f"双读有改善且仍少于 badge，必须触发第三次 jiggle，实际 {len(jiggled)} 次"
    )
    assert msgs == ["消息1", "消息2", "消息3"], f"第三次 jiggle 后取最全结果，实际 {msgs!r}"
