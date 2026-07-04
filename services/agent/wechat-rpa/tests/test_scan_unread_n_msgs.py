"""
test_scan_unread_n_msgs.py — Bug②：scan_unread 多条未读合并上下文
TDD RED 阶段。

【根因】listen_chat.py 的 scan_unread 只读 ListItem name 最后一条预览，
  一人连发 3 条 → AI 只看到第 1 条内容，漏掉 2/3 条上下文。

【修法两点】
  (a) scan 只处理有 [N条] 红点（path-1），不再全量遍历内容变化（path-2 已无必要，减延迟）。
  (b) N>1 时打开会话读取全部 N 条消息，aggregate_messages 合并成一次回复的上下文。

【纯函数锚点（CI 可测，顶层零 pywinauto）】
  - parse_unread_count(item_name: str) -> int  从 [N条] 解析 N
  - aggregate_messages(messages: List[str]) -> str  合并多条消息

RED 证据：import listen_chat 时两个函数不存在 → AttributeError / ImportError。
GREEN 证据：commit-2 在 listen_chat.py 顶层（不在任何 if platform 守卫内）实现两函数后全部 PASSED。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

# RED：这两个函数在 commit-1 时不存在 → AttributeError
from listen_chat import parse_unread_count, aggregate_messages  # noqa: E402


# ─── parse_unread_count 测试 ────────────────────────────────────────────────

def test_parse_unread_count_single():
    """[1条] → 1"""
    assert parse_unread_count("于瑾\n[1条] \n您好\n15:26\n") == 1


def test_parse_unread_count_multi():
    """[3条] → 3（一人连发多条的场景）"""
    assert parse_unread_count("张三\n[3条] \n在吗\n09:00\n") == 3


def test_parse_unread_count_large():
    """[10条] → 10"""
    assert parse_unread_count("李四\n[10条] \n消息\n12:00\n") == 10


def test_parse_unread_count_no_badge():
    """无 [N条] 角标 → 0"""
    assert parse_unread_count("王五\n普通消息\n11:09\n") == 0


def test_parse_unread_count_empty():
    """空字符串 → 0，不报错"""
    assert parse_unread_count("") == 0


def test_parse_unread_count_none_like():
    """只有 sender 无角标 → 0"""
    assert parse_unread_count("张三") == 0


# ─── aggregate_messages 测试 ────────────────────────────────────────────────

def test_aggregate_messages_empty():
    """空列表 → 空串"""
    assert aggregate_messages([]) == ""


def test_aggregate_messages_single():
    """单条 → 原样返回，不加分隔符"""
    assert aggregate_messages(["你好啊"]) == "你好啊"


def test_aggregate_messages_three():
    """三条 → 双换行拼接（AI 看到完整上下文）"""
    result = aggregate_messages(["第一条消息", "第二条消息", "第三条消息"])
    assert result == "第一条消息\n\n第二条消息\n\n第三条消息"


def test_aggregate_messages_strips_whitespace():
    """每条去掉首尾空白"""
    result = aggregate_messages(["  你好  ", "  在吗  "])
    assert result == "你好\n\n在吗"


def test_aggregate_messages_skips_blank():
    """空串/纯空白条目跳过"""
    result = aggregate_messages(["msg1", "", "  ", "msg3"])
    assert result == "msg1\n\nmsg3"


def test_aggregate_messages_order_preserved():
    """消息顺序保持（最早 → 最新，AI 看时间线）"""
    msgs = ["8点说的第一句", "8点半说的第二句", "9点说的第三句"]
    result = aggregate_messages(msgs)
    parts = result.split("\n\n")
    assert parts[0] == "8点说的第一句"
    assert parts[2] == "9点说的第三句"

# ─── 修复 5：99+ 角标格式 ────────────────────────────────────────────────────

def test_parse_unread_count_99plus():
    """[99+条] → 100（触发开会话读取完整消息数）"""
    assert parse_unread_count("群名\n[99+条] \n消息\n10:00\n") == 100


def test_parse_unread_count_large_plus():
    """[9+条] → 10"""
    assert parse_unread_count("联系人\n[9+条] \n内容\n08:00\n") == 10
