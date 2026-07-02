# -*- coding: utf-8 -*-
"""1.0.95 三刀守卫（2026-07-03 01:49-01:51 真机实况定义）：

事故链（1.0.94 上仍复现"发4条只回1条"+ 自回自话）：
1. runtime_id 排序有毒：Qt 虚拟列表重建旧气泡会分配**新** runtime_id →
   旧"在吗"排到序列末尾 → 锚点(=最后一次 incoming 出现)切到末尾 →
   用户新消息 2-4 全被切飞（trailing 空 → stall 熔断）。
   修：按 rect.top 显示序排（微信里显示序=时序），丢弃与消息 List 视口
   不相交的回收槽 item。
2. 熔断/F1 回退 emit 预览单条，而回复后预览=机器人自己的回复文本 →
   自己的话被当客户消息回一遍（01:51:03 实锤）。
   修：回退 emit 前 _matches_any_sent(preview) 命中 → 不 emit，提交触发。
3. _stale_ok 只认"气泡里最后 outgoing==预览"，方向历史缺失时永不命中 →
   无限重试。修：预览本身命中已发送历史也算陈旧确认。

本文件是该事故的永久 regression test，禁止删除。
"""
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
    def __init__(self, name="", control_type="", runtime_id=None):
        self.name = name
        self.control_type = control_type
        self.handle = 12345
        if runtime_id is not None:
            self.runtime_id = runtime_id


class _MsgItem:
    def __init__(self, text, top, runtime_id=None):
        self.element_info = _EI(name=text, control_type="ListItem",
                                runtime_id=runtime_id)
        self._rect = _Rect(729, top, 1269, top + 60)

    def rectangle(self):
        return self._rect


class _MsgList:
    def __init__(self, items):
        self.element_info = _EI(name="消息", control_type="List")
        self._items = items

    def rectangle(self):
        return _Rect(729, 199, 1269, 748)

    def children(self):
        return list(self._items)


class _MW:
    def __init__(self, msg_items):
        self.element_info = _EI()
        self._list = _MsgList(msg_items)

    def rectangle(self):
        return _Rect(91, 79, 1268, 928)

    def descendants(self, control_type=None):
        if control_type == "List":
            return [self._list]
        return []


# ── 刀1：显示序（rect.top），runtime_id 不可信 ─────────────────────────────────

def test_bubbles_ordered_by_display_position_not_runtime_id():
    """旧气泡被 Qt 重建拿到最大的 runtime_id（真机实况）——排序必须按显示位置，
    否则锚点切到末尾、新消息全丢。"""
    mw = _MW([
        # 树序乱 + runtime_id 与时序矛盾：旧"在吗"重建后 id 最大（-100 > -400）
        _MsgItem("新消息B", top=500, runtime_id=(42, 1, 4, -300)),
        _MsgItem("在吗", top=210, runtime_id=(42, 1, 4, -100)),
        _MsgItem("新消息A", top=400, runtime_id=(42, 1, 4, -400)),
    ])
    got = [b["text"] for b in listen_chat.read_chat_bubbles(mw)]
    assert got == ["在吗", "新消息A", "新消息B"], (
        f"必须按 rect.top 显示序，实际 {got!r}（runtime_id 排序会把重建的旧气泡排到末尾）"
    )


def test_bubbles_skip_items_outside_list_viewport():
    """与消息 List 视口不相交的 item = 虚拟列表回收槽（stale rect），必须丢弃。"""
    mw = _MW([
        _MsgItem("回收槽幽灵", top=5000),      # 远在视口外
        _MsgItem("真消息", top=300),
    ])
    got = [b["text"] for b in listen_chat.read_chat_bubbles(mw)]
    assert got == ["真消息"]


# ── 刀2：回退 emit 自回声护栏 ───────────────────────────────────────────────────

class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


class _ScanMW:
    def __init__(self, item_name):
        self.element_info = _EI()
        self._name = item_name

    def rectangle(self):
        return _Rect(0, 0, 800, 600)

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return [_Item(self._name)]
        return []


