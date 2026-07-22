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


def test_image_badge_not_counted_as_missing_text(monkeypatch):
    """badge=2 含 1 图片 + 1 文字，图片在 UIA 树里无文本节点（media=True）→ 不触发第三次 jiggle。
    回归：修复前图片场景 badge 加严 jiggle 恒触发，_jiggle_msg_list 把新到文字消息
    滚出视口导致下条文字消息永久丢失（Issue 4024c90b）。
    """
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()

    # 图片消息在 UIA 树无文本节点，由 read_chat_bubbles 以 media=True 标记；
    # 文字消息正常带 text。badge=2 包含图片+文字两条计数。
    bubbles_with_image = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "", "direction": "incoming", "media": True},   # 图片消息
        {"text": "你好", "direction": "incoming"},               # 文字消息
    ]
    jiggled = []
    monkeypatch.setattr(listen_chat, "read_chat_bubbles",
                        lambda mw: bubbles_with_image)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))

    cand = {"sender": "默忆", "content": "你好", "badge": 2,
            "name": "默忆\n[2条] \n你好\n08:18\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)

    assert msgs == ["你好"], f"文字消息必须被读到，实际 {msgs!r}"
    # v1.0.99 无条件双读只 jiggle 一次；图片条目已计入 badge 但不产生文本 msgs
    # → 不应再触发第三次 badge 加严 jiggle（否则恒触发，可把下条文字消息滚出视口）
    assert len(jiggled) == 1, (
        f"图片场景不应触发 badge 加严第三次 jiggle（实际 jiggle {len(jiggled)} 次）；"
        "badge 含图片计数，须扣除非文本气泡后再与 len(msgs) 比较"
    )
