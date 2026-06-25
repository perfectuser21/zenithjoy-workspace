# -*- coding: utf-8 -*-
"""
TDD — `fetch_friend_scan_pending` 查询中台"立即扫好友"强制标志单测。

契约（line04-cs-consolidation-contract §cs-agent / 与 cs-be 对齐）：
  GET /api/crm/friend-scan/pending?cs_wechat_id=<wid>
  鉴权：X-Internal-Token（agent 无人类 session；env ZENITHJOY_INTERNAL_TOKEN，
        未设时不带头——后端 dev 模式放行，与 post_friend_scan 同范式）
  返回：{ "force": <bool>, "requested_at": <ts|null> }
        force=true 表示运营在 Dashboard 点了"立即扫好友"（force_scan_requested_at 仍未消费）。

消费逻辑（主循环）：force=true → 无视 24h 间隔立刻 scan_recent_contacts + post_friend_scan；
ingest 成功后由后端清 force_scan_requested_at（agent 不另调清除端点）。

行为约束（与 post_friend_scan / fetch_outbound_tasks 同纪律）：
任何失败保守返回 {ok:false, force:false}，绝不抛——拉指令不能拖垮监听，也绝不误触发扫描。
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


def test_pending_force_true_with_token_and_query(monkeypatch):
    """force=true → 返回 ok+force=True，GET 带 cs_wechat_id query + internal token 头。"""
    captured = {}

    def fake_get(url, params=None, timeout=None, headers=None):
        captured["url"] = url
        captured["params"] = params or {}
        captured["headers"] = headers or {}
        return FakeResp(200, {"force": True, "requested_at": "2026-06-25T10:00:00Z"})

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)
    monkeypatch.setenv("ZENITHJOY_INTERNAL_TOKEN", "tok-abc")

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")

    assert res["ok"] is True
    assert res["force"] is True
    assert res.get("requested_at") == "2026-06-25T10:00:00Z"
    assert captured["url"].endswith("/api/crm/friend-scan/pending")
    assert captured["params"].get("cs_wechat_id") == "wxid_cs1"
    assert captured["headers"].get("X-Internal-Token") == "tok-abc"


def test_pending_force_false(monkeypatch):
    """force=false（没人点）→ ok=True force=False，不触发扫描。"""
    def fake_get(url, params=None, timeout=None, headers=None):
        return FakeResp(200, {"force": False, "requested_at": None})

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is True
    assert res["force"] is False


def test_pending_no_token_omits_header(monkeypatch):
    """未设 internal token（dev/CI）→ 仍 GET 但不带 X-Internal-Token 头。"""
    captured = {}

    def fake_get(url, params=None, timeout=None, headers=None):
        captured["headers"] = headers or {}
        return FakeResp(200, {"force": False})

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)
    monkeypatch.delenv("ZENITHJOY_INTERNAL_TOKEN", raising=False)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is True
    assert "X-Internal-Token" not in captured["headers"]


def test_pending_missing_force_field_defaults_false(monkeypatch):
    """后端返回里缺 force 字段 → 保守默认 force=False（绝不误触发扫描）。"""
    def fake_get(url, params=None, timeout=None, headers=None):
        return FakeResp(200, {"requested_at": None})

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is True
    assert res["force"] is False


def test_pending_missing_cs_wechat_id_skips_http(monkeypatch):
    """没有 cs_wechat_id → 不知道查谁 → 不发 HTTP，force=False。"""
    called = {"n": 0}

    def fake_get(*a, **k):
        called["n"] += 1
        return FakeResp(200, {"force": True})

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "")
    assert res["ok"] is False
    assert res["force"] is False
    assert called["n"] == 0


def test_pending_http_500_returns_force_false_no_raise(monkeypatch):
    """中台 500 → force=False ok=False，不抛（不拖垮监听，保守不扫）。"""
    def fake_get(url, params=None, timeout=None, headers=None):
        return FakeResp(500, None, text="boom")

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is False
    assert res["force"] is False


def test_pending_conn_error_returns_force_false_no_raise(monkeypatch):
    """连接异常 → force=False，绝不抛。"""
    def boom_get(*a, **k):
        raise RuntimeError("conn refused")

    fake_requests = types.SimpleNamespace(get=boom_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is False
    assert res["force"] is False


def test_pending_bad_json_returns_force_false(monkeypatch):
    """200 但 body 不是 JSON → 保守 force=False，不抛。"""
    def fake_get(url, params=None, timeout=None, headers=None):
        return FakeResp(200, None, raise_json=True)

    fake_requests = types.SimpleNamespace(get=fake_get)
    monkeypatch.setitem(sys.modules, "requests", fake_requests)

    res = listen_chat.fetch_friend_scan_pending("http://mw", "wxid_cs1")
    assert res["ok"] is False
    assert res["force"] is False
