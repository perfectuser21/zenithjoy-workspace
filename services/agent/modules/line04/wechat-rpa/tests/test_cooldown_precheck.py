# -*- coding: utf-8 -*-
"""提速二刀守卫（2026-07-03，用户拍板）：

1. 冷却检查前置到 should_open 谓词：撞冷却的 sender 连窗都不开——旧行为是
   "开窗读完气泡 emit 后才在 classify 层撞冷却被 skip"，每轮白开窗白闪
   （07:36:58-07:37:28 实录：冷却期内 5 次无效开窗）。触发态保留，冷却过后照常回。
2. SENDER_COOLDOWN 30s → 15s（用户决策 2026-07-03）。

本文件是提速改动的永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_build_should_open_blocks_sender_in_cooldown():
    """冷却中的 sender 必须被 should_open 谓词拦下（不开窗），冷却过后放行。"""
    cooldown_map = {"默忆": 1000.0}  # 上次回复时间戳
    pred = listen_chat._build_should_open(
        roster_pred=None, cooldown_map=cooldown_map,
        cooldown_seconds=15.0, now_fn=lambda: 1010.0)  # 冷却中（10s < 15s）
    assert pred("默忆") is False, "冷却中的 sender 不该开窗（白开窗白闪）"
    assert pred("别人") is True, "不在冷却的 sender 照常放行"

    pred2 = listen_chat._build_should_open(
        roster_pred=None, cooldown_map=cooldown_map,
        cooldown_seconds=15.0, now_fn=lambda: 1016.0)  # 冷却已过
    assert pred2("默忆") is True, "冷却过后必须放行（触发态保留的消息要能回）"


def test_build_should_open_composes_roster_gate():
    """冷却谓词与名单门（黑名单）组合：任一拒绝即不开窗。"""
    pred = listen_chat._build_should_open(
        roster_pred=lambda s: s != "内部人员",
        cooldown_map={}, cooldown_seconds=15.0, now_fn=lambda: 0.0)
    assert pred("内部人员") is False
    assert pred("客户") is True


def test_sender_cooldown_config_is_2s():
    """SENDER_COOLDOWN 30→15→2（用户决策 2026-07-03：响应速度优先）。"""
    import config
    assert config.SENDER_COOLDOWN_SECONDS == 2.0
