# -*- coding: utf-8 -*-
"""Bug 5 — 角标缺失：99+ 格式不被识别（staging 7bugs / 1.0.108）

根因：parse_unread_count 正则 r'\[(\d+)条]' 只匹配精确数字，不匹配
WeChat 在消息很多时显示的 "[99+条]" 格式（staging 测试群发消息后出现）。

修法：更新正则为 r'\[(\d+)\+?条]'，对 N+ 格式返回 N（至少有 N 条未读）。
本文件是永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_parse_unread_count_exact_number():
    """精确数字格式 [N条] 正常解析（基础功能不退化）。"""
    assert listen_chat.parse_unread_count("默忆\n[3条] \n你好\n17:47\n") == 3
    assert listen_chat.parse_unread_count("某人\n[1条] \n消息\n") == 1
    assert listen_chat.parse_unread_count("某人\n[99条] \n消息\n") == 99


def test_parse_unread_count_99plus_format():
    """[99+条] 格式必须被识别，返回 99（至少有 99 条未读）。

    Bug 场景：staging 测试群发消息后，WeChat 显示 "[99+条]"，
    旧正则匹配失败返回 0 → sender 不进候选 → 消息永久未处理。
    """
    result = listen_chat.parse_unread_count("默忆\n[99+条] \n消息\n17:47\n")
    assert result == 99, \
        f"[99+条] 必须返回 99，实际返回 {result}（旧正则不匹配 '+' → 0 = Bug）"


def test_parse_unread_count_other_nplus_format():
    """其他 N+ 格式也应被识别（如 [100+条]）。"""
    result = listen_chat.parse_unread_count("某人\n[100+条] \n消息\n")
    assert result == 100, f"[100+条] 必须返回 100，实际返回 {result}"

    result = listen_chat.parse_unread_count("某人\n[9+条] \n消息\n")
    assert result == 9, f"[9+条] 必须返回 9，实际返回 {result}"


def test_parse_unread_count_no_badge_returns_zero():
    """无角标时返回 0（基础功能不退化）。"""
    assert listen_chat.parse_unread_count("默忆\n消息内容\n17:47\n") == 0
    assert listen_chat.parse_unread_count("") == 0
    assert listen_chat.parse_unread_count(None) == 0


def test_parse_unread_count_bracket_format_variations():
    """各种有效格式：带空格/不带空格/放不同位置都能解析。"""
    # 原始紧凑格式
    assert listen_chat.parse_unread_count("[5条]") == 5
    # 带 + 紧凑格式
    assert listen_chat.parse_unread_count("[99+条]") == 99
    # 全角括号（如果有的话）——主要测试半角
    assert listen_chat.parse_unread_count("[2条] ") == 2
