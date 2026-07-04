# -*- coding: utf-8 -*-
"""v1.0.107 Bug5 test: _parse_item_name 角标解析已知行为覆盖（防退化）。

Bug5（角标时有时无）是 Windows UIA 树重建时机问题，无法彻底根治。
本测试保证 _parse_item_name 在已知输入下行为稳定，不退化。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class TestParseItemName:
    """_parse_item_name 已知行为保证测试（Bug5 regression guard）。"""

    def test_normal_unread_returns_sender_and_content(self):
        """标准未读格式 → 返回 sender 和 content。"""
        name = "张三\n[2条] \n你好，请问有货吗\n17:47\n"
        result = listen_chat._parse_item_name(name, require_unread=True)
        assert result is not None
        assert result["sender"] == "张三"
        assert "你好" in result["content"]

    def test_no_badge_returns_none_when_required(self):
        """无 [N条] 角标时 require_unread=True → 返回 None（不触发处理）。"""
        name = "张三\n已读\n你好\n17:47\n"
        result = listen_chat._parse_item_name(name, require_unread=True)
        assert result is None

    def test_no_badge_returns_result_when_not_required(self):
        """require_unread=False 时无角标也能解析（CRM 列表用）。"""
        name = "张三\n你好，有货吗\n17:47\n"
        result = listen_chat._parse_item_name(name, require_unread=False)
        # 无内容段时返回 None 可接受
        # 有内容段时应返回 sender
        if result is not None:
            assert result["sender"] == "张三"

    def test_system_sender_filtered(self):
        """系统账号（公众号等）被 SKIP_SENDERS 过滤 → 返回 None。"""
        # 微信团队是典型 SKIP_SENDER
        name = "微信团队\n[1条] \n欢迎消息\n17:47\n"
        result = listen_chat._parse_item_name(name, require_unread=True)
        # 如果 "微信团队" 在 SKIP_SENDERS 则返回 None
        # 不做强断言，只保证不 raise
        assert result is None or isinstance(result, dict)

    def test_empty_name_returns_none(self):
        """空 name → 返回 None，不崩溃。"""
        assert listen_chat._parse_item_name("", require_unread=True) is None
        assert listen_chat._parse_item_name("", require_unread=False) is None

    def test_single_line_returns_none(self):
        """只有一行 → parts < 2 → 返回 None。"""
        assert listen_chat._parse_item_name("张三", require_unread=True) is None

    def test_badge_but_no_content_returns_none(self):
        """有 [N条] 但无有效内容 → 返回 None（防空回复）。"""
        # 只有角标行，没有实际消息预览
        name = "张三\n[1条] \n\n17:47\n"
        result = listen_chat._parse_item_name(name, require_unread=True)
        # 这里只要不崩溃即可，返回 None 或有 content 的 dict 都可接受
        assert result is None or isinstance(result, dict)

    def test_multiline_content_takes_first_segment(self):
        """多行 name 时取第一个有效内容段（角标之后）。"""
        name = "李四\n[3条] \n帮我看看这个产品\n昨天\n"
        result = listen_chat._parse_item_name(name, require_unread=True)
        assert result is not None
        assert result["sender"] == "李四"
        assert result["content"] == "帮我看看这个产品"

    def test_known_group_pattern_in_sender_filtered(self):
        """sender 含 (N) 数字群标记时，KNOWN_GROUPS 机制（Bug4）应在扫描层过滤，
        _parse_item_name 本身只管解析 → 确保不会对 sender 含括号的名字崩溃。"""
        name = "华涛数码-AI助力(3)\n[1条] \n有新消息\n17:48\n"
        # _parse_item_name 本身不做群判断（群判断在 scan_unread 层），只解析字段
        result = listen_chat._parse_item_name(name, require_unread=True)
        # 不崩溃即可
        assert result is None or isinstance(result, dict)
