# -*- coding: utf-8 -*-
"""
TDD — 群/私聊判定改用唯一可靠信号：打开会话后右上角标题是否带 (人数)。

业务规则（用户拍板）：群聊不进 CRM，客户 = 纯一对一私聊。
唯一可靠信号（用户实证 + rog 真机 100% 准）：会话左列名字分不出群/私聊，
打开会话后右上角标题——私聊=名字无括号；群=名字带 "(N)"。
  私聊：`中瑞家具 冯涛18192241985` / `Lancelot 。`
  群：  `华涛数码、徐先生企业自媒体-Ai助力(3)` / `徐先生企业自媒体-Ai助力(2)`

真机 UIA 读标题不可单测，但「标题文本数组 → 是否群 + 人数」纯函数可测。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


def test_group_header_half_width_parens():
    """半角括号 "名字(3)" → 群，返回人数 3。"""
    texts = ["华涛数码、徐先生企业自媒体-Ai助力(3)", "华涛数码、徐先生企业自媒体-Ai助力", "(3)"]
    assert listen_chat._is_group_by_header(texts) == 3


def test_group_header_two_member_group():
    assert listen_chat._is_group_by_header(["徐先生企业自媒体-Ai助力(2)"]) == 2


def test_group_header_full_width_parens():
    """全角括号 "名字（5）" → 群，返回人数 5。"""
    assert listen_chat._is_group_by_header(["某客户群（5）"]) == 5


def test_private_chat_no_parens_returns_none():
    """私聊标题无括号 → 不是群，返回 None。"""
    assert listen_chat._is_group_by_header(["中瑞家具 冯涛18192241985"]) is None
    assert listen_chat._is_group_by_header(["Lancelot 。"]) is None


def test_private_chat_name_with_unrelated_parens_text_not_misjudged():
    """私聊名字里普通括号但不是"(纯数字)"人数格式 → 不当群（如英文备注括号）。"""
    # "(abc)" 非数字 → 不算人数
    assert listen_chat._is_group_by_header(["客户A(VIP)"]) is None


def test_empty_or_none_texts_safe():
    assert listen_chat._is_group_by_header([]) is None
    assert listen_chat._is_group_by_header(["", None]) is None


# ── _should_cache_known_group（v1.0.107 大群缓存永不生效根治）─────────────
# 根因：原逻辑要求 _chat_title_matches is True 才缓存，但 469 人大群标题是成员名长串
# 结尾 "(469)"，nm==want / want.startswith(nm) 永假 → 永不缓存 → 每轮反复开窗（闪屏）。
# 放宽：标题带 (N) 且 N>=3 的两种明确群形态也缓存（短标题形态 / 成员列表长串形态）。


def test_cache_relaxed_member_list_long_string():
    """成员列表长串形态：含 (469) 的文本远长于 sender → 缓存（长度分支）。"""
    header = ["张一、李二、王三、赵四、钱五、孙六(469)"]
    assert listen_chat._should_cache_known_group(
        "DJI益田交流1️⃣群", header, title_ok=False) is True


def test_cache_relaxed_short_group_title():
    """短标题形态：去掉末尾 (469) 后 strip == sender → 缓存。"""
    header = ["DJI益田交流1️⃣群(469)"]
    assert listen_chat._should_cache_known_group(
        "DJI益田交流1️⃣群", header, title_ok=False) is True


def test_cache_relaxed_short_group_title_five_members():
    """短标题形态：产品咨询群(5) → 缓存（N=5>=3，去后缀==sender）。"""
    assert listen_chat._should_cache_known_group(
        "产品咨询群", ["产品咨询群(5)"], title_ok=False) is True


def test_cache_below_group_size_floor_not_cached():
    """N=2 < 3 下限 → 不缓存（挡掉 "张三(2)" 这类备注含小数字的误判）。"""
    assert listen_chat._should_cache_known_group(
        "张三", ["张三(2)"], title_ok=False) is False


def test_cache_title_ok_always_true():
    """title_ok=True → 永远缓存（原逻辑不变，即便 header 不带人数也放行）。"""
    assert listen_chat._should_cache_known_group(
        "客户A", ["客户A"], title_ok=True) is True


def test_cache_no_group_header_not_cached():
    """标题无 (N) 且 title_ok=False → 不缓存（私聊）。"""
    assert listen_chat._should_cache_known_group(
        "中瑞家具 冯涛18192241985",
        ["中瑞家具 冯涛18192241985"], title_ok=False) is False
