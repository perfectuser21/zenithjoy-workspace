# -*- coding: utf-8 -*-
"""selfcheck_bubbles 找窗口状态机纯函数（2026-07-06 CI 闸修复）。

背景：rog 微信 UIA 死区 ~40h 期间 gate 报「no wechat window — 微信没跑或没登录」，
把「进程在但 UIA 死区」和「微信真没跑」混为一谈，运营无法按 reason 行动。
"""
import os
import sys

_TOOLS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

from selfcheck_bubbles import (  # noqa: E402
    FIND_ITEM_RETRIES,
    FIND_ITEM_RETRY_DELAY_S,
    FIND_WINDOW_RETRIES,
    FIND_WINDOW_RETRY_DELAY_S,
    classify_no_window,
    find_target_item,
)


def test_no_process_classified():
    code, msg = classify_no_window(process_running=False)
    assert code == "NO_PROCESS"
    assert "Weixin.exe" in msg


def test_uia_dead_classified():
    code, msg = classify_no_window(process_running=True)
    assert code == "UIA_DEAD"
    assert "UIA" in msg


def test_retry_budget_covers_transient_startup():
    # 有界重试至少覆盖 1 分钟瞬态（微信启动/树重建），但别无限等
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S >= 60
    assert FIND_WINDOW_RETRIES * FIND_WINDOW_RETRY_DELAY_S <= 180


# ── find_target_item + 找 item 有界重试预算（2026-07-08 rog 实证）────────────────

class _EI:
    def __init__(self, name=None, raises=False):
        self._name = name
        self._raises = raises

    @property
    def name(self):
        if self._raises:
            raise RuntimeError("UIA element gone")
        return self._name


class _Item:
    def __init__(self, name=None, raises=False):
        self.element_info = _EI(name=name, raises=raises)


def test_find_target_item_matches_prefix():
    items = [_Item("其他会话\n[1条] \n你好\n08:00\n"),
             _Item("文件传输助手\n刚刚的消息\n08:01\n")]
    found = find_target_item(items, "文件传输助手")
    assert found is items[1]


def test_find_target_item_not_found_returns_none():
    items = [_Item("其他会话\n[1条] \n你好\n08:00\n")]
    assert find_target_item(items, "文件传输助手") is None


def test_find_target_item_empty_list_does_not_crash():
    # P0 复现（rog 2026-07-08 实证）：窗口刚可见时会话列表虚拟列表还没渲染完，
    # 枚举 descendants 可能拿到空列表——find_target_item 本身必须对空输入安全返回
    # None，不能抛异常；"空列表也该重试"这件事由 main() 里包一层有界重试处理。
    assert find_target_item([], "文件传输助手") is None


def test_find_target_item_skips_broken_items():
    # 个别 item 读 name 抛异常（UIA 元素已失效）不能拖垮整次查找，跳过继续找
    items = [_Item(raises=True), _Item("文件传输助手\n消息\n08:01\n")]
    found = find_target_item(items, "文件传输助手")
    assert found is items[1]


def test_item_retry_budget_covers_render_transient_but_not_forever():
    # 有界重试覆盖会话列表虚拟列表渲染瞬态（数秒级），但别无限等
    assert FIND_ITEM_RETRIES * FIND_ITEM_RETRY_DELAY_S >= 5
    assert FIND_ITEM_RETRIES * FIND_ITEM_RETRY_DELAY_S <= 30
