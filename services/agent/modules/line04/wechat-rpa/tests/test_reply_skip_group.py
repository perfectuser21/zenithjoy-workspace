# services/agent/wechat-rpa/tests/test_reply_skip_group.py
#
# 群一律不回守卫（2026-07-01 真机：新装 agent 跑去群里聊天；2026-07-16 真机：
# 招商雍澜湾业主群被自动回复，fail-open 根治后判群闸升级为 _header_confirms_not_group）。
#
# 根因(2026-07-01)：回复路径 reply_in_chat 从不判群、post_draft_generate 也不传 is_group → 中台
# generateChatDraft 默认 is_group=false → decideAutoSendRoute 落 send → 群被自动回。
# 修法(2026-07-01)：reply_in_chat 开会话后读右上角标题，_is_group_by_header 命中(带人数)=群 → 跳过不回。
#
# 根因(2026-07-16)：上面这版判群闸是 fail-open——标题读空（UIA 瞬态/窗口偏移）时
# _is_group_by_header 返回 None，`is not None` 不成立 → 误判"非群"放行。修法：
# reply_in_chat 改调 _header_confirms_not_group（有界重试 + fail-closed：读不清就不发），
# 详见 tests/test_group_gate_fail_closed.py。
#
# 本守卫直接解析 listen_chat.py 源码（不跑微信）：reply_in_chat 函数体必须调用
# _header_confirms_not_group。任何人把群判定从回复路径删掉 → 立即红。

from __future__ import annotations

import ast
import os

_SRC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "listen_chat.py")


def _func_calls(func_name: str) -> set:
    """返回 listen_chat.py 里 func_name 函数体内直接调用的所有函数名集合。"""
    with open(_SRC, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            calls = set()
            for n in ast.walk(node):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    calls.add(n.func.id)
            return calls
    return set()


def test_reply_in_chat_checks_group():
    """★reply_in_chat 必须调 _header_confirms_not_group 判群（fail-closed：读不清也不回）。"""
    calls = _func_calls("reply_in_chat")
    assert "_header_confirms_not_group" in calls, (
        "reply_in_chat 必须调用 _header_confirms_not_group 判群后跳过群聊/读不清也跳过，"
        f"否则群会被自动回。实际调用: {sorted(calls)}"
    )


def test_header_confirms_not_group_uses_group_detector():
    """_header_confirms_not_group 内部必须真的调用 _is_group_by_header 做判定，不是空壳。"""
    calls = _func_calls("_header_confirms_not_group")
    assert "_is_group_by_header" in calls, (
        f"_header_confirms_not_group 应调用 _is_group_by_header 判群，实际调用: {sorted(calls)}"
    )
