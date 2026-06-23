# -*- coding: utf-8 -*-
# cs_config_gate 单测（纯函数 + 按 machine_id 拉配置）。
# 对齐 build-modules/line04/cs-config-gate.js 同语义。真发跟随 auto_agent_enabled，
# 拉失败强制 dryrun（绝不误真发）。
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cs_config_gate as gate


class FakeResp:
    def __init__(self, status_code, payload=None, raise_json=False):
        self.status_code = status_code
        self._payload = payload
        self._raise_json = raise_json

    def json(self):
        if self._raise_json:
            raise ValueError("bad json")
        return self._payload


def test_resolve_send_mode_follows_switch_and_pull():
    assert gate.resolve_send_mode({"auto_agent_enabled": True}, True) == "real"
    assert gate.resolve_send_mode({"auto_agent_enabled": False}, True) == "dryrun"
    # 拉失败 → 强制 dryrun，即便缓存里开关是开的，绝不误真发
    assert gate.resolve_send_mode({"auto_agent_enabled": True}, False) == "dryrun"
    assert gate.resolve_send_mode(None, True) == "dryrun"


def test_resolve_active_config_uses_cache_when_pull_failed():
    fresh = {"auto_agent_enabled": True}
    cached = {"auto_agent_enabled": False, "whitelist": ["客户甲"]}
    assert gate.resolve_active_config(fresh, cached, True) is fresh
    assert gate.resolve_active_config(fresh, cached, False) is cached


def test_should_reply_whitelist():
    cfg = {"whitelist": ["客户甲", "默忆"]}
    assert gate.should_reply(cfg, "默忆") is True
    assert gate.should_reply(cfg, "路人") is False
    assert gate.should_reply({"whitelist": []}, "默忆") is False
    assert gate.should_reply(None, "默忆") is False


def test_fetch_cs_config_200_returns_config_pull_ok(monkeypatch):
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["url"] = url
        captured["params"] = params
        return FakeResp(200, {"wechat_id": "wxid_a", "persona": {"self_name": "萌萌"},
                              "auto_agent_enabled": True, "whitelist": ["默忆"]})

    monkeypatch.setattr(gate.requests, "get", fake_get)
    cfg, ok = gate.fetch_cs_config("http://mw", "machine-A")
    assert ok is True
    assert cfg["persona"]["self_name"] == "萌萌"
    assert captured["url"].endswith("/api/wechat/cs/agent-config")
    assert captured["params"] == {"machine_id": "machine-A"}


def test_fetch_cs_config_403_unbound_returns_none_not_ok(monkeypatch):
    monkeypatch.setattr(gate.requests, "get", lambda *a, **k: FakeResp(403, {"error": "UNBOUND_MACHINE"}))
    cfg, ok = gate.fetch_cs_config("http://mw", "machine-unbound")
    assert cfg is None and ok is False


def test_fetch_cs_config_network_error_returns_none_not_ok(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("conn refused")

    monkeypatch.setattr(gate.requests, "get", boom)
    cfg, ok = gate.fetch_cs_config("http://mw", "machine-A")
    assert cfg is None and ok is False


def test_fetch_cs_config_empty_machine_id_returns_none_not_ok():
    cfg, ok = gate.fetch_cs_config("http://mw", "")
    assert cfg is None and ok is False
