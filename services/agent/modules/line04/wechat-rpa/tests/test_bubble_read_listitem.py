# -*- coding: utf-8 -*-
"""气泡读取真机适配守卫（2026-07-02 rog 探针实证，根治"连发5条只回1条"）。

真机事实（probe2/probe3，微信 4.1.8 mmui）：
- 聊天面板消息**不以 Text 控件暴露**——整窗只有 3 个 Text（"发送"按钮 + 2×标题）。
- 消息全在 name="消息" 的 List 的 ListItem 里（name=消息文本，无子元素，外框横跨全宽）。
- 故几何判方向已死：方向只能靠"匹配自己发过的文本"（_SENT_TEXTS 历史）。

旧 read_chat_bubbles（只读 Text）在真机上唯一读到的"气泡"是右侧"发送"按钮 →
被判 outgoing 锚点 → trailing 永远空 → 有角标走 F1 只回预览单条（5 条丢 4 条），
无角标无限开窗重试（= 用户看到的"每几秒闪一下"）。

本文件是该 bug 的永久 regression test，禁止删除。
"""
import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _MsgItem:
    """消息 List 的 ListItem：name=消息文本，无子元素，外框横跨面板全宽（真机形态）。"""

    def __init__(self, text):
        self.element_info = _EI(name=text, control_type="ListItem")

    def rectangle(self):
        return _Rect(729, 200, 1269, 280)


class _MsgList:
    def __init__(self, items, name="消息"):
        self.element_info = _EI(name=name, control_type="List")
        self._items = items

    def rectangle(self):
        return _Rect(729, 199, 1269, 748)

    def children(self):
        return list(self._items)


class _MW:
    """真机形态 Fake：List("消息") 有消息，Text 只有"发送"按钮（探针实拍）。"""

    def __init__(self, msg_items, texts=None, lists=None):
        self.element_info = _EI()
        self._lists = lists if lists is not None else [_MsgList(msg_items)]
        self._texts = texts or []

    def rectangle(self):
        return _Rect(91, 79, 1268, 928)

    def descendants(self, control_type=None):
        if control_type == "List":
            return list(self._lists)
        if control_type == "Text":
            return list(self._texts)
        return []


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name, control_type="Text")
        self._rect = rect

    def rectangle(self):
        return self._rect


@pytest.fixture(autouse=True)
def _clean_state():
    listen_chat._SENT_TEXTS.clear() if hasattr(listen_chat, "_SENT_TEXTS") else None
    yield
    if hasattr(listen_chat, "_SENT_TEXTS"):
        listen_chat._SENT_TEXTS.clear()


# ── 核心：消息藏在 List("消息") ListItem 里，必须读得到 ─────────────────────────

def test_read_chat_bubbles_from_message_list():
    """真机形态（消息在 List("消息") ListItem、Text 只有发送按钮）必须读到全部消息。

    旧代码只读 Text → 返回 ["发送"] 或 []，5 条消息全丢。
    """
    mw = _MW(
        msg_items=[_MsgItem("在吗"), _MsgItem("什么价格"), _MsgItem("发下资料")],
        texts=[_Text("发送", _Rect(1179, 871, 1215, 890))],
    )
    bubbles = listen_chat.read_chat_bubbles(mw)
    got = [b["text"] for b in bubbles]
    assert got == ["在吗", "什么价格", "发下资料"], (
        f"必须从 List('消息') ListItem 读到全部消息，实际读到 {got!r}"
    )


def test_read_chat_bubbles_direction_by_sent_history():
    """方向判定：匹配 _SENT_TEXTS（自己发过的文本）= outgoing，其余 incoming。

    真机 ListItem 外框横跨全宽且无子元素 → 几何判向不可用。
    """
    listen_chat._record_sent_text("您好，产品99元，需要发资料给您吗？")
    mw = _MW(msg_items=[
        _MsgItem("什么价格"),
        _MsgItem("您好，产品99元，需要发资料给您吗？"),
        _MsgItem("发下资料"),
    ])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert [b["direction"] for b in bubbles] == ["incoming", "outgoing", "incoming"]


def test_read_chat_bubbles_no_sent_history_all_incoming():
    """无已发送历史（新装/重启丢历史）→ 全判 incoming（split_trailing_incoming
    的 badge_n 闸兜底防翻陈年消息，不在本函数职责）。"""
    mw = _MW(msg_items=[_MsgItem("在吗"), _MsgItem("什么价格")])
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert [b["direction"] for b in bubbles] == ["incoming", "incoming"]


def test_read_chat_bubbles_legacy_text_path_skips_send_button():
    """无 List("消息")（其他微信版本回退 Text 几何路径）：必须剔除"发送"按钮文本。

    旧 bug：发送按钮在面板右侧 → 被当 outgoing 气泡 → 假锚点。
    """
    mw = _MW(
        msg_items=[],
        lists=[],  # 无消息 List → 走 legacy Text 路径
        texts=[
            _Text("在吗", _Rect(400, 480, 560, 520)),
            _Text("发送", _Rect(1100, 871, 1140, 890)),
        ],
    )
    bubbles = listen_chat.read_chat_bubbles(mw)
    assert {"text": "发送", "direction": "outgoing"} not in bubbles, (
        "发送按钮文本绝不能被当成气泡"
    )
    assert any(b["text"] == "在吗" for b in bubbles)


