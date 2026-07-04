"""
TDD — listen_chat.post_message_receipt：模块侧送达回执上报（bug2 下半）。

背景：中台 PR#1105 已上线 —— draft-generate 响应带 message_id（number|null）；
POST /api/wechat/messages/:id/receipt body {ok, agent_id}，返回 {ok:true,updated} / 400 / 403，
旧 API 404 需容忍。

要求：
  - post_message_receipt 正常 → POST 到 /api/wechat/messages/{id}/receipt，body.ok / body.agent_id。
  - message_id 为 None/空 → 静默跳过，不发任何请求。
  - http 抛异常 / 非 2xx → 只打日志，绝不抛、绝不阻塞发送主流程。

RED：post_message_receipt 不存在 → AttributeError。
CI 安全：顶层零 pywinauto；用 fake requests 注入 sys.modules，跨平台可跑。
"""
from __future__ import annotations

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


def _make_fake_requests(calls, status=200, raise_exc=None):
    m = types.ModuleType("requests")

    def post(url, json=None, timeout=None):  # noqa: A002 - 模拟 requests.post 签名
        calls.append({"url": url, "json": json})
        if raise_exc:
            raise raise_exc
        return types.SimpleNamespace(
            status_code=status, text="ok", json=lambda: {"ok": True, "updated": True}
        )

    m.post = post  # type: ignore[attr-defined]
    return m


def test_receipt_posts_to_message_endpoint(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")
    assert len(calls) == 1
    assert calls[0]["url"].endswith("/api/wechat/messages/42/receipt")
    assert calls[0]["json"]["ok"] is True
    assert calls[0]["json"]["agent_id"] == "agent-1"


def test_receipt_ok_false_carries_false(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", 7, False, "agent-1")
    assert len(calls) == 1
    assert calls[0]["json"]["ok"] is False


def test_receipt_skips_when_message_id_none(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", None, True, "agent-1")
    assert calls == []  # message_id 缺失 → 静默跳过，不发任何请求


def test_receipt_skips_when_message_id_empty_string(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", "", True, "agent-1")
    assert calls == []


def test_receipt_swallows_network_exception(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setitem(
        sys.modules, "requests", _make_fake_requests([], raise_exc=RuntimeError("net down"))
    )
    # 不抛异常即通过（发送主流程绝不被回执上报拖垮）
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")


def test_receipt_tolerates_404_old_api(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls, status=404))
    # 旧 API 返回 404 → 不抛、只打日志
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")
    assert len(calls) == 1  # 4xx 不重试，只发一次
