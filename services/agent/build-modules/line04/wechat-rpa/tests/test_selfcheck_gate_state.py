# -*- coding: utf-8 -*-
"""selfcheck_bubbles 找窗口状态机纯函数（2026-07-06 CI 闸修复）。

背景：rog 微信 UIA 死区 ~40h 期间 gate 报「no wechat window — 微信没跑或没登录」，
把「进程在但 UIA 死区」和「微信真没跑」混为一谈，运营无法按 reason 行动。
"""
import os
import inspect
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
    clear_target_search,
    finalize_search_recovery_cleanup,
    find_item_with_recovery,
    find_target_item,
    find_target_item_via_search,
    main,
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


def test_find_target_item_via_search_uses_edit1_and_exact_first_line():
    exact = _Item("文件传输助手\n搜索结果\n08:02\n")
    prefix_only = _Item("文件传输助手测试号\n搜索结果\n08:01\n")

    class _SearchEdit:
        def __init__(self):
            self.focused = False
            self.value = None

        def set_focus(self):
            self.focused = True

        def set_edit_text(self, value):
            self.value = value

    class _SearchMW:
        def __init__(self):
            self.search = _SearchEdit()
            self.lookup = None

        def child_window(self, **kwargs):
            self.lookup = kwargs
            return self.search

        def descendants(self, control_type=None):
            return [prefix_only, exact]

    mw = _SearchMW()
    slept = []
    found = find_target_item_via_search(mw, "文件传输助手", slept.append)

    assert found is exact
    assert mw.lookup == {"auto_id": "edit1", "control_type": "Edit"}
    assert mw.search.focused is True
    assert mw.search.value == "文件传输助手"
    assert slept == [0.8]


def test_search_supports_real_uiawrapper_descendants_without_child_window():
    """find_weixin 真机返回 UIAWrapper；它没有 child_window，须按 automation_id 枚举 Edit。"""
    exact = _Item("文件传输助手\n刚刚\n")

    class _Edit:
        def __init__(self, automation_id):
            self.element_info = type(
                "_EI", (), {"automation_id": automation_id}
            )()
            self.values = []

        def set_focus(self):
            pass

        def set_edit_text(self, value):
            self.values.append(value)

    decoy = _Edit("other")
    search = _Edit("edit1")

    class _WrapperOnlyMW:
        def descendants(self, control_type=None):
            if control_type == "Edit":
                return [decoy, search]
            if control_type == "ListItem":
                return [exact]
            return []

    mw = _WrapperOnlyMW()
    found = find_target_item_via_search(mw, "文件传输助手", lambda s: None)

    assert found is exact
    assert search.values == ["文件传输助手"]
    assert clear_target_search(mw) is True
    assert search.values == ["文件传输助手", ""]
    assert decoy.values == []


def test_find_target_item_via_search_rejects_duplicate_exact_names_and_clears():
    """两个完全同名结果无法证明哪个是系统账号，必须拒绝并清空搜索态。"""
    exact_a = _Item("文件传输助手\n搜索结果 A\n08:02\n")
    exact_b = _Item("文件传输助手\n搜索结果 B\n08:03\n")

    class _SearchEdit:
        def __init__(self):
            self.values = []

        def set_focus(self):
            pass

        def set_edit_text(self, value):
            self.values.append(value)

    class _SearchMW:
        def __init__(self):
            self.search = _SearchEdit()

        def child_window(self, **kwargs):
            return self.search

        def descendants(self, control_type=None):
            return [exact_a, exact_b]

    mw = _SearchMW()
    found = find_target_item_via_search(mw, "文件传输助手", lambda s: None)

    assert found is None
    assert mw.search.values == ["文件传输助手", ""]


def test_failed_search_records_cleanup_state_for_fresh_window_retry():
    """歧义搜索即使旧 wrapper 清理失败，也必须留下统一 fresh-wrapper 清理状态。"""
    exact_a = _Item("文件传输助手\n搜索结果 A\n08:02\n")
    exact_b = _Item("文件传输助手\n搜索结果 B\n08:03\n")

    class _FailingClearEdit:
        def set_focus(self):
            pass

        def set_edit_text(self, value):
            if value == "":
                raise RuntimeError("stale wrapper")

    class _WorkingEdit:
        def __init__(self):
            self.values = []

        def set_edit_text(self, value):
            self.values.append(value)

    class _SearchMW:
        def __init__(self, items, edit):
            self.items = items
            self.edit = edit

        def child_window(self, **kwargs):
            return self.edit

        def descendants(self, control_type=None):
            return self.items

    stale = _SearchMW([exact_a, exact_b], _FailingClearEdit())
    fresh = _SearchMW([], _WorkingEdit())
    cleanup_state = {}

    found = find_target_item_via_search(
        stale,
        "文件传输助手",
        lambda s: None,
        cleanup_state=cleanup_state,
        find_window_fn=lambda: fresh,
    )
    cleanup_exit = finalize_search_recovery_cleanup(
        {},
        cleanup_state["mw"],
        cleanup_state["find_window_fn"],
    )

    assert found is None
    assert cleanup_state["search_attempted"] is True
    assert cleanup_exit is None
    assert fresh.edit.values == [""]