@pytest.fixture
def _scan_env(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()


def test_anchor_trailing_never_emits_own_sent_text(_scan_env, monkeypatch):
    """自己发过的文本即使被判向层误判成 incoming 进了 trailing，emit 层也必须滤掉
    （自回自话终极护栏，01:51:03 实锤：机器人把自己的回复当客户消息又回了一遍）。"""
    own_reply = "在的，你把用途和预算发我，小齐直接给你对产品。"
    listen_chat._record_sent_text(own_reply)
    # 模拟方向误判：自己的回复被标成 incoming（污染/冷启动丢历史后的真机实况）
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
        {"text": own_reply, "direction": "incoming"},
    ])
    mw = _ScanMW(f"默忆\n{own_reply}\n01:49\n")
    last_preview = {"默忆": "默忆\n在吗\n01:49\n"}  # 预览已变 → 触发
    emitted = []
    for _ in range(listen_chat.TRAILING_STALL_LIMIT + 2):
        emitted.extend(listen_chat.scan_unread(mw, last_preview))
    for m in emitted:
        assert own_reply not in m["content"], (
            f"自己发过的文本绝不能出现在 emit content 里（自回自话），实际 {m!r}"
        )


def test_stall_fallback_skips_own_sent_preview(_scan_env, monkeypatch):
    """熔断回退的预览内容命中已发送历史 → 不 emit，提交触发停止重试开窗。"""
    own_reply = "在的，你把用途和预算发我，小齐直接给你对产品。"
    listen_chat._record_sent_text(own_reply)
    # trailing 恒空且非陈旧（last_out 与预览不同文本）→ 走 stall 路径
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "老消息", "direction": "incoming"},
        {"text": "老回复", "direction": "outgoing"},
    ])
    mw = _ScanMW(f"默忆\n{own_reply}\n01:49\n")
    last_preview = {"默忆": "默忆\n在吗\n01:49\n"}
    emitted = []
    for _ in range(listen_chat.TRAILING_STALL_LIMIT + 2):
        emitted.extend(listen_chat.scan_unread(mw, last_preview))
    assert not emitted, (
        f"预览=自己发过的文本，熔断回退绝不能 emit 它，实际 {emitted!r}"
    )
    assert last_preview["默忆"] == f"默忆\n{own_reply}\n01:49\n", (
        "应提交触发消费（last_preview 更新），停止无限重试开窗"
    )


def test_stale_commit_when_preview_matches_sent_history(_scan_env, monkeypatch):
    """trailing 空 + 预览命中已发送历史 → 第一轮就该提交触发（不进 3 轮 stall）。"""
    own_reply = "行，你把用途和预算发我，小齐直接给你对产品和价格，省得来回问。"
    listen_chat._record_sent_text(own_reply)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "好吧", "direction": "incoming"},
        {"text": own_reply, "direction": "outgoing"},
    ])
    mw = _ScanMW(f"默忆\n{own_reply}\n00:40\n")
    last_preview = {"默忆": "默忆\n好吧\n00:40\n"}
    listen_chat.scan_unread(mw, last_preview)
    assert last_preview["默忆"] == f"默忆\n{own_reply}\n00:40\n", (
        "预览=自己的回复 → 第一轮就提交触发，不该反复开窗"
    )
    assert listen_chat._TRAILING_STALL.get("默忆", 0) == 0


# ── 刀3（conftest 生效自检）：pytest 绝不碰真实持久化路径 ─────────────────────────

def test_persistence_paths_isolated_from_real_files():
    assert "zj-sent-texts" in listen_chat._SENT_TEXTS_FILE
    assert not listen_chat._SENT_TEXTS_FILE.startswith(r"C:\Users\Public"), (
        "conftest 必须把持久化路径重定向到 tmp——CI 在 rog 上跑 pytest 曾把"
        "真实文件覆盖成测试垃圾（2026-07-03 事故）"
    )
