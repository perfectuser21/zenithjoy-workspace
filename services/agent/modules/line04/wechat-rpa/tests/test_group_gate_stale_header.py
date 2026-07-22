# -*- coding: utf-8 -*-
"""判群闸 fail-closed 回归：标题面板渲染滞后导致私聊被误判成群
（2026-07-16 17:51 真机实证：员工机器上私聊联系人「❤柚子挖小样C598」被自动跳过不回）。

根因：`_header_confirms_not_group`（PR#1331）只检查读到的标题文本里有没有 "(N)" 人数模式，
从不检查这段标题是否真的属于**当前**联系人。真机连续切换会话时（上一个会话是群「【团团】
勤俭持家W513群」321人，这一个会话是私聊「❤柚子挖小样C598」），标题面板渲染有滞后，
第一轮读到的还是上一个群残留的 "(321)" 文本——`_chat_title_matches` 自己有名字归属校验，
正确判定 "(321)" 不是当前联系人（返回 False，不采信）；但 `_header_confirms_not_group`
没有这层校验，直接把这段残留文本当成"当前联系人是群"的证据，误判跳过不回。

修法：`_header_confirms_not_group` 增加 `title_matches_fn` 参数（同 `_read_trailing_for`
的 F3 同款模式）——`title_matches_fn()` 明确返回 False（读到标题但确定不是当前联系人）
时，本轮标题不可信，重试等面板追上；`True`/`None` 不拦截（群聊标题本身不会跟纯联系人名
精确匹配，`_chat_title_matches` 对群聊天然返回 False，最终仍会走到 fail-closed，结果不变）。

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


def test_stale_group_header_from_previous_chat_does_not_block_private_reply():
    """★核心回归点：前两次读到上一个群残留的 (321)，title_matches_fn 判定不属于当前联系人
    （False）→ 不采信、重试；面板追上后 title 匹配（True）+ 读到真实私聊标题（非群）
    → 必须允许发送（True）。
    """
    # 面板渲染进度用共享状态模拟：真实世界里面板是随时间推进（重试之间的 sleep）
    # 才追上的，不是随读取次数推进——sleep_fn 每被调一次代表面板往前渲染了一步。
    panel_state = {"rendered": 0}

    def read_fn():
        if panel_state["rendered"] < 2:
            return ["(321)"]  # 残留上一个群的标题
        return ["❤柚子挖小样C598"]  # 面板真正切过来后的私聊标题（无括号）

    def title_matches_fn():
        return panel_state["rendered"] >= 2

    def sleep_fn(_delay):
        panel_state["rendered"] += 1

    ok = listen_chat._header_confirms_not_group(
        read_fn, retries=4, retry_delay_s=0.0, sleep_fn=sleep_fn,
        title_matches_fn=title_matches_fn,
    )
    assert ok is True, (
        "标题面板渲染滞后追上后应确认为私聊、允许发送——"
        "真机上「❤柚子挖小样C598」这类私聊联系人被残留群标题误判成群的回归"
    )


def test_stale_header_never_confirmed_still_fails_closed():
    """标题归属校验重试耗尽仍未确认（title_matches_fn 一直 False）→ 仍 fail-closed，不发送。

    覆盖真正的群：群标题本身从不会跟纯联系人名精确匹配，title_matches_fn 对真群永远 False，
    最终应该仍然拦截（结果与今天的行为一致，只是判定路径变了）。
    """
    ok = listen_chat._header_confirms_not_group(
        lambda: ["招商雍澜湾业主群(497)"], retries=3, retry_delay_s=0.0,
        sleep_fn=lambda s: None, title_matches_fn=lambda: False,
    )
    assert ok is False


def test_title_matches_fn_none_preserves_old_behavior():
    """title_matches_fn 不传（None，向后兼容）→ 行为跟修复前一致，不强制归属校验。"""
    ok = listen_chat._header_confirms_not_group(
        lambda: ["李先生"], retries=3, retry_delay_s=0.0, sleep_fn=lambda s: None,
    )
    assert ok is True


def test_reply_in_chat_passes_title_matches_fn_to_group_gate():
    """reply_in_chat 调 _header_confirms_not_group 时必须传 title_matches_fn（防归属校验被绕过）。"""
    import ast

    src_path = os.path.join(_WECHAT, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "reply_in_chat":
            for n in ast.walk(node):
                if (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                        and n.func.id == "_header_confirms_not_group"):
                    kw_names = {kw.arg for kw in n.keywords}
                    assert "title_matches_fn" in kw_names, (
                        f"reply_in_chat 调用 _header_confirms_not_group 必须传 title_matches_fn，"
                        f"实际传入的关键字参数: {sorted(kw_names)}"
                    )
                    return
    assert False, "reply_in_chat 里没找到 _header_confirms_not_group 调用"
