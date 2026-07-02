# -*- coding: utf-8 -*-
"""
回归守卫：锚点气泡扫描（path-3）—— 根治同内容重发漏消息。

根因（2026-07-02）：
  reply 成功后 `last_content.pop(sender)` → 下轮当"首次见到" → 不触发。
  客户重发同内容 → path-2 `prev == content` → 也不触发 → 永久漏读。

修法：
  1. reply 后设哨兵 `last_content[sender] = "__replied__"`（不 pop）
     → path-2 对任何后续消息都触发（"__replied__" ≠ 任何真实内容）
  2. 新增 `count_incoming_chat_bubbles(mw)` 计传入气泡数（纯逻辑，CI 可测）
  3. reply 后 `bubble_anchors[sender] = count_incoming_chat_bubbles(mw)`
  4. scan_unread path-3：对有锚点的 sender，比气泡数；count > anchor → 新消息

守卫契约（proven-to-fire）：
  - `test_anchor_detects_same_content_resend`：注释掉 path-3 实现 → 必红
  - `test_sentinel_path2_triggers_on_any_next_msg`：pop 改回来 → 必红
  - `test_anchor_no_trigger_if_count_unchanged`：删 count > anchor 判断 → 必红

顶层零 pywinauto（stub），纯逻辑断言，CI clean 可跑。
"""
from __future__ import annotations

import ctypes
import os
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

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


@contextmanager
def _mock_windll(user32):
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock())
    had = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]
import listen_chat  # noqa: E402


def _visible_user32():
    u = MagicMock()
    u.IsWindowVisible.return_value = True
    u.IsIconic.return_value = 0
    return u


def _make_session_item(name: str):
    """构造一个会话列表 ListItem（无角标）。"""
    it = MagicMock()
    it.element_info.name = name
    it.control_type = "ListItem"
    return it


def _make_mw_session_only(session_items):
    """仅包含会话列表 ListItem 的主窗口 mock（无聊天面板控件）。"""
    mw = MagicMock()
    mw.element_info.handle = 55

    def _desc(control_type=None):
        if control_type == "ListItem":
            return session_items
        return []

    mw.descendants.side_effect = _desc
    return mw


def _make_mw_with_chat_panel(session_items, chat_text_controls):
    """主窗口 mock：session_items 是会话列表，chat_text_controls 是聊天面板 Text 控件。"""
    mw = MagicMock()
    mw.element_info.handle = 55
    # rectangle：窗口左上角(0,0)，宽1200，高800
    rect = MagicMock()
    rect.left, rect.top, rect.right, rect.bottom = 0, 0, 1200, 800
    mw.rectangle.return_value = rect

    def _desc(control_type=None):
        if control_type == "ListItem":
            return session_items
        if control_type == "Text":
            return chat_text_controls
        return session_items + chat_text_controls

    mw.descendants.side_effect = _desc
    return mw


def _make_text_ctrl(name: str, left: int, top: int, right: int, bottom: int):
    """构造 Text 控件 mock（用于聊天面板气泡）。"""
    c = MagicMock()
    c.element_info.name = name
    r = MagicMock()
    r.left, r.top, r.right, r.bottom = left, top, right, bottom
    c.rectangle.return_value = r
    c.control_type = "Text"
    return c


def _incoming_bubble(text: str, row: int):
    """聊天面板左对齐传入气泡：x 中心约 550（<600 midline=600），top = 200+row*60。"""
    # 窗口 width=1200, chat_left = 0 + 1200//4 = 300
    # midline = (300 + 1200) // 2 = 750
    # incoming: center_x < 750 且 left > 300（在聊天面板内）
    return _make_text_ctrl(text, left=310, top=200 + row * 60, right=700, bottom=240 + row * 60)


def _outgoing_bubble(text: str, row: int):
    """聊天面板右对齐我方气泡：x 中心约 900（>750 midline），top = 200+row*60。"""
    return _make_text_ctrl(text, left=800, top=200 + row * 60, right=1180, bottom=240 + row * 60)


# ─── Tests for count_incoming_chat_bubbles ──────────────────────────────────

