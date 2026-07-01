# services/agent/wechat-rpa/tests/test_reply_skip_group.py
#
# 群一律不回守卫（2026-07-01 真机：新装 agent 跑去群里聊天）。
#
# 根因：回复路径 reply_in_chat 从不判群、post_draft_generate 也不传 is_group → 中台
# generateChatDraft 默认 is_group=false → decideAutoSendRoute 落 send → 群被自动回。
# 修法：reply_in_chat 开会话后读右上角标题，_is_group_by_header 命中(带人数)=群 → 跳过不回。
#
# 本守卫直接解析 listen_chat.py 源码（不跑微信）：reply_in_chat 函数体必须调用
# _is_group_by_header。任何人把群判定从回复路径删掉 → 立即红。

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
    """★reply_in_chat 必须调 _is_group_by_header 判群（群不回）。"""
    calls = _func_calls("reply_in_chat")
    assert "_is_group_by_header" in calls, (
        "reply_in_chat 必须调用 _is_group_by_header 判群后跳过群聊，"
        f"否则群会被自动回。实际调用: {sorted(calls)}"
    )


def test_reply_in_chat_reads_header_for_group():
    """判群要读右上角标题（_read_chat_header_texts 喂给 _is_group_by_header）。"""
    calls = _func_calls("reply_in_chat")
    assert "_read_chat_header_texts" in calls, (
        f"reply_in_chat 应读会话标题判群，实际调用: {sorted(calls)}"
    )
