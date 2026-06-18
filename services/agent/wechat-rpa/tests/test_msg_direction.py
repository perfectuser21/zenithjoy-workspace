"""
TDD RED 阶段 — 「读最后一条气泡方向」纯函数 `_last_bubble_direction` 单测。

【Sprint】06181535-line04-cs-msg-direction —— Line04「不回自己」：回复前判断消息方向。

【放置路径】本文件即最终回归测试，永久留在 CI（services/agent/wechat-rpa/tests/）。
  CI workflow `.github/workflows/wechat-cs-e2e.yml` 跑 `python -m pytest tests/ -q` 时执行。

【契约 API（Proposer 定义，PRD 把阈值推导授权给 Proposer）】
  listen_chat._last_bubble_direction(mw) -> Optional[str]
    读「聊天面板内最底部」一条 Text 气泡，按其水平中心相对聊天面板中线判定方向：
      - 返回 "incoming"  气泡中心在中线左侧  → 对方发来        → 应回
      - 返回 "outgoing"  气泡中心在中线右侧/压线 → 我方/AI/操作者 → 跳过（压线倾向判我方更安全）
      - 返回 None        聊天面板内读不到任何气泡（空会话/读不到） → 安全跳过
  聊天面板 = 窗口右侧（left > 窗口左 + 宽//4，沿用 _chat_title_matches 的区域约定），
  且在标题区下方（top >= 窗口顶 + 150）。窗口中线按聊天面板中心 = (chat_left + 窗口右)//2。

【语义映射（主循环接线，本测试对 direction 取值断言；接线由 ARTIFACT 校验）】
  incoming → 进入生成+发送；outgoing → 跳过 且 human_intervened=True（人工介入优先）；None → 跳过。

【RED 证据】import 时 `_last_bubble_direction` 不存在 → ImportError → 全 case 报错（TDD 红）。
【GREEN 证据】Generator 在 listen_chat.py 顶层（不在 sys.platform 守卫内、零 pywinauto）实现后全 PASS。
【CI 安全】顶层零 pywinauto import；纯 Fake 对象注入，跨平台跑。
"""
from __future__ import annotations

import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

from listen_chat import _last_bubble_direction  # noqa: E402 — TDD RED 阶段此 import 会失败


# ─── Fake UIA 对象（对齐 test_reply_routing_isolation.py 的注入风格，零 pywinauto）──────


class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _FakeText:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _FakeMW:
    """主窗口 Fake：矩形 (0,0)-(800,600)；宽 800 → chat_left=200，聊天面板中线=500。

    texts 即 descendants(control_type="Text") 返回的全部 Text 控件。
    """

    WIN = _Rect(0, 0, 800, 600)

    def __init__(self, texts):
        self.element_info = _EI()
        self._texts = texts

    def rectangle(self):
        return self.WIN

    def descendants(self, control_type=None):
        if control_type == "Text":
            return list(self._texts)
        return []


# 标题区文本（top<150，应被排除，不能当气泡）；左侧会话列表项（left<200，应被排除）
_TITLE = _FakeText("客户A", _Rect(300, 20, 600, 50))
_LIST_ITEM = _FakeText("客户A\n[2条]\n在吗\n12:00", _Rect(10, 80, 180, 130))


def test_left_aligned_last_bubble_is_incoming():
    """最后气泡左对齐（中心 295 < 中线 500）→ 对方发来 → incoming（应回）。"""
    mw = _FakeMW([_TITLE, _LIST_ITEM, _FakeText("在吗在吗", _Rect(210, 480, 380, 520))])
    assert _last_bubble_direction(mw) == "incoming"


def test_right_aligned_last_bubble_is_outgoing():
    """最后气泡右对齐（中心 685 > 中线 500）→ 我方/AI → outgoing（跳过，不回自己）。"""
    mw = _FakeMW([_TITLE, _LIST_ITEM, _FakeText("好的稍等", _Rect(600, 480, 770, 520))])
    assert _last_bubble_direction(mw) == "outgoing"


def test_operator_right_aligned_is_outgoing_for_human_intervened():
    """操作者手动回过（最底部右对齐气泡）→ outgoing；上游据此置 human_intervened=True 跳过本条 AI 回复。"""
    mw = _FakeMW([
        _TITLE,
        _LIST_ITEM,
        _FakeText("客户问题", _Rect(210, 300, 380, 340)),          # 较早：对方
        _FakeText("我手动回复了", _Rect(590, 500, 780, 540)),      # 最底部：操作者右对齐
    ])
    assert _last_bubble_direction(mw) == "outgoing"


def test_last_bubble_wins_not_any_bubble():
    """多条气泡时只看最底部那条：上方 outgoing + 最底部 incoming → 必须返回 incoming。"""
    mw = _FakeMW([
        _TITLE,
        _FakeText("我先说的", _Rect(600, 300, 770, 340)),          # 上方：outgoing
        _FakeText("对方后回", _Rect(210, 500, 380, 540)),          # 最底部：incoming
    ])
    assert _last_bubble_direction(mw) == "incoming"


def test_empty_chat_returns_none_safe_skip():
    """聊天面板内无气泡（只有标题 + 会话列表项）→ None → 安全跳过（宁可漏回不可回错）。"""
    mw = _FakeMW([_TITLE, _LIST_ITEM])
    assert _last_bubble_direction(mw) is None


def test_bubble_on_midline_classified_outgoing():
    """气泡恰好压在中线（中心 == 500）→ 归类 outgoing（边界倾向判我方，更安全）。"""
    mw = _FakeMW([_TITLE, _FakeText("压线气泡", _Rect(420, 480, 580, 520))])
    assert _last_bubble_direction(mw) == "outgoing"
