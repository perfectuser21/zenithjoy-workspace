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
    find_item_with_recovery,
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
    # find_target_item 本身必须对空输入安全返回 None，不能抛异常。
    # （空列表的真实根因见 test_selfcheck_bubbles_gate.py：不是渲染时序，是窗口
    # 停在已打开的聊天面板而非会话列表——那层恢复逻辑单独测。）
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


# ── find_item_with_recovery（2026-07-08 rog 真机实证的真根因修法）────────────────
#
# 真根因不是渲染时序：上一轮 reply_in_chat 发送成功但送达确认超时会 return False，
# 跳过收尾的 _navigate_away，把窗口留在已打开的目标聊天面板（session-1 诊断亲眼
# 确认：descendants(ListItem) 枚举到的是聊天气泡"[bubble-gate] <ts>"/时间戳，不是
# 会话列表条目）。纯重试等不到变化，必须主动切 tab（_reset_session_list_to_top）
# 强制会话列表视图重建。

class _MW:
    def __init__(self, snapshots):
        self._snapshots = list(snapshots)
        self.descendants_calls = 0

    def descendants(self, control_type=None):
        self.descendants_calls += 1
        idx = min(self.descendants_calls - 1, len(self._snapshots) - 1)
        return self._snapshots[idx]


def test_find_item_with_recovery_first_try_no_sleep_no_reset():
    mw = _MW([[_Item("文件传输助手\n消息\n08:01\n")]])
    slept, reset_calls = [], []
    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=3, retry_delay_s=1.0,
        sleep_fn=lambda s: slept.append(s),
        reset_fn=lambda mw_: reset_calls.append(1) or True,
    )
    assert item is not None and how == "first_try"
    assert slept == []
    assert reset_calls == []


def test_find_item_with_recovery_succeeds_within_plain_retries():
    # 前两次枚举都是空（真实场景不会因为这个变化，但函数本身要支持这种输入）
    mw = _MW([[], [], [_Item("文件传输助手\n消息\n08:01\n")]])
    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=3, retry_delay_s=1.0,
        sleep_fn=lambda s: None,
        reset_fn=lambda mw_: (_ for _ in ()).throw(AssertionError("不该走到 reset")),
    )
    assert item is not None and how == "retry_2"


def test_find_item_with_recovery_falls_back_to_reset_when_stuck_in_chat_panel():
    # 复现 2026-07-08 rog 实况：前面所有次枚举都只有聊天气泡（不是会话列表），
    # reset_fn 成功后才终于看到会话列表条目。
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    session_list_after_reset = [_Item("文件传输助手\n消息\n08:02\n")]
    mw = _MW([stuck_chat_bubbles] * 6 + [session_list_after_reset])
    reset_calls = []

    def _reset(mw_):
        reset_calls.append(mw_)
        return True

    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=5, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=_reset,
    )
    assert item is not None and how == "reset_recovery"
    assert reset_calls == [mw]


def test_find_item_with_recovery_reset_fails_returns_not_found():
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    mw = _MW([stuck_chat_bubbles])
    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=2, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=lambda mw_: False,
    )
    assert item is None and how == "not_found"


def test_find_item_with_recovery_reset_exception_swallowed():
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    mw = _MW([stuck_chat_bubbles])

    def _boom(mw_):
        raise RuntimeError("UIA 点击异常")

    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=1, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=_boom,
    )
    assert item is None and how == "not_found"