def test_main_clears_successful_search_recovery_before_returning():
    """任何搜索尝试返回后，main 必须执行 fail-closed 清理再决定最终退出码。"""
    source = inspect.getsource(main)
    assert 'cleanup_state.get("search_attempted")' in source
    assert "finalize_search_recovery_cleanup(" in source
    assert "return cleanup_exit" in source


def test_finalize_search_cleanup_uses_fresh_window_and_fails_gate_when_uncleared():
    """旧 wrapper 失效时必须重新取窗口；全部清理失败时覆盖原成功结果。"""
    stale = object()
    fresh_a = object()
    fresh_b = object()
    fresh_windows = iter([fresh_a, fresh_b])
    cleared = []
    written = []
    result = {"ok": True, "err": None}

    exit_code = finalize_search_recovery_cleanup(
        result,
        stale,
        lambda: next(fresh_windows),
        clear_fn=lambda window: cleared.append(window) or False,
        write_fn=lambda payload: written.append(dict(payload)),
    )

    assert exit_code == 1
    assert cleared == [fresh_a, fresh_b, stale]
    assert result["ok"] is False
    assert "搜索框清理失败" in result["err"]
    assert written == [result]


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
    assert item is not None and how == "reset_recovery_1"
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


# ── reset_fn 有界重试（issue b237a4b6，2026-07-24 rog 真机截图+UIA 实证）──────────
#
# CI self-hosted runner（rog）和生产 line04-wechat-cs 监听共用同一微信窗口，靠
# desktop-lease-broker 优先级互斥；CI 持租期间监听整轮让位（刻意不碰 UIA），窗口
# 状态维持在让位那一刻。若那一刻正停在已打开的聊天面板，reset_fn 之前只调一次，
# 失败就直接放弃——但 _reset_session_list_to_top 的点击升级梯是瞬时操作，网络/
# 前台焦点/窗口动画等瞬态原因导致的单次失败，换一轮全新尝试大概率能成功。

def test_find_item_with_recovery_reset_retries_until_success():
    # reset_fn 前两次失败（"切通讯录未生效，升级梯用尽"），第三次成功。
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    session_list_after_reset = [_Item("文件传输助手\n消息\n08:02\n")]
    mw = _MW([stuck_chat_bubbles] * 6 + [session_list_after_reset])
    reset_calls = []

    def _reset(mw_):
        reset_calls.append(mw_)
        return len(reset_calls) >= 3

    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=5, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=_reset,
    )
    assert item is not None and how == "reset_recovery_3"
    assert len(reset_calls) == 3


def test_find_item_with_recovery_reset_gives_up_after_bounded_retries():
    # reset_fn 一直失败，重试必须有上限，不能无限拖垮 CI。
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    mw = _MW([stuck_chat_bubbles] * 20)
    reset_calls = []

    def _reset(mw_):
        reset_calls.append(mw_)
        return False

    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=1, retry_delay_s=0.01,
        sleep_fn=lambda s: None, reset_fn=_reset,
    )
    assert item is None and how == "not_found"
    assert 2 <= len(reset_calls) <= 10, (
        f"reset_fn 全失败时应重试多次才放弃（不能仍是老的只试一次），"
        f"也不能无上限重试拖垮 CI，实际调用 {len(reset_calls)} 次"
    )


def test_find_item_with_recovery_searches_exact_target_after_reset_exhausted():
    """真机导航按钮完全不响应时，最后用顶部搜索框定位固定目标，而非重复同类点击。"""
    stuck_chat_bubbles = [_Item("[bubble-gate] 1783439923\n08:01\n")]
    mw = _MW([stuck_chat_bubbles] * 20)
    target_item = _Item("文件传输助手\n搜索结果\n08:02\n")
    reset_calls, search_calls = [], []

    item, how = find_item_with_recovery(
        mw, "文件传输助手", retries=1, retry_delay_s=0.01,
        sleep_fn=lambda s: None,
        reset_fn=lambda mw_: reset_calls.append(mw_) or False,
        search_fn=lambda mw_, target: search_calls.append((mw_, target)) or target_item,
    )

    assert item is target_item and how == "search_recovery"
    assert len(reset_calls) == 3
    assert search_calls == [(mw, "文件传输助手")]
