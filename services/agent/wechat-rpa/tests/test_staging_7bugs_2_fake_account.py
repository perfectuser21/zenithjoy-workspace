# -*- coding: utf-8 -*-
"""Bug 2 — 中台假账校验（staging 7bugs / 1.0.108）

根因：fetch_cs_config 按 machine_id 拉配置，但没校验返回的 config 中
wechat_id 是否与当前登录账号匹配。staging 测试中一台机器多个微信账号
会拉到别的账号的配置（"假账"），导致错误接管。

修法：cs_config_gate.py 增加 validate_config_account(config, expected_wechat_id)
纯函数，listen_chat 拉到 config 后调用校验，不匹配时降级 dryrun。
本文件是永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import cs_config_gate as gate


def test_validate_config_account_exists():
    """validate_config_account 函数必须存在于 cs_config_gate 模块。"""
    assert hasattr(gate, "validate_config_account"), \
        "cs_config_gate 必须提供 validate_config_account(config, expected_wechat_id) 纯函数"


def test_validate_config_account_match_returns_true():
    """config.wechat_id 与 expected 一致 → 返回 True（账号正确）。"""
    config = {"wechat_id": "wxid_abc123", "auto_agent_enabled": True}
    assert gate.validate_config_account(config, "wxid_abc123") is True


def test_validate_config_account_mismatch_returns_false():
    """config.wechat_id 与 expected 不一致 → 返回 False（假账，应降级 dryrun）。

    Bug 场景：一台机器上有 wxid_alice 和 wxid_bob 两个账号，
    机器按 machine_id 拉到了 wxid_bob 的配置，但当前运行的是 wxid_alice。
    """
    config = {"wechat_id": "wxid_bob", "auto_agent_enabled": True}
    assert gate.validate_config_account(config, "wxid_alice") is False


def test_validate_config_account_none_config_returns_false():
    """config 为 None（拉配置失败）→ 返回 False（保守兜底）。"""
    assert gate.validate_config_account(None, "wxid_abc123") is False


def test_validate_config_account_missing_wechat_id_returns_false():
    """config 中缺少 wechat_id 字段 → 返回 False（配置不完整，不能信任）。

    存量旧配置可能没有 wechat_id 字段；此时无法验证，保守降级 dryrun。
    """
    config = {"auto_agent_enabled": True, "whitelist": ["客户甲"]}
    assert gate.validate_config_account(config, "wxid_abc123") is False


def test_validate_config_account_none_expected_returns_false():
    """expected_wechat_id 为 None/空（当前账号未知）→ 返回 False（无法验证）。"""
    config = {"wechat_id": "wxid_abc123"}
    assert gate.validate_config_account(config, None) is False
    assert gate.validate_config_account(config, "") is False


def test_validate_config_account_empty_wechat_id_in_config_returns_false():
    """config.wechat_id 为空字符串 → 返回 False（中台数据异常，保守兜底）。"""
    config = {"wechat_id": ""}
    assert gate.validate_config_account(config, "wxid_abc123") is False


def test_resolve_send_mode_degrades_dryrun_on_fake_account():
    """假账情况下（validate_config_account=False），resolve_send_mode 应返回 dryrun。

    这是集成级校验：fake account 应导致整条链路降级为 dryrun，绝不误真发。
    用 pull_ok=False 模拟账号验证失败后的降级路径。
    """
    # 账号验证失败 → pull_ok=False → resolve_send_mode → dryrun
    fake_config = {"wechat_id": "wxid_bob", "auto_agent_enabled": True}
    # validate_config_account 失败 → 应将 pull_ok 设 False 传给 resolve_send_mode
    account_ok = gate.validate_config_account(fake_config, "wxid_alice")
    mode = gate.resolve_send_mode(fake_config, pull_ok=account_ok)
    assert mode == "dryrun", "假账校验失败必须降级 dryrun（绝不误真发）"
