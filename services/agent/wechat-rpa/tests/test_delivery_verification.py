"""
TDD — 真送达确认（替代 _uia_send 的 sent=True 自报）。

血泪修正（PrepPRD 0.4 / 06211342 sprint）：`_uia_send` 返回 True 只代表"输入框清空 +
发了 Enter"的自报，不等于消息真送达。必须发完读回目标会话最后一条气泡/预览，确认发送
原文真出现，才算 DELIVERED。

真机证据（PrepPRD §3）：verify3 读回 `默忆preview: '默忆\nTest 1234 verify\n12:45'`
→ `DELIVERED: True`（读回确认，非自报）。

【CI 安全】顶层零 pywinauto/win32 import；纯函数 + Fake 注入，跨平台跑。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


# ─── _delivery_confirmed: 纯判定（读回文本是否含发送原文）──────────────────────


def test_full_message_appears_in_readback():
    """短消息：发送原文完整出现在读回的会话最后气泡/预览 → 确认送达。"""
    readback = "默忆\nTest 1234 verify\n12:45"  # 真机证据：sender名\n消息\n时间
    assert listen_chat._delivery_confirmed(readback, "Test 1234 verify") is True


def test_message_absent_from_readback_not_delivered():
    """读回里没有发送原文 → 未确认送达（不能假报成功）。"""
    readback = "默忆\n你之前的旧消息\n12:40"
    assert listen_chat._delivery_confirmed(readback, "Test 1234 verify") is False


def test_empty_readback_not_delivered():
    """读不到任何回读文本（空会话/读失败）→ 未送达，保守判 False。"""
    assert listen_chat._delivery_confirmed("", "您好，在的") is False


def test_empty_sent_text_not_delivered():
    """发送原文为空 → 无内容可确认 → False（不靠空串误命中）。"""
    assert listen_chat._delivery_confirmed("默忆\n随便什么\n12:45", "") is False


def test_whitespace_and_newline_normalized():
    """读回文本与发送原文的空白/换行差异被规范化后仍命中。"""
    readback = "默忆\n您好 在 的\n12:45"
    assert listen_chat._delivery_confirmed(readback, "您好在的") is True


def test_long_reply_truncated_preview_matches_by_prefix():
    """长回复在微信会话列表预览里被截断，只剩前缀；前缀命中也算送达。"""
    sent = "您好，关于您咨询的产品我详细说明一下：第一点是材质，第二点是价格，第三点是售后保障政策细则"
    readback = "默忆\n您好，关于您咨询的产品我详细说明一下：第一点是材\n12:45"  # 截断
    assert listen_chat._delivery_confirmed(readback, sent) is True


# ─── _read_session_preview: 从会话列表读目标会话项预览（element_info.name）──────


class _PreviewListItem:
    def __init__(self, name: str):
        class _EI:
            pass
        self.element_info = _EI()
        self.element_info.name = name


class _PreviewMW:
    def __init__(self, items):
        self._items = items

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return self._items
        return []


def test_read_preview_returns_target_session_name():
    """读回目标 sender 会话项的 element_info.name（含最后消息预览，真机证据格式）。"""
    mw = _PreviewMW([
        _PreviewListItem("文件传输助手\n收到\n12:44"),
        _PreviewListItem("默忆\nTest 1234 verify\n12:45"),
    ])
    assert listen_chat._read_session_preview(mw, "默忆") == "默忆\nTest 1234 verify\n12:45"


def test_read_preview_missing_sender_returns_empty():
    """目标 sender 不在会话列表 → 返回空串（读不到，调用方判未送达）。"""
    mw = _PreviewMW([_PreviewListItem("文件传输助手\n收到\n12:44")])
    assert listen_chat._read_session_preview(mw, "默忆") == ""


def test_read_preview_empty_sender_returns_empty():
    """sender 为空 → 返回空串（无目标可读）。"""
    mw = _PreviewMW([_PreviewListItem("默忆\nhi\n12:45")])
    assert listen_chat._read_session_preview(mw, "") == ""


# ─── reply_in_chat 集成：_uia_send 自报成功后必须读回确认真送达才返回 True ──────


def _patch_send_pipeline(monkeypatch):
    """把 reply_in_chat 内部的窗口/切换/发送都打桩，只留「真送达验证 gate」真实执行。"""
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda *a, **k: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_open_chat", lambda *a, **k: True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda *a, **k: None)
    monkeypatch.setattr(listen_chat, "_find_chat_input", lambda m: object())
    monkeypatch.setattr(listen_chat, "_uia_send", lambda *a, **k: True)  # 自报成功
    monkeypatch.setattr(listen_chat, "_navigate_away", lambda *a, **k: None)


def test_uia_send_success_but_readback_missing_returns_false(monkeypatch):
    """_uia_send 自报 True，但读回会话预览里没有发送原文 → 判未送达，reply_in_chat 返回 False。"""
    _patch_send_pipeline(monkeypatch)
    mw = _PreviewMW([_PreviewListItem("默忆\n之前的旧消息\n12:40")])  # 预览未更新成新消息
    ok = listen_chat.reply_in_chat(mw, object(), "Test 1234 verify", sender="默忆")
    assert ok is False, "读回未确认送达必须判 False（治 sent=True 假阳性）"


def test_uia_send_success_and_readback_confirms_returns_true(monkeypatch):
    """_uia_send 自报 True，且读回会话预览出现发送原文 → 真送达确认，reply_in_chat 返回 True。"""
    _patch_send_pipeline(monkeypatch)
    mw = _PreviewMW([_PreviewListItem("默忆\nTest 1234 verify\n12:45")])  # 预览已是新发消息
    ok = listen_chat.reply_in_chat(mw, object(), "Test 1234 verify", sender="默忆")
    assert ok is True, "读回确认原文出现必须判 True"


def test_no_sender_keeps_legacy_behavior_returns_true(monkeypatch):
    """无 sender（fallback 路径，无目标会话可读）→ 保持旧行为，不做读回验证，返回 True。"""
    _patch_send_pipeline(monkeypatch)
    mw = _PreviewMW([])
    ok = listen_chat.reply_in_chat(mw, object(), "您好，在的")
    assert ok is True
