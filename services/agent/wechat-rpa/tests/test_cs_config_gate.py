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


# ─── CRM 重做：黑名单主模型（默认全接管 + 黑名单排除）─────────────────────────────


def test_should_reply_blacklist_mode_excludes_only_blacklisted():
    """blacklist 模式（takeover_mode='blacklist'）：sender ∉ blacklist → 回；∈ → 不回。

    黑名单主模型核心断言：默认全接管，只有被显式拉黑的人不回。
    """
    cfg = {"takeover_mode": "blacklist", "blacklist": ["我的小号", "测试号"]}
    assert gate.should_reply(cfg, "真实客户") is True   # 不在黑名单 → 回
    assert gate.should_reply(cfg, "路人甲") is True      # 不在黑名单 → 回（默认全接管）
    assert gate.should_reply(cfg, "我的小号") is False   # 在黑名单 → 不回
    assert gate.should_reply(cfg, "测试号") is False     # 在黑名单 → 不回


def test_should_reply_blacklist_mode_empty_blacklist_replies_all():
    """blacklist 模式 + 空黑名单 → 全员都回（默认全接管，黑名单为空时谁都不排除）。"""
    cfg = {"takeover_mode": "blacklist", "blacklist": []}
    assert gate.should_reply(cfg, "任何人") is True
    # 黑名单字段缺失也按空处理 → 全员回
    assert gate.should_reply({"takeover_mode": "blacklist"}, "任何人") is True


def test_should_reply_whitelist_mode_falls_back_to_old_logic():
    """takeover_mode='whitelist' → 回退旧逻辑：sender ∈ whitelist 才回（存量客服机零误发）。"""
    cfg = {"takeover_mode": "whitelist", "whitelist": ["客户甲", "默忆"]}
    assert gate.should_reply(cfg, "默忆") is True
    assert gate.should_reply(cfg, "路人") is False
    assert gate.should_reply({"takeover_mode": "whitelist", "whitelist": []}, "默忆") is False


def test_should_reply_default_mode_is_whitelist_for_legacy_compat():
    """无 takeover_mode 字段（存量配置）→ 默认按 whitelist 旧逻辑，绝不突变成全接管误发。

    决策 1（lead 拍板）：存量客服机保持原行为；只有显式标 blacklist 模式才全接管。
    """
    cfg = {"whitelist": ["客户甲"]}  # 老配置无 takeover_mode
    assert gate.should_reply(cfg, "客户甲") is True
    assert gate.should_reply(cfg, "路人") is False     # 不在白名单 → 不回（不误发）


def test_should_reply_blacklist_field_not_list_treated_as_empty():
    """blacklist 模式但 blacklist 不是 list（脏数据）→ 当空黑名单处理（全员回，但不崩）。"""
    cfg = {"takeover_mode": "blacklist", "blacklist": "脏数据"}
    assert gate.should_reply(cfg, "任何人") is True


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
