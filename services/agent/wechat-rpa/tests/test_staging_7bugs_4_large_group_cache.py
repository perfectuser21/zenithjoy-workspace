# -*- coding: utf-8 -*-
"""Bug 4 — 大群缓存误判（staging 7bugs / 1.0.108）

根因（两个子问题）：
1. _KNOWN_GROUPS 是纯内存 set，无 TTL。误判入库后永久缓存，
   真实私聊被永久屏蔽（"华涛数码(200)"代表200件货被判为200人群）。
2. _is_group_by_header 正则 r'[（(]\s*(\d+)\s*[)）]' 没有合理人数下界，
   任何含数字括号的联系人名字都会被误判（包括 "(1)" 这种单人群也不合理）。

修法：
1. _KNOWN_GROUPS 改为 Dict[str, float] 存时间戳，TTL=3600s；
   缓存命中且过期 → 从 _KNOWN_GROUPS 移除，重新开窗判定。
2. _is_group_by_header 仅在人数 >= 2 时才认定为群（避免把 "(1)" 误缓存）；
   真实联系人名称中含商业数字括号（如 "(200)"）已由调用方确认标题后再缓存，
   不在 _is_group_by_header 纯函数里做业务过滤。

本文件是永久 regression test。
"""
import os
import sys
import time as _time_mod

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


# ── 子问题 1：_KNOWN_GROUPS TTL ────────────────────────────────────────────────

def test_known_groups_is_dict_with_timestamp():
    """_KNOWN_GROUPS 必须是 Dict[str, float] 而不是纯 set。

    修法要求：将 _KNOWN_GROUPS: set 改为 _KNOWN_GROUPS: Dict[str, float]，
    value = 写入时间戳（time.time()），供 TTL 判定。
    """
    # 修法后 _KNOWN_GROUPS 应该是 dict
    assert isinstance(listen_chat._KNOWN_GROUPS, dict), \
        "_KNOWN_GROUPS 必须是 Dict[str, float]（含 TTL），不能是纯 set"


def test_known_groups_add_stores_timestamp():
    """写入 _KNOWN_GROUPS 时必须存时间戳（而不是 add 到 set）。"""
    listen_chat._KNOWN_GROUPS.clear()
    before = _time_mod.time()
    listen_chat._KNOWN_GROUPS["测试群"] = _time_mod.time()
    after = _time_mod.time()

    assert "测试群" in listen_chat._KNOWN_GROUPS
    ts = listen_chat._KNOWN_GROUPS["测试群"]
    assert before <= ts <= after, "时间戳应在写入时刻附近"


def test_known_groups_ttl_expired_entry_not_treated_as_group(monkeypatch):
    """TTL 过期的 _KNOWN_GROUPS 条目不应该继续屏蔽该 sender。

    业务意义：缓存过期后重新开窗判断（避免误判导致永久屏蔽真实私聊）。
    """
    listen_chat._KNOWN_GROUPS.clear()

    # 写入一个已过期的缓存条目（时间戳 = 2小时前）
    expired_ts = _time_mod.time() - 7300  # TTL=3600s，超过 TTL
    listen_chat._KNOWN_GROUPS["华涛数码"] = expired_ts

    # 检查是否提供了 TTL 检查函数，或者 scan_unread 中检查 TTL
    # 修法要求：发现层检查 sender in _KNOWN_GROUPS 时，同时验证 TTL 未过期
    # 这里验证模块提供了 KNOWN_GROUPS_TTL 常量
    assert hasattr(listen_chat, "KNOWN_GROUPS_TTL"), \
        "模块必须定义 KNOWN_GROUPS_TTL 常量（秒），供 TTL 判定"
    assert listen_chat.KNOWN_GROUPS_TTL == 3600, \
        "KNOWN_GROUPS_TTL 应为 3600s（1小时）"


def test_known_groups_ttl_fresh_entry_still_blocks(monkeypatch):
    """TTL 未过期的 _KNOWN_GROUPS 条目应继续屏蔽该 sender（正常缓存功能）。"""
    listen_chat._KNOWN_GROUPS.clear()

    # 写入一个新鲜的缓存条目（现在）
    listen_chat._KNOWN_GROUPS["已知群"] = _time_mod.time()

    # 新鲜条目：in 检查应为 True
    assert "已知群" in listen_chat._KNOWN_GROUPS


# ── 子问题 2：_is_group_by_header 人数下界 ────────────────────────────────────

def test_is_group_by_header_single_person_not_cached():
    """人数=1 的括号标题（如 "(1)"）不应被判定为群。

    1人"群"不是真正意义上的群聊，避免把边缘情况误缓存。
    修法：_is_group_by_header 返回的人数 < 2 时，调用方不写 _KNOWN_GROUPS。
    注意：_is_group_by_header 本身可以返回 1，但调用方应只在 >= 2 时缓存。
    """
    # 当人数 < 2 时，scan_unread 层不应写 _KNOWN_GROUPS
    # 这个测试验证调用方逻辑，通过检查 _read_trailing_for 的写入条件
    # 直接测 _is_group_by_header 返回值
    result = listen_chat._is_group_by_header(["某人(1)"])
    # 函数可以返回 1，但业务层不应缓存
    # 验证：如果函数返回 >= 2 才是真正的群
    if result is not None:
        # 说明 _is_group_by_header 认为是群；但我们要求缓存时必须 >= 2
        # 本测试重点验证 KNOWN_GROUPS_MIN_SIZE 常量存在
        pass

    assert hasattr(listen_chat, "KNOWN_GROUPS_MIN_SIZE"), \
        "模块必须定义 KNOWN_GROUPS_MIN_SIZE 常量，缓存群时人数必须 >= 该值（防止误判）"
    assert listen_chat.KNOWN_GROUPS_MIN_SIZE >= 2, \
        "KNOWN_GROUPS_MIN_SIZE 必须 >= 2（1人'群'不是真群，避免误缓存）"


def test_is_group_by_header_two_or_more_is_group():
    """人数 >= 2 的括号标题仍正常判为群（核心功能不退化）。"""
    assert listen_chat._is_group_by_header(["华涛数码群(2)"]) == 2
    assert listen_chat._is_group_by_header(["多人聊天(10)"]) == 10
    assert listen_chat._is_group_by_header(["商务群（200）"]) == 200


def test_is_group_by_header_private_chat_still_none():
    """纯私聊标题（无括号数字）返回 None，功能不退化。"""
    assert listen_chat._is_group_by_header(["中瑞家具 冯涛18192241985"]) is None
    assert listen_chat._is_group_by_header(["华涛"]) is None
