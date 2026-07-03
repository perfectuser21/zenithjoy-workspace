# -*- coding: utf-8 -*-
"""无条件双读守卫（2026-07-03 09:15 真机实况定义，1.0.99）：

事故：会话打开状态下进来的消息被微信自动标已读（无角标），读气泡那刻其 UIA
节点恰好没挂出来（屏显但读不到的老毛病）→ 1.0.97 的完整性校验以"角标数"做
期望值，无角标消息不计入 → 校验假通过、不触发 jiggle → 下一批回复后锚点越过
它 → "什么价格 现在" 永久丢失（探针实锤它挂在会话里无人理）。

修法：读气泡不再依赖角标判断完整性——**每次都** 读→jiggle 微滚→再读，
trailing 取更全的一次。角标数只作为第三次重读的加严信号保留。
本文件是该事故的永久 regression test。
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


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


class _MW:
    def __init__(self):
        self.element_info = _EI()

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        return []


@pytest.fixture
def _env(monkeypatch):
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._REPLY_ANCHOR.clear()


def test_no_badge_missing_node_recovered_by_double_read(_env, monkeypatch):
    """无角标消息（会话打开时进来被自动已读）首读缺节点 → 双读必须捞回。

    09:15 实况：badge=2（3.和5.），"什么价格 现在"无角标且首读缺节点 →
    1.0.97 按角标判"读全了"不重读 → 永久丢。1.0.99 无条件双读必须修复。
    """
    first = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "3. 发下资料", "direction": "incoming"},
        {"text": "5. 怎么联系你", "direction": "incoming"},
    ]
    full = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "什么价格 现在", "direction": "incoming"},
        {"text": "3. 发下资料", "direction": "incoming"},
        {"text": "5. 怎么联系你", "direction": "incoming"},
    ]
    reads = []

    def fake_read(mw):
        reads.append(1)
        return first if len(reads) == 1 else full

    jiggled = []
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", fake_read)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: jiggled.append(1))

    # badge=2 == 首读 trailing 数：1.0.97 的角标校验在这里假通过
    cand = {"sender": "默忆", "content": "5. 怎么联系你", "badge": 2,
            "name": "默忆\n[2条] \n5. 怎么联系你\n09:15\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)
    assert jiggled, "必须无条件 jiggle 双读（角标数不可信：无角标消息不计入）"
    assert "什么价格 现在" in msgs, (
        f"首读缺节点的无角标消息必须被双读捞回，实际 {msgs!r}"
    )


def test_double_read_keeps_first_when_second_not_better(_env, monkeypatch):
    """第二读没更全 → 用首读结果（双读只增不减）。"""
    first = [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "在吗", "direction": "incoming"},
    ]
    reads = []

    def fake_read(mw):
        reads.append(1)
        return first if len(reads) == 1 else first[:1]  # 第二读更少

    monkeypatch.setattr(listen_chat, "read_chat_bubbles", fake_read)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    cand = {"sender": "默忆", "content": "在吗", "badge": 1,
            "name": "默忆\n[1条] \n在吗\n09:15\n", "_item": _Item("x")}
    msgs, empty = listen_chat._read_trailing_for(_MW(), cand)
    assert msgs == ["在吗"]
