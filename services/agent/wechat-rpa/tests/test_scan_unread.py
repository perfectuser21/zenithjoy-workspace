"""
TDD RED 阶段 — `_parse_item_name` 纯函数解析单测（5 case，G1-G5）。

【放置路径】Generator commit-1 必须把本文件原样写到
  services/agent/wechat-rpa/tests/test_scan_unread.py
（外加同目录 __init__.py 空文件，若不存在）。

【RED 证据】import listen_chat 时 `_parse_item_name` 不存在 → AttributeError
  →  pytest 全 5 case 报错 → 这是 TDD 红阶段证据。

【GREEN 证据】Generator commit-2 在 listen_chat.py 顶层（不在任何 `if sys.platform` 守卫内）
  实现 `_parse_item_name(name: str) -> Optional[Dict[str,str]]` 后，5/5 case 应 PASSED。

【CI 安全】本文件顶层零 `pywinauto` import；listen_chat.py 也必须保证 _parse_item_name
  定义路径不触发 pywinauto import（pywinauto 只在 scan_unread/reply_in_chat 函数体内 import）。
"""
from __future__ import annotations

import os
import sys

# 把 wechat-rpa 目录加进 sys.path，让本测试在 services/agent/wechat-rpa/tests/ 下也能 import
HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

from listen_chat import _parse_item_name  # noqa: E402  — TDD RED 阶段此 import 会失败


def test_g1_normal_private_message():
    """G1 正常私信：含 [N条] 未读标记 + 非系统账号 → 返回 {sender, content}"""
    result = _parse_item_name("于瑾\n[1条] \n您好\n15:26\n")
    assert result == {"sender": "于瑾", "content": "您好"}


def test_g2_official_account_filtered():
    """G2 公众号过滤：sender 以"公众号"开头 → 返回 None"""
    result = _parse_item_name("公众号\n[1条] \n广告\n11:09\n")
    assert result is None


def test_g3_service_account_filtered():
    """G3 服务号过滤：sender 以"服务号"开头 → 返回 None"""
    result = _parse_item_name("服务号\n[3条] \n活动推送\n09:00\n")
    assert result is None


def test_g4_no_unread_mark_filtered():
    """G4 无未读不返回：第二行无 [N条] 标记 → 返回 None"""
    result = _parse_item_name("李华\n昨天下午好\n11:09\n")
    assert result is None


def test_g5_multi_unread_count():
    """G5 多条未读数字（[5条]）：仍正常解析为 {sender, content}"""
    result = _parse_item_name("张三\n[5条] \n在吗\n09:00\n")
    assert result == {"sender": "张三", "content": "在吗"}


# ─── 回归测试：WeChat UI 状态标记不得作为 content（根因：糊糊大老婆永久 skip） ───


def test_g6_pinned_indicator_only_returns_none():
    """G6 仅"已置顶"无真实消息 → 返回 None，不把置顶标记当 content。

    WeChat 置顶会话 ListItem.name 格式：糊糊大老婆\\n[1条] \\n已置顶\\n14:30\\n
    "已置顶"是 UI 状态标记，不是客户消息。若错误提取为 content，
    replied[(sender, '已置顶')] 永久封锁该会话。
    """
    result = _parse_item_name("糊糊大老婆\n[1条] \n已置顶\n14:30\n")
    assert result is None, f"置顶会话只有 UI 标记时应返回 None，实际: {result}"


def test_g7_pinned_indicator_with_real_content_extracts_content():
    """G7 已置顶 + 真实消息 → 跳过"已置顶"，提取真实消息。

    格式：糊糊大老婆\\n[1条] \\n已置顶\\n你好啊\\n14:30\\n
    """
    result = _parse_item_name("糊糊大老婆\n[1条] \n已置顶\n你好啊\n14:30\n")
    assert result == {"sender": "糊糊大老婆", "content": "你好啊"}, (
        f"应跳过'已置顶'提取真实消息，实际: {result}"
    )


def test_g8_draft_indicator_returns_none():
    """G8 [草稿]标记 → 返回 None，不把草稿标记当 content。

    WeChat 有未发草稿时 ListItem.name 格式：
      糊糊大老婆\\n[1条] \\n[草稿]\\n14:30\\n
    """
    assert _parse_item_name("糊糊大老婆\n[1条] \n[草稿]\n14:30\n") is None, (
        "'[草稿]'作为独立段时应返回 None"
    )
    assert _parse_item_name("糊糊大老婆\n[1条] \n草稿\n14:30\n") is None, (
        "'草稿'作为独立段时应返回 None"
    )


# ─── 规则3 删除回归：私聊消息常以"词+冒号"开头，不得被当群删（rog 真机实证误杀真客户）───


def test_g9_private_message_with_colon_prefix_not_dropped():
    """私聊消息"提醒：明天发货"以词+冒号开头 → 必须返回该联系人，不得被旧规则3当群删掉。"""
    result = _parse_item_name("张三\n[1条] \n提醒：明天发货\n15:26\n")
    assert result == {"sender": "张三", "content": "提醒：明天发货"}, (
        f"带冒号私聊不得被删，实际: {result}"
    )


def test_g10_private_message_with_ascii_colon_link_not_dropped():
    """私聊"链接: http://x" 半角冒号+空格 → 仍是私聊，不得被删。"""
    result = _parse_item_name("李四\n[1条] \n链接: http://x.com\n11:09\n")
    assert result == {"sender": "李四", "content": "链接: http://x.com"}


def test_g11_name_with_group_word_no_longer_dropped_by_parse():
    """删规则1：sender 名字含"群"不再在解析端排除（人名"李立群"/群发会误伤，名字不可靠）。
    群/私聊改由打开会话读右上角标题 (N) 判定（见 enrich 层 _is_group_by_header）。"""
    # 人名含"群"字 → 必须返回（之前被规则1误删）
    assert _parse_item_name("李立群\n[1条] \n你好\n10:00\n") == {"sender": "李立群", "content": "你好"}
    # 即便真群命名带"群"，解析端也不再删（由标题 (N) 判，采集端不靠名字猜）
    assert _parse_item_name("学习指导群\n[1条] \n大家好\n10:00\n") == {"sender": "学习指导群", "content": "大家好"}


def test_g12_official_account_still_filtered_rule2():
    """规则2 保留：公众号系统号 → 仍排除。"""
    assert _parse_item_name("公众号\n[1条] \n推广\n10:00\n") is None
