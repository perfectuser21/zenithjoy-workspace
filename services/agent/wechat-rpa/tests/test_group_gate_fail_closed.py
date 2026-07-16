# -*- coding: utf-8 -*-
"""回复侧判群闸 fail-closed 根治（2026-07-16 xian-rog 真机：招商雍澜湾业主群被自动回复）。

根因：回复路径判群闸 `if _is_group_by_header(_read_chat_header_texts(fmw)) is not None: ... return False`
是 **fail-open**——`_read_chat_header_texts` 读空（[]）时 `_is_group_by_header` 返回 None，
`is not None` 不成立，判群闸直接放行，即使标题读取本身已经失败（UIA 树瞬态/几何计算异常）。
群一旦误发不可逆，语义必须反过来：**读不清标题就不允许发**（fail-closed），而不是读不清就
当私聊处理。

本文件测试新纯函数 `_header_confirms_not_group`（有界重试 + fail-closed 语义），
不进真机、不碰 UIA，可在 CI 单测。

本文件是该 bug 的永久 regression test，禁止删除。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

if "listen_chat" in sys.modules:
    del sys.modules["listen_chat"]

import listen_chat  # noqa: E402


def test_confirms_not_group_when_header_says_private():
    """标题读到、且不带人数（私聊）→ 确认可以发送。"""
    calls = []

    def read_fn():
        calls.append(1)
        return ["中瑞家具 冯涛18192241985"]

    ok = listen_chat._header_confirms_not_group(
        read_fn, retries=3, retry_delay_s=0.0, sleep_fn=lambda s: None,
    )
    assert ok is True
    assert len(calls) == 1  # 一次读到就不该继续重试


def test_rejects_when_header_says_group():
    """标题读到、带人数（群）→ 不允许发送。"""
    ok = listen_chat._header_confirms_not_group(
        lambda: ["招商雍澜湾业主群(497)"], retries=3, retry_delay_s=0.0,
        sleep_fn=lambda s: None,
    )
    assert ok is False


def test_fail_closed_when_header_permanently_unreadable():
    """★核心根治点：标题重试多次仍读空（[]）→ 必须判定不允许发送（fail-closed）。

    修前行为：读空 → _is_group_by_header 返回 None → 判群闸误判"不是群" → 允许发送。
    这正是 2026-07-16 10:45 招商雍澜湾业主群被自动回复的根因路径。
    """
    ok = listen_chat._header_confirms_not_group(
        lambda: [], retries=3, retry_delay_s=0.0, sleep_fn=lambda s: None,
    )
    assert ok is False, (
        "标题读取重试后仍为空时必须 fail-closed（不允许发送），"
        "读空≠私聊——这正是群被误回的根因路径"
    )


def test_retries_before_giving_up():
    """读空要重试到 retries 次数用尽才判定失败，不能读一次空就放弃（吞掉真实瞬态恢复的机会）。"""
    attempts = {"n": 0}

    def read_fn():
        attempts["n"] += 1
        if attempts["n"] < 3:
            return []
        return ["李先生"]  # 第 3 次才读到私聊标题

    ok = listen_chat._header_confirms_not_group(
        read_fn, retries=3, retry_delay_s=0.0, sleep_fn=lambda s: None,
    )
    assert ok is True
    assert attempts["n"] == 3


def test_reply_in_chat_calls_header_confirms_not_group():
    """reply_in_chat 判群闸必须走新的 fail-closed 纯函数，不能绕过。"""
    import ast

    src_path = os.path.join(_WECHAT, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    calls = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "reply_in_chat":
            for n in ast.walk(node):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    calls.add(n.func.id)
            break
    assert "_header_confirms_not_group" in calls, (
        f"reply_in_chat 必须调用 _header_confirms_not_group 做 fail-closed 判群，"
        f"实际调用: {sorted(calls)}"
    )
