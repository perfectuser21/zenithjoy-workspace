"""
回归测试 — 三 bug fix（2026-06-13）：
1. _parse_item_name 过滤截断版 "文件"（原为 "文件传输助手"）
2. _chat_title_matches 截断名字前缀匹配 + 失败时 _log 打印找到的文本
3. _open_chat 离屏坐标时重新扫描列表找新 item

【CI 安全】顶层零 pywinauto/win32 import；纯 Fake/Mock 对象，跨平台可跑。
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


# ─── 公共 Fake 类 ─────────────────────────────────────────────────────────────

class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _EI:
    def __init__(self, name="", handle=12345):
        self.name = name
        self.automation_id = ""
        self.handle = handle
        self.class_name = "mmui::MainWindow"


class _FakeText:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


# ═══════════════════════════════════════════════════════════════════════════════
# Bug 3 — SKIP_SENDERS 截断 "文件"
# ═══════════════════════════════════════════════════════════════════════════════

def test_parse_item_name_skip_file_truncated():
    """WeChat 4.x 截断 '文件传输助手' → '文件'；应被 SKIP_SENDERS 过滤。"""
    name = "文件\n[1条] \n图片\n14:30\n"
    result = listen_chat._parse_item_name(name)
    assert result is None, "'文件' 应被 SKIP_SENDERS 过滤"


def test_parse_item_name_file_chuanshu_still_filtered():
    """完整 '文件传输助手' 仍应被过滤。"""
    name = "文件传输助手\n[2条] \n[图片]\n15:00\n"
    result = listen_chat._parse_item_name(name)
    assert result is None, "'文件传输助手' 仍应被过滤"


# ═══════════════════════════════════════════════════════════════════════════════
# Bug 1 — _chat_title_matches 截断前缀匹配
# ═══════════════════════════════════════════════════════════════════════════════

class _TitleMWCustom:
    """主窗口 Fake：标题区 right > 200 且 top < 150。"""
    WIN = _Rect(0, 0, 800, 600)

    def __init__(self, title_text: str):
        self.element_info = _EI()
        self._title_text = title_text

    def rectangle(self):
        return self.WIN

    def descendants(self, control_type=None):
        if control_type == "Text":
            return [_FakeText(self._title_text, _Rect(300, 20, 600, 50))]
        return []


def test_chat_title_matches_exact_still_works():
    """精确匹配不应被破坏。"""
    mw = _TitleMWCustom("默忆")
    assert listen_chat._chat_title_matches(mw, "默忆") is True


def test_chat_title_matches_prefix_truncated():
    """标题显示前缀（截断）→ want.startswith(nm) 应返回 True。"""
    mw = _TitleMWCustom("徐先生企业自媒体")
    result = listen_chat._chat_title_matches(mw, "徐先生企业自媒体-Ai助力")
    assert result is True, "标题是 sender 前缀时应返回 True"


def test_chat_title_matches_prefix_min_length():
    """前缀 < 4 字不作为匹配依据（防单字/双字误判）。"""
    mw = _TitleMWCustom("徐先")
    result = listen_chat._chat_title_matches(mw, "徐先生企业自媒体-Ai助力")
    assert result is False, "标题 < 4 字时不应作为前缀匹配"


def test_chat_title_matches_false_unrelated():
    """完全无关标题仍返回 False。"""
    mw = _TitleMWCustom("完全不同的人")
    assert listen_chat._chat_title_matches(mw, "徐先生企业自媒体-Ai助力") is False


def test_chat_title_matches_logs_found_texts(monkeypatch):
    """匹配失败时 _log 打印找到的 texts（调试用）。"""
    mw = _TitleMWCustom("完全不同的名字")
    logged_msgs = []
    monkeypatch.setattr(listen_chat, "_log", lambda m: logged_msgs.append(m))
    result = listen_chat._chat_title_matches(mw, "目标联系人")
    assert result is False
    has_debug_log = any("完全不同的名字" in m or "目标联系人" in m for m in logged_msgs)
    assert has_debug_log, f"失败时应 _log 找到的 texts，实际={logged_msgs!r}"


# ═══════════════════════════════════════════════════════════════════════════════
# Bug 2 — _open_chat 离屏坐标重新扫描
# ═══════════════════════════════════════════════════════════════════════════════

class _StaleItem:
    """rectangle() 返回离屏坐标。"""
    def __init__(self, sender: str):
        self.element_info = _EI(name=f"{sender}\n[1条] \n消息内容\n15:00\n")
        self.iface_invoke = MagicMock()
        self.iface_selection_item = MagicMock()
        self.iface_selection_item.Select.side_effect = AttributeError("no iface")
        self.iface_selection_item.CurrentIsSelected = False

    def rectangle(self):
        return _Rect(31989, 32000, 32100, 32020)


class _FreshItem:
    """坐标正常的重扫后 item。"""
    def __init__(self, sender: str):
        self.element_info = _EI(name=f"{sender}\n[1条] \n消息内容\n15:00\n")
        self.iface_invoke = MagicMock()
        self.iface_selection_item = MagicMock()
        self.iface_selection_item.Select = MagicMock()
        self.iface_selection_item.CurrentIsSelected = False

    def rectangle(self):
        return _Rect(200, 300, 400, 350)


class _MWWithFreshItem:
    """主窗口 Fake：ListItem 返回 fresh_item；Text 返回 sender 标题。"""
    WIN = _Rect(0, 0, 800, 600)

    def __init__(self, sender: str, fresh_item: _FreshItem):
        self.element_info = _EI()
        self._sender = sender
        self._fresh_item = fresh_item

    def rectangle(self):
        return self.WIN

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return [self._fresh_item]
        if control_type == "Text":
            return [_FakeText(self._sender, _Rect(300, 20, 600, 50))]
        return []


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)


def test_open_chat_rescan_when_stale_coords(monkeypatch):
    """离屏坐标 → 重扫 → 找到 sender 新 item → 验证成功。"""
    sender = "徐先生企业自媒体-Ai助力"
    stale_item = _StaleItem(sender)
    fresh_item = _FreshItem(sender)
    mw = _MWWithFreshItem(sender, fresh_item)

    monkeypatch.setattr(listen_chat, "_find_render_subwindow", lambda hwnd: 0)
    monkeypatch.setattr(listen_chat, "_post_click_item", lambda item, hwnd: False)

    result = listen_chat._open_chat(mw, stale_item, sender)
    assert result is True, "离屏坐标时应重扫找到 sender 新 item 并验证成功"


def test_open_chat_no_rescan_for_valid_coords(monkeypatch):
    """坐标正常时不触发重扫，直接走原有流程。"""
    sender = "默忆"
    fresh_item = _FreshItem(sender)
    mw = _MWWithFreshItem(sender, fresh_item)

    monkeypatch.setattr(listen_chat, "_find_render_subwindow", lambda hwnd: 0)
    monkeypatch.setattr(listen_chat, "_post_click_item", lambda item, hwnd: False)

    result = listen_chat._open_chat(mw, fresh_item, sender)
    assert result is True, "坐标正常时应走原有逻辑并成功"
