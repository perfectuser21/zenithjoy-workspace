"""
回归测试 — 收件人身份闸门（防串台 / 防回复错人）。

复现 bug（2026-06-11）：listen_chat.py 的 reply_in_chat 用裸 item.Invoke() 切会话后，
不校验「当前打开的会话是不是目标 sender」就盲发。叠加微信会话列表实时重排 + 离屏后台
Invoke 只切内部状态，导致回复被投递到「错开一位」的会话 —— 我发的回给于锦、于锦的回给苏…

修复：切窗后用 _chat_title_matches(mw, sender) 校验当前会话标题 == sender，命中才发；
不命中 3 次重试仍失败则中止本轮（绝不发给错误的人，下轮重试）。

本测试永久留在 CI：任何让 reply_in_chat 在「打开的不是目标会话」时仍发送的回退都会让它变红。

【CI 安全】顶层零 pywinauto/win32 import；纯 Fake 对象注入，跨平台跑。
"""
from __future__ import annotations

import ctypes
import os
import sys
from unittest.mock import MagicMock

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _EI:
    def __init__(self, name="", automation_id=""):
        self.name = name
        self.automation_id = automation_id
        self.handle = 12345


class _FakeText:
    """聊天面板里的一个 Text 控件（用于充当/不充当会话标题）。"""

    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _FakeInvoke:
    def __init__(self):
        self.invoke_called = False

    def Invoke(self):  # noqa: N802
        self.invoke_called = True


class _FakeItem:
    def __init__(self):
        self.element_info = _EI()
        self.iface_invoke = _FakeInvoke()


class _TitleMW:
    """主窗口 Fake：窗口矩形 (0,0)-(800,600)，标题区 = 右上（left>200, top<150）。

    open_title 决定「当前打开的会话标题」，模拟 Invoke 切到了哪个人的窗口。
    """

    WIN = _Rect(0, 0, 800, 600)

    def __init__(self, open_title: str, edit=None):
        self.element_info = _EI()
        self._open_title = open_title
        self._edit = edit

    def rectangle(self):
        return self.WIN

    def descendants(self, control_type=None):
        if control_type == "Text":
            # 标题：right region (left=300 > 200) + 顶部 (top=20 < 150)
            title = _FakeText(self._open_title, _Rect(300, 20, 600, 50))
            # 左侧会话列表项（left=10），即使名字撞上也不能被当成标题
            list_item = _FakeText("苏", _Rect(10, 20, 180, 50))
            return [title, list_item]
        if control_type == "Edit" and self._edit is not None:
            return [self._edit]
        return []

    def children(self):
        return []


# ── _chat_title_matches 三态 ──────────────────────────────────────────────────


def test_title_matches_true():
    mw = _TitleMW(open_title="于锦")
    assert listen_chat._chat_title_matches(mw, "于锦") is True


def test_title_matches_false_when_other_chat_open():
    """打开的是「苏」的窗口，但要发给「于锦」→ 必须 False（这正是串台场景）。"""
    mw = _TitleMW(open_title="苏")
    assert listen_chat._chat_title_matches(mw, "于锦") is False


def test_title_left_list_item_not_treated_as_title():
    """左侧会话列表里也有「苏」，但它不在标题区 → 不能让校验误判命中。"""
    mw = _TitleMW(open_title="于锦")
    # 要发给苏，但当前打开的是于锦；左侧列表的「苏」不算标题 → False
    assert listen_chat._chat_title_matches(mw, "苏") is False


def test_title_none_when_no_title_text():
    class _NoText(_TitleMW):
        def descendants(self, control_type=None):
            return []

    assert listen_chat._chat_title_matches(_NoText("x"), "于锦") is None


# ── reply_in_chat 身份闸门 ────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)


@pytest.fixture(autouse=True)
def _stub_uia_send(monkeypatch):
    """把 _uia_send / _navigate_away 换成记录器，聚焦验证『发没发、发给谁』。"""
    sent: list = []

    def _fake_send(uia_edit, mw, reply_text):
        sent.append((mw, reply_text))
        return True

    monkeypatch.setattr(listen_chat, "_uia_send", _fake_send)
    monkeypatch.setattr(listen_chat, "_navigate_away", lambda *a, **k: None)
    # _find_chat_input 返回一个占位 edit，确保「能发」这一步不是因为找不到输入框而失败
    monkeypatch.setattr(listen_chat, "_find_chat_input", lambda mw: MagicMock())
    return sent


def test_aborts_when_open_chat_is_wrong_person(_stub_uia_send):
    """串台核心回归：要发给『于锦』，但 Invoke 后打开的是『苏』的窗口 → 绝不发送。"""
    mw = _TitleMW(open_title="苏")  # 切错了：打开的是苏
    item = _FakeItem()

    ok = listen_chat.reply_in_chat(mw, item, "这是给于锦的回复", sender="于锦")

    assert ok is False, "打开的不是目标会话时必须中止，返回 False"
    assert _stub_uia_send == [], "绝不能调用 _uia_send（否则就把于锦的回复发给了苏 = 串台）"


def test_sends_when_open_chat_matches_sender(_stub_uia_send):
    """正常路径：Invoke 后打开的就是『于锦』→ 校验通过 → 正常发送。"""
    mw = _TitleMW(open_title="于锦")
    item = _FakeItem()

    ok = listen_chat.reply_in_chat(mw, item, "你好于锦", sender="于锦")

    assert ok is True
    assert item.iface_invoke.invoke_called is True
    assert len(_stub_uia_send) == 1, "校验通过后应发送一次"
    assert _stub_uia_send[0][1] == "你好于锦"


def test_no_sender_falls_back_to_legacy_behavior(_stub_uia_send):
    """不传 sender（无法校验）→ 退回旧行为，不阻塞发送（向后兼容）。"""
    mw = _TitleMW(open_title="谁都行")
    item = _FakeItem()

    ok = listen_chat.reply_in_chat(mw, item, "兼容旧调用")

    assert ok is True
    assert len(_stub_uia_send) == 1