# ── 锚点推进：按"上次回复到哪条 incoming"切分（原重构 spec，比 last-outgoing 强）──

def test_split_trailing_with_replied_anchor():
    """回复送达前又进来的消息（在 outgoing 之上）不能丢：
    锚点 = 上次已回复到的最后一条 incoming（replied_anchor），不是最后一条 outgoing。

    场景（真机 22:59 实况）：回了"3."之后 4/5 在回复送达前已进来 →
    气泡序 [in3, in4, in5, out回复]。按 last-outgoing 切 trailing=[]（4/5 永久丢）；
    按 replied_anchor="3." 切 trailing=[4,5] ✓。
    """
    bubbles = [
        {"text": "3. 发下资料", "direction": "incoming"},
        {"text": "4. 你们公司信息", "direction": "incoming"},
        {"text": "5. 怎么联系你", "direction": "incoming"},
        {"text": "可以，你先把用途和预算发我", "direction": "outgoing"},
    ]
    out = listen_chat.split_trailing_incoming(
        bubbles, badge_n=0, replied_anchor="3. 发下资料")
    assert out == ["4. 你们公司信息", "5. 怎么联系你"]


def test_split_trailing_anchor_absent_falls_back_to_last_outgoing():
    """replied_anchor 在气泡里找不到（滚出可视区/被清）→ 回退最后 outgoing 锚点。"""
    bubbles = [
        {"text": "老问题", "direction": "incoming"},
        {"text": "老回复", "direction": "outgoing"},
        {"text": "新问题", "direction": "incoming"},
    ]
    out = listen_chat.split_trailing_incoming(
        bubbles, badge_n=0, replied_anchor="找不到的锚点")
    assert out == ["新问题"]


def test_commit_reply_success_advances_reply_anchor():
    """DELIVERED 后锚点推进：_commit_reply_success 把该 batch 最后一条 incoming
    写进 _REPLY_ANCHOR[sender]，下轮据此切 trailing。"""
    listen_chat._REPLY_ANCHOR.clear()
    msg = {"sender": "默忆", "_preview_name": "默忆\n3. 发下资料\n22:59\n",
           "_last_incoming": "3. 发下资料"}
    listen_chat._commit_reply_success(msg, {})
    assert listen_chat._REPLY_ANCHOR.get("默忆") == "3. 发下资料"


# ── 死循环熔断：trailing 空转 N 轮必须走回退，绝不无限开窗（= 闪屏根治）──────────

def test_scan_stall_fallback_emits_preview(monkeypatch):
    """无角标触发的会话 trailing 连续空转 → 熔断走回退 emit 预览单条，
    绝不无限开窗（22:59:32 起每 6-10 秒反复 _open_chat 的死循环 = 用户看到的闪屏）。
    """
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    # 气泡可读但 trailing 恒空且非陈旧（last_out ≠ 预览）→ 旧代码无限保留触发态
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "老消息", "direction": "incoming"},
        {"text": "老回复", "direction": "outgoing"},
    ])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()

    class _Item:
        def __init__(self, name):
            self.element_info = _EI(name=name, control_type="ListItem")

    class _ScanMW:
        def __init__(self):
            self.element_info = _EI()

        def rectangle(self):
            return _Rect(0, 0, 800, 600)

        def descendants(self, control_type=None):
            if control_type == "ListItem":
                return [_Item("默忆\n4. 你们公司信息\n23:00\n")]
            return []

    mw = _ScanMW()
    last_preview = {"默忆": "默忆\n3. 发下资料\n22:59\n"}  # 预览已变 → 触发
    emitted = []
    for _ in range(listen_chat.TRAILING_STALL_LIMIT + 1):
        emitted.extend(listen_chat.scan_unread(mw, last_preview))
    assert emitted, (
        f"trailing 空转 {listen_chat.TRAILING_STALL_LIMIT} 轮后必须熔断走回退 emit，"
        "绝不无限开窗（闪屏死循环）"
    )
    assert emitted[0]["sender"] == "默忆"
    assert "4. 你们公司信息" in emitted[0]["content"]


# ── 已发送文本持久化（重启不丢方向判定锚点）─────────────────────────────────────

def test_sent_texts_persist_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(listen_chat, "_SENT_TEXTS_FILE",
                        str(tmp_path / "zj-sent-texts.json"))
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("您好，在的")
    listen_chat._record_sent_text("产品99元")
    listen_chat._SENT_TEXTS.clear()
    loaded = listen_chat._load_sent_texts()
    assert "您好，在的" in loaded and "产品99元" in loaded
