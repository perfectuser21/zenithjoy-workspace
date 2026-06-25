# -*- coding: utf-8 -*-
"""
TDD — `post_friend_scan` 上报近期会话联系人到中台 ingest 端点单测。

契约（PrepPRD §3.2）：
  POST /api/crm/friend-scan/ingest
  鉴权：internal/service token（agent 无人类 session）→ X-Internal-Token 头
  body：{ cs_wechat_id, contacts:[{name, last_message?, last_seen?}] }
  幂等：后端按 (tenant_id, cs_wechat_id, contact) upsert。

行为约束（与 post_heartbeat 同纪律）：失败吞掉返回 {ok:false}，绝不抛——上报不能拖垮监听。
顶层零 pywinauto；requests 用 stub。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock

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


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


class FakeResp:
    def __init__(self, status_code, payload=None, text="", raise_json=False):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("bad json")
        return self._payload


def test_post_friend_scan_success_sends_internal_token_and_body(monkeypatch):
    captured = {}

    def fake_post(url, json=None, timeout=None, headers=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers or {}
        return FakeResp(200, {"success": True, "ingested": 2, "new": 1, "scanned_count": 2})

    fake_requests = types.SimpleNamespace(post=fake_post)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)
    monkeypatch.setenv("ZENITHJOY_INTERNAL_TOKEN", "tok-abc")

    contacts = [
        {"name": "于瑾", "last_message": "您好"},
        {"name": "李华", "last_message": "在吗"},
    ]
    res = listen_chat.post_friend_scan("http://mw", "wxid_cs1", contacts)

    assert res["ok"] is True
    assert res.get("ingested") == 2
    assert captured["url"].endswith("/api/crm/friend-scan/ingest")
    assert captured["json"]["cs_wechat_id"] == "wxid_cs1"
    assert captured["json"]["contacts"] == contacts
    # 内部鉴权头必须带上（agent 无人类 session）
    assert captured["headers"].get("X-Internal-Token") == "tok-abc"


def test_post_friend_scan_no_token_still_posts_without_header(monkeypatch):
    """没设 internal token（dev/CI）→ 仍然 POST，但不带 X-Internal-Token 头（后端 dev 模式放行）。"""
    captured = {}

    def fake_post(url, json=None, timeout=None, headers=None):
        captured["headers"] = headers or {}
        return FakeResp(200, {"success": True, "ingested": 0, "new": 0})

    fake_requests = types.SimpleNamespace(post=fake_post)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)
    monkeypatch.delenv("ZENITHJOY_INTERNAL_TOKEN", raising=False)

    res = listen_chat.post_friend_scan("http://mw", "wxid_cs1", [{"name": "甲"}])
    assert res["ok"] is True
    assert "X-Internal-Token" not in captured["headers"]


def test_post_friend_scan_empty_contacts_skips_http(monkeypatch):
    """空联系人列表 → 不发 HTTP（无意义），返回 ok=True ingested=0。"""
    called = {"n": 0}

    def fake_post(*a, **k):
        called["n"] += 1
        return FakeResp(200, {"success": True})

    fake_requests = types.SimpleNamespace(post=fake_post)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.post_friend_scan("http://mw", "wxid_cs1", [])
    assert res["ok"] is True
    assert res.get("ingested") == 0
    assert called["n"] == 0  # 没真发 HTTP


def test_post_friend_scan_http_error_returns_not_ok_no_raise(monkeypatch):
    """中台 500 → 返回 {ok:false}，不抛（不拖垮监听）。"""
    def boom_post(*a, **k):
        raise RuntimeError("conn refused")

    fake_requests = types.SimpleNamespace(post=boom_post)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.post_friend_scan("http://mw", "wxid_cs1", [{"name": "甲"}])
    assert res["ok"] is False
    assert "error" in res


def test_post_friend_scan_missing_cs_wechat_id_returns_not_ok(monkeypatch):
    """没有 cs_wechat_id → 不知道上报给谁 → 返回 ok=false，不发 HTTP。"""
    called = {"n": 0}

    def fake_post(*a, **k):
        called["n"] += 1
        return FakeResp(200, {})

    fake_requests = types.SimpleNamespace(post=fake_post)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.post_friend_scan("http://mw", "", [{"name": "甲"}])
    assert res["ok"] is False
    assert called["n"] == 0