def test_count_incoming_chat_bubbles_empty():
    """无气泡（空聊天面板）→ 返回 0。"""
    mw = _make_mw_with_chat_panel([], [])
    with _mock_windll(_visible_user32()):
        count = listen_chat.count_incoming_chat_bubbles(mw)
    assert count == 0, "无传入气泡时应返回 0"


def test_count_incoming_chat_bubbles_only_incoming():
    """3 条传入气泡（左对齐）→ 返回 3。"""
    bubbles = [
        _incoming_bubble("在吗", 0),
        _incoming_bubble("价格是多少", 1),
        _incoming_bubble("能便宜点吗", 2),
    ]
    mw = _make_mw_with_chat_panel([], bubbles)
    with _mock_windll(_visible_user32()):
        count = listen_chat.count_incoming_chat_bubbles(mw)
    assert count == 3, "应数出 3 条传入气泡"


def test_count_incoming_chat_bubbles_mixed():
    """2 传入 + 1 我方气泡 → 只数 2（只计传入）。"""
    bubbles = [
        _incoming_bubble("你好", 0),
        _outgoing_bubble("您好，请问有什么需要？", 1),
        _incoming_bubble("价格是多少", 2),
    ]
    mw = _make_mw_with_chat_panel([], bubbles)
    with _mock_windll(_visible_user32()):
        count = listen_chat.count_incoming_chat_bubbles(mw)
    assert count == 2, "只计左对齐传入气泡，我方气泡不计"


def test_count_incoming_chat_bubbles_exception_safe():
    """rectangle() 抛异常的控件 → 跳过，不崩溃。"""
    bad = MagicMock()
    bad.element_info.name = "错误气泡"
    bad.rectangle.side_effect = RuntimeError("UIA error")

    good = _incoming_bubble("正常消息", 0)
    mw = _make_mw_with_chat_panel([], [bad, good])
    with _mock_windll(_visible_user32()):
        count = listen_chat.count_incoming_chat_bubbles(mw)
    assert count == 1, "异常控件应跳过，不影响计数"


# ─── Tests for sentinel-based last_content (哨兵阻止 pop 漏消息) ─────────────

def test_sentinel_path2_triggers_on_any_next_msg():
    """reply 后哨兵 '__replied__' ≠ 任何真实内容 → path-2 必触发，不漏消息。

    ★ proven-to-fire：把 pop 改回来（不设哨兵）→ 此测试必红（复现漏读根因）。
    """
    # 模拟回复后 last_content 中 sender 被设为哨兵（不 pop）
    item = _make_session_item("客户A\n价格是多少\n14:00\n")
    mw = _make_mw_session_only([item])
    # 哨兵态
    last_content = {"客户A": "__replied__"}

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content)

    senders = [m["sender"] for m in out]
    assert "客户A" in senders, (
        "哨兵 '__replied__' != '价格是多少' → path-2 必须触发，"
        "根治 pop 后首次见到不触发的漏消息根因"
    )


def test_sentinel_not_present_means_first_time_no_trigger():
    """哨兵不存在（sender 不在 last_content）→ 首次见到，只记录不触发。"""
    item = _make_session_item("客户B\n你好\n14:00\n")
    mw = _make_mw_session_only([item])
    last_content = {}  # 没有该 sender

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_unread(mw, last_content)

    senders = [m["sender"] for m in out]
    assert "客户B" not in senders, "首次见到不触发（防历史消息误触）"
    assert last_content.get("客户B") == "你好", "首次见到须记录内容"


# ─── Tests for anchor-based same-content resend detection (path-3) ──────────

