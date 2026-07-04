# -*- coding: utf-8 -*-
"""
Bug 4 (大群缓存) regression — 1.0.107 staging 重测发现：

_is_group_by_header 正则 `[（(]\\s*(\\d+)\\s*[)）]` 匹配字符串中任意位置的
"(数字)"，导致微信名含括号数字的私聊客户（如"客户甲(18)号店"）被误判为群，
写入 _KNOWN_GROUPS 后永久不回。

修法：
1. 正则加 `\\s*$` 锚到字符串末尾——群成员数只出现在名称末尾。
2. 加合理边界（3 ≤ count ≤ 500）——WeChat 群最少 3 人，最多 500 人；
   私聊可能有 (1)/(2) 残留数字，数值 < 3 不当群。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


# ─── 正确的群判断（应保留）───────────────────────────────────────────────────

def test_real_group_with_count_at_end_detected():
    """真实群：名字末尾带 (N) → 识别为群，返回人数。"""
    assert listen_chat._is_group_by_header(["华涛数码(3)"]) == 3
    assert listen_chat._is_group_by_header(["某某客户群（50）"]) == 50


def test_group_count_lower_bound_3():
    """群成员数必须 ≥ 3（WeChat 群最少 3 人）；(2) 在末尾也不当群。"""
    # (2) at end → NOT a group (too small)
    assert listen_chat._is_group_by_header(["私聊备注(2)"]) is None


# ─── Bug 4：名字中间含数字括号，不应误判为群 ──────────────────────────────────

def test_private_contact_with_number_in_middle_not_misclassified():
    """Bug 4 核心断言：私聊名字中间含 (数字) 但末尾无 → 绝不误判为群。

    "某号店(18)经理" → (18) 在中间，末尾是"经理" → 私聊 → None。
    修复前（正则无 $ 锚）：返回 18，被写入 _KNOWN_GROUPS，永久不回。
    """
    result = listen_chat._is_group_by_header(["某号店(18)经理"])
    assert result is None, f"名字中间含 (18) 的私聊被误判为群：返回 {result}"


def test_private_contact_with_parens_number_suffix_in_name():
    """私聊真实场景：格式'姓名(门店编号)' 末尾有数字括号但不是群人数。

    例：'客户甲(1088)' → (1088) > 500 超出群人数上限 → 不当群。
    """
    result = listen_chat._is_group_by_header(["客户甲(1088)"])
    assert result is None, f"成员数 > 500 (1088) 应被过滤：返回 {result}"


def test_private_contact_number_not_at_end_not_group():
    """(N) 不在末尾（后面还有文字）→ 不是群人数标记。"""
    result = listen_chat._is_group_by_header(["销售(3)组组长"])
    assert result is None, f"(3) 后有'组组长'，不在末尾，不应判群：返回 {result}"


def test_group_count_upper_bound_500():
    """群成员数上限 500：(501) 在末尾也不当群（WeChat 官方上限 500）。"""
    result = listen_chat._is_group_by_header(["大群(501)"])
    assert result is None, f"成员数 > 500 应被过滤：返回 {result}"
