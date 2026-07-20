# -*- coding: utf-8 -*-
"""合同测试 — Line04 半死区修复（task 5e9d608f）

覆盖点：
  L1（判群前窗口形态不变量）×3 case
  L2（半死区梯度自愈）×2 case
  L3（skip reason 细分）×1 case
  L4（待发队列过期上限）×1 case
共 7 case，全绿 = DoD 满足。

回流自 sprints/07201740-half-deadzone-window-invariant/tests/test_window_invariant.py（commit-1 骨架）。
实现代码（listen_chat.py L1/L2/L4 修改）在 commit-2 落地。
"""
from __future__ import annotations

import types
from unittest.mock import MagicMock

import listen_chat  # conftest.py 已把 wechat-rpa/ 加入 sys.path


# ---------------------------------------------------------------------------
# 辅助：构造 mock ctypes_mod，供 assert_window_shape_for_header 注入
# ---------------------------------------------------------------------------
def _make_ct(*, zoomed: int, iconic: int, w: int = 1920) -> types.SimpleNamespace:
    """返回一个行为符合 ctypes.windll.user32.* 的简单 mock。

    GetWindowRect 通过修改传入的 RECT 引用返回宽度。
    """
    import ctypes

    class FakeRect(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    def fake_get_window_rect(hwnd, ref):
        ref.left = 0
        ref.top = 0
        ref.right = w
        ref.bottom = 800
        return 1

    user32 = types.SimpleNamespace(
        IsZoomed=lambda hwnd: zoomed,
        IsIconic=lambda hwnd: iconic,
        GetWindowRect=fake_get_window_rect,
    )
    return types.SimpleNamespace(windll=types.SimpleNamespace(user32=user32))


# ---------------------------------------------------------------------------
# L1：判群前窗口形态不变量
# ---------------------------------------------------------------------------

def test_l1_iconic_returns_false():
    """[BEHAVIOR-L1-2] iconic=True → 形态违规，返回 False。
    根因：微信主窗 iconic 时标题 pane 不渲染，强读必 title_unreadable。"""
    fn = getattr(listen_chat, "assert_window_shape_for_header", None)
    assert fn is not None, "assert_window_shape_for_header 函数必须存在（L1 不变量）"
    result = fn(hwnd=1, ctypes_mod=_make_ct(zoomed=0, iconic=1, w=1920))
    assert result is False, "iconic=True 应返回 False（需先修形再读）"


def test_l1_zoomed_not_iconic_returns_true():
    """[BEHAVIOR-L1-1] zoomed=True + iconic=False → 窗口已就绪，返回 True。"""
    fn = getattr(listen_chat, "assert_window_shape_for_header", None)
    assert fn is not None, "assert_window_shape_for_header 函数必须存在"
    result = fn(hwnd=1, ctypes_mod=_make_ct(zoomed=1, iconic=0, w=1920))
    assert result is True, "zoomed=True + iconic=False 应返回 True（窗口就绪）"


def test_l1_narrow_non_zoomed_returns_false():
    """[BEHAVIOR-L1-3] zoomed=False + iconic=False + 宽度<双栏阈值 → 返回 False。
    宽度 400px 落入单栏布局，标题 pane 可能不渲染。"""
    fn = getattr(listen_chat, "assert_window_shape_for_header", None)
    assert fn is not None, "assert_window_shape_for_header 函数必须存在"
    result = fn(hwnd=1, ctypes_mod=_make_ct(zoomed=0, iconic=0, w=400))
    assert result is False, "zoomed=False + 窄窗 应返回 False（单栏布局，标题不渲染）"


# ---------------------------------------------------------------------------
# L2：半死区梯度自愈
# ---------------------------------------------------------------------------

def test_l2_cross_sender_triggers_heal():
    """[BEHAVIOR-L2-1] 跨 ≥2 sender 均达阈值 → should_heal_half_deadzone 返回 True。"""
    fn = getattr(listen_chat, "should_heal_half_deadzone", None)
    assert fn is not None, "should_heal_half_deadzone 函数必须存在（L2 梯度自愈）"
    assert fn({"A": 3, "B": 3}) is True, \
        "{'A':3,'B':3} 跨 2 sender 均达阈值，应触发自愈"


def test_l2_single_sender_no_heal():
    """[BEHAVIOR-L2-2] 仅单 sender 连续失败 → 不触发自愈（防冷门联系人误触发重启）。"""
    fn = getattr(listen_chat, "should_heal_half_deadzone", None)
    assert fn is not None, "should_heal_half_deadzone 函数必须存在"
    assert fn({"A": 3}) is False, \
        "{'A':3} 仅单 sender，跨 sender 数=1，不应触发自愈"


# ---------------------------------------------------------------------------
# L3：skip reason 细分
# ---------------------------------------------------------------------------

def test_l3_skip_counter_two_reasons():
    """[BEHAVIOR-L3-1] _SkipCounter 支持 title_unreadable / is_group 两个独立 reason 键。

    3 次 title_unreadable + 1 次 is_group → snapshot 各自独立计数，互不干扰。
    """
    counter_cls = getattr(listen_chat, "_SkipCounter", None)
    assert counter_cls is not None, "_SkipCounter 类必须存在"
    c = counter_cls()
    for _ in range(3):
        c.record("title_unreadable")
    c.record("is_group")
    snap = c.snapshot()
    total = snap.get("total", snap)  # 兼容 snapshot 直接返回 dict 或含 total 键
    assert total.get("title_unreadable") == 3, \
        f"title_unreadable 计数期望 3，实际 {total.get('title_unreadable')}"
    assert total.get("is_group") == 1, \
        f"is_group 计数期望 1，实际 {total.get('is_group')}"


# ---------------------------------------------------------------------------
# L4：待发队列过期上限
# ---------------------------------------------------------------------------

def test_l4_expired_entry_excluded():
    """[BEHAVIOR-L4-1] enqueued_at=0、now=1900、max_age_seconds=1800 → sender 不在重试列表。

    防止积压 30 分钟以上的旧失败消息被无限重试干扰当前对话。
    """
    record_fn = getattr(listen_chat, "record_reply_failure", None)
    select_fn = getattr(listen_chat, "select_due_retries", None)
    assert record_fn is not None, "record_reply_failure 函数必须存在"
    assert select_fn is not None, "select_due_retries 函数必须存在"

    pending: dict = {}
    record_fn(pending, sender="A", content="hi", reply="ok", now=0.0)
    # 确认 enqueued_at 字段已写入（F-L4.1 断言）
    assert "enqueued_at" in pending.get("A", {}), \
        "record_reply_failure 必须写入 enqueued_at 字段（F-L4.1）"

    due = select_fn(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
    assert "A" not in due, \
        "enqueued_at=0, now=1900 超过 max_age_seconds=1800，不应出现在重试列表（F-L4.2）"
