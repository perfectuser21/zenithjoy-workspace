# -*- coding: utf-8 -*-
"""多行回复预览匹配守卫（2026-07-03 10:34 实况，1.0.102）：

机器人回复含换行时，会话列表 item name 被 _parse_item_name 按行切分 →
content 只取第一行。_matches_any_sent 用 _delivery_confirmed（"sent 含于
readback / sent 前 16 字含于 readback"）判向——第一行短于 16 字前缀时
永不命中 → 自己的多行回复被当客户消息 → 重启盲区触发路径把已回过的
问题又答了一遍（10:34:13 实锤重答"那 5000 呢"）。

修法：_matches_any_sent 增加反向前缀——预览文本（规范化 ≥10 字）是某条
已发送文本的**前缀** → 也算命中。本文件是该事故的永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_multiline_reply_first_line_matches_sent():
    """多行回复的第一行（预览截断形态）必须命中已发送历史。"""
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text(
        "5000的话，能做的就多了。\n\n我们可以帮你做个抖音账号的系统化运营，"
        "包括内容策划、视频拍摄剪辑，帮你把私域也一起做起来。")
    assert listen_chat._matches_any_sent("5000的话，能做的就多了。") is True, (
        "多行回复的第一行预览必须被识别为自己发过的话（否则每次重启重答一遍）"
    )


def test_short_preview_prefix_does_not_false_positive():
    """过短的预览（<10 规范化字符）不做反向前缀匹配（防误判客户短消息）。"""
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("在的，你把用途和预算发我，小齐直接给你对产品。")
    assert listen_chat._matches_any_sent("在的") is False, (
        "客户恰好发'在的'这种短文本不能被误判成我方回复"
    )


def test_unrelated_text_still_incoming():
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("5000的话，能做的就多了。\n\n后续内容")
    assert listen_chat._matches_any_sent("我想买个五千的产品你看怎么弄") is False
