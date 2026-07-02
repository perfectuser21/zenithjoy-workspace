# -*- coding: utf-8 -*-
"""锚点气泡扫描纯函数守卫：系统气泡剔除 + trailing incoming 切分。

守卫契约（proven-to-fire）：把 strip_system_bubbles 改成不剔除时间戳，
test_timestamp_does_not_hijack_anchor 必红（时间戳被判 outgoing 劫持锚点，
把之前的 incoming 全切掉 → 复现漏回）。
顶层零 pywinauto，纯 Fake 注入。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def _b(text, direction):
    return {"text": text, "direction": direction}


# ── _is_system_bubble ────────────────────────────────────────────────────────

def test_pure_time_is_system():
    for t in ["14:32", "9:05", "昨天 14:32", "前天 08:00", "星期二 09:05",
              "周三 21:00", "2026年7月1日 14:32", "7月1日 14:32"]:
        assert listen_chat._is_system_bubble(t), t


def test_recall_and_pat_are_system():
    for t in ['"客户A" 撤回了一条消息', "你撤回了一条消息", "客户A拍了拍你", "以下是新消息"]:
        assert listen_chat._is_system_bubble(t), t


def test_normal_messages_not_system():
    for t in ["在吗", "什么价格", "价格 14:32 前有效", "我 7月1日 到货可以吗", "[图片]"]:
        assert not listen_chat._is_system_bubble(t), t


def test_strip_system_bubbles_keeps_order():
    bubbles = [_b("在吗", "incoming"), _b("14:32", "outgoing"), _b("发下资料", "incoming")]
    assert listen_chat.strip_system_bubbles(bubbles) == [
        _b("在吗", "incoming"), _b("发下资料", "incoming")]
