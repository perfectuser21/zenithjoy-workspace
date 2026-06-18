#!/usr/bin/env python3
"""Evaluator 独立 oracle — 直接构造 Fake UIA 树，断言 listen_chat._last_bubble_direction 真实返回值。

由 Proposer 提交，独立于 Generator 写的 tests/test_msg_direction.py：
即使 Generator 弱化/删改测试文件，本 oracle 仍以真实函数输出为准 → 防假绿。

用法（evaluator 从 repo 根目录跑）：
  python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py <case>
  <case> ∈ incoming | outgoing | operator | last_wins | empty | midline
exit 0 = 该 case 真实通过；exit 1 = 函数未实现 / 返回值不符（FAIL）。
"""
import os
import sys

# 自定位到 services/agent/wechat-rpa（oracle 在 sprints/<sprint>/oracle/ 下，../../../ = repo 根）
_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, "..", "..", "..", "services", "agent", "wechat-rpa"))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _MW:
    """窗口 (0,0)-(800,600)：chat_left=200，聊天面板中线=500。"""

    def __init__(self, texts):
        self.element_info = _EI()
        self._texts = texts

    def rectangle(self):
        return _Rect(0, 0, 800, 600)

    def descendants(self, control_type=None):
        return list(self._texts) if control_type == "Text" else []


_TITLE = _Text("客户A", _Rect(300, 20, 600, 50))            # 标题区 top<150 → 排除
_LIST = _Text("客户A\n[2条]\n在吗\n12:00", _Rect(10, 80, 180, 130))  # 会话列表 left<200 → 排除

# case → (Fake mw, 期望返回值)
_CASES = {
    "incoming":  (_MW([_TITLE, _LIST, _Text("在吗在吗", _Rect(210, 480, 380, 520))]), "incoming"),
    "outgoing":  (_MW([_TITLE, _LIST, _Text("好的稍等", _Rect(600, 480, 770, 520))]), "outgoing"),
    "operator":  (_MW([_TITLE, _LIST,
                       _Text("客户问题", _Rect(210, 300, 380, 340)),
                       _Text("我手动回复了", _Rect(590, 500, 780, 540))]), "outgoing"),
    "last_wins": (_MW([_TITLE,
                       _Text("我先说的", _Rect(600, 300, 770, 340)),
                       _Text("对方后回", _Rect(210, 500, 380, 540))]), "incoming"),
    "empty":     (_MW([_TITLE, _LIST]), None),
    "midline":   (_MW([_TITLE, _Text("压线气泡", _Rect(420, 480, 580, 520))]), "outgoing"),
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in _CASES:
        print(f"FAIL: 用法 direction_oracle.py <{'|'.join(_CASES)}>", file=sys.stderr)
        return 2
    case = sys.argv[1]
    mw, expected = _CASES[case]
    try:
        from listen_chat import _last_bubble_direction
    except ImportError as e:
        print(f"FAIL[{case}]: _last_bubble_direction 未实现 ({e})", file=sys.stderr)
        return 1
    got = _last_bubble_direction(mw)
    if got != expected:
        print(f"FAIL[{case}]: 期望 {expected!r} 实得 {got!r}", file=sys.stderr)
        return 1
    print(f"OK[{case}]: _last_bubble_direction -> {got!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
