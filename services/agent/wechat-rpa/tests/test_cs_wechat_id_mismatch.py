# -*- coding: utf-8 -*-
"""
Bug 2 (中台假账) regression — 1.0.107 staging 重测发现：

cs_config_gate.fetch_cs_config 成功返回后，调用方未校验 config["wechat_id"]
是否与本机 agent 的微信号一致。当 machine_id 在中台错误绑到别的租户时，
listen_chat 会用别人的配置（whitelist/blacklist）真发回复——替别人接管了客户。

修法：拉到配置后，若 config["wechat_id"] 与 args.wechat_id（或环境变量
ZENITHJOY_AGENT_WECHAT_ID）不匹配，强制 _real_publish=False 并打告警。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import cs_config_gate as gate


def test_config_wechat_id_matches_allows_real():
    """config.wechat_id == 本机 wechat_id → 正常走 resolve_send_mode。"""
    config = {"auto_agent_enabled": True, "wechat_id": "wx_agent_001"}
    result = gate.validate_config_wechat_id(config, "wx_agent_001")
    assert result is True, "wechat_id 匹配时应通过校验"


def test_config_wechat_id_mismatch_returns_false():
    """config.wechat_id != 本机 wechat_id → 校验失败，必须返回 False。

    这是 Bug 2 的核心断言：中台绑错租户时，返回 False 强制 dryrun，
    绝不用别人的配置真发回复。
    """
    config = {"auto_agent_enabled": True, "wechat_id": "wx_wrong_tenant"}
    result = gate.validate_config_wechat_id(config, "wx_agent_001")
    assert result is False, "wechat_id 不匹配时校验必须失败，防止假账接管"


def test_config_missing_wechat_id_passes():
    """config 里没有 wechat_id 字段（老版本中台）→ 宽松校验，不阻断（向后兼容）。"""
    config = {"auto_agent_enabled": True}
    result = gate.validate_config_wechat_id(config, "wx_agent_001")
    assert result is True, "老版本中台无 wechat_id 字段时应向后兼容"


def test_config_none_passes():
    """config=None（拉取失败后用缓存）→ 不阻断（拉失败已由 resolve_send_mode 强制 dryrun）。"""
    result = gate.validate_config_wechat_id(None, "wx_agent_001")
    assert result is True, "config=None 时不额外阻断"


def test_local_wechat_id_not_set_passes():
    """本机未配置 wechat_id（args.wechat_id=None/空串）→ 无法校验，宽松放行。"""
    config = {"auto_agent_enabled": True, "wechat_id": "wx_any"}
    result = gate.validate_config_wechat_id(config, None)
    assert result is True, "本机未配置 wechat_id 时无法校验，宽松放行"
    result2 = gate.validate_config_wechat_id(config, "")
    assert result2 is True, "wechat_id 空串时宽松放行"