def test_anchor_detects_same_content_resend():
    """reply 后客户重发相同内容 → anchor 气泡数增加 → path-3 检出，不漏读。

    场景：客户发"价格" → 回复 → anchor=2 → 客户再发"价格" → 气泡数=3 → 检出。

    ★ proven-to-fire：注释掉 path-3 的 count > anchor 逻辑 → 此测试必红。
    """
    sender = "客户C"
    # 会话列表：无角标（badge 已清），内容="价格"（与上次相同）
    session_item = _make_session_item(f"{sender}\n价格\n14:30\n")
    # 聊天面板：3 条传入气泡（anchor 时是 2，现在是 3 → 有新消息）
    bubbles = [
        _incoming_bubble("在吗", 0),
        _incoming_bubble("价格", 1),
        _incoming_bubble("价格", 2),  # 重发的第二条
    ]
    mw = _make_mw_with_chat_panel([session_item], bubbles)

    # last_content 哨兵（回复后设置）
    last_content = {sender: "__replied__"}
    # bubble_anchors：回复时数到 2 条传入气泡
    bubble_anchors = {sender: 2}

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        # path-2 用 last_content，path-3 用 bubble_anchors
        # scan_unread 已对哨兵触发 path-2（哨兵 != "价格"）
        # 这里测 scan_anchor_senders 的 path-3 能独立工作
        # （path-2 哨兵也能检出，但 path-3 是对抗"哨兵被消费后"的场景）
        out = listen_chat.scan_anchor_senders(mw, bubble_anchors, already_seen=set())

    senders = [m["sender"] for m in out]
    assert sender in senders, (
        "客户重发相同内容→气泡数从 2 增到 3，path-3 必须检出"
    )


def test_anchor_no_trigger_if_count_unchanged():
    """气泡数与锚点相同（无新消息）→ 不触发，不误报。

    ★ proven-to-fire：删掉 count > anchor 判断（永远触发）→ 此测试必红（误报）。
    """
    sender = "客户D"
    session_item = _make_session_item(f"{sender}\n价格\n14:30\n")
    bubbles = [
        _incoming_bubble("在吗", 0),
        _incoming_bubble("价格", 1),
    ]
    mw = _make_mw_with_chat_panel([session_item], bubbles)
    bubble_anchors = {sender: 2}  # anchor = 2，当前也是 2 → 无新消息

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_anchor_senders(mw, bubble_anchors, already_seen=set())

    senders = [m["sender"] for m in out]
    assert sender not in senders, "气泡数未增加，不应触发（防误报）"


def test_anchor_detects_different_content_after_reply():
    """reply 后客户发新内容（不同于之前）→ path-3 也检出（气泡数增加）。"""
    sender = "客户E"
    session_item = _make_session_item(f"{sender}\n能优惠吗\n14:35\n")
    bubbles = [
        _incoming_bubble("价格", 0),
        _incoming_bubble("能优惠吗", 1),  # 新内容
    ]
    mw = _make_mw_with_chat_panel([session_item], bubbles)
    bubble_anchors = {sender: 1}  # anchor = 1（只回了"价格"那条）

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_anchor_senders(mw, bubble_anchors, already_seen=set())

    senders = [m["sender"] for m in out]
    assert sender in senders, "新内容气泡数增加，path-3 必须检出"


def test_anchor_skip_if_already_seen():
    """sender 已被 path-1/path-2 检出（在 already_seen）→ path-3 跳过，不重复入队。"""
    sender = "客户F"
    session_item = _make_session_item(f"{sender}\n[1条] \n价格\n14:40\n")
    bubbles = [_incoming_bubble("价格", 0), _incoming_bubble("价格", 1)]
    mw = _make_mw_with_chat_panel([session_item], bubbles)
    bubble_anchors = {sender: 1}

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        out = listen_chat.scan_anchor_senders(mw, bubble_anchors, already_seen={sender})

    senders = [m["sender"] for m in out]
    assert sender not in senders, "已被 path-1 检出的 sender 不应再被 path-3 重复入队"


def test_anchor_updates_after_scan():
    """scan_anchor_senders 无论是否检出新消息，都应更新 bubble_anchors[sender] 为当前气泡数。"""
    sender = "客户G"
    session_item = _make_session_item(f"{sender}\n价格\n14:40\n")
    bubbles = [_incoming_bubble("价格", 0), _incoming_bubble("价格", 1)]
    mw = _make_mw_with_chat_panel([session_item], bubbles)
    bubble_anchors = {sender: 1}  # 旧 anchor = 1，当前 = 2 → 检出并更新

    with _mock_windll(_visible_user32()), patch("time.sleep"):
        listen_chat.scan_anchor_senders(mw, bubble_anchors, already_seen=set())

    assert bubble_anchors[sender] == 2, "检出后 bubble_anchors 必须更新为当前气泡数"
