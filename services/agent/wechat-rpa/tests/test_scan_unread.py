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
