# -*- coding: utf-8 -*-
"""延迟预算守卫（2026-07-03 用户决策：回复要接近秒回）。

日志实测单条回复 ~10-15s 的分布：扫描周期平均 1.5s + 开窗验证重试 4-5s
（3 策略 × 5 轮 × 0.4s 轮询）+ 双读 ~1.1s + LLM 2-4s + 送达读回 ~1.2s。
安全闸门（防串台标题验证/真送达读回/双读）一个不删，只压轮询间隔：
目标端到端 4-8s。本文件锁住压缩后的预算，防悄悄回胖。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import config
import listen_chat


def test_main_loop_poll_is_1s():
    """扫描周期 3→1s：发现延迟平均 1.5s → 0.5s。"""
    assert config.MAIN_LOOP_POLL_INTERVAL_SECONDS == 1


def test_open_chat_verify_polling_tightened():
    """开窗验证轮询 0.4s×5 → 0.15s×4：单次失败 attempt 2s → 0.6s，
    三策略全走 4-5s → ~1.8s。验证逻辑本身不动（防串台闸保留）。"""
    assert config.OPEN_CHAT_POLL_INTERVAL <= 0.15
    assert config.OPEN_CHAT_VERIFY_POLLS <= 4


def test_delivery_readback_polling_tightened():
    """真送达读回 0.6s×5 → 0.3s×5：成功通常 1-2 轮命中，失败窗口 3s→1.5s。"""
    assert listen_chat._DELIVERY_READBACK_POLL_SLEEP <= 0.3


def test_bubble_read_poll_tightened():
    """双读间隔 0.6 → 0.3s（jiggle 后 Qt 重建很快落定）。"""
    assert listen_chat._BUBBLE_READ_POLL_SLEEP <= 0.3
