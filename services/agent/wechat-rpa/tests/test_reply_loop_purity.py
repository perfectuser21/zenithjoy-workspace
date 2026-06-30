# -*- coding: utf-8 -*-
"""
环境守卫（做法二 PR3）：静态 AST 断言锁死「客服回复(A) 与 CRM采集(B) 的隔离不变量」。

做法二把 A(回复) 与 B(采集) 拆成两个 Ability，但它们共用同一微信窗口/UIA/焦点不能并行
（xian-rog 0629 真机铁证：B 在回复主循环里乱滚乱开会话 → 丢 SPI 标志 → UIA 树塌 → 误重启
正在工作的微信 → "回一次就不理"）。PR1/PR2 已用纯函数把不变量建起来；本守卫**静态钉死**
任何人未来想把滚动/采集重新塞回回复主循环就让 CI 红，绝不靠自觉。

锁死的不变量（直接解析 listen_chat.py 源码，不跑微信）：
1. 会话列表滚动 `_scroll_session_list_wheel` 只允许出现在两个采集体：
   - `scan_recent_contacts`（CRM 采集 B：滚全列表 + 开会话读标题判群）
   - `scan_unread`（客服回复 A 的扫未读：滚全列表【只读】收集视口外 [N条] 未读）
   ★ 为什么 2026-07-01 放开 scan_unread 也能滚（原只许 scan_recent_contacts）：
     rog 真机铁证——微信 Qt 虚拟列表一次只渲染可见 ~5-6 条；自检狂发「文件传输助手」把客户未读
     顶到视口外没渲染 → 旧 scan_unread 只读可见区 → unread=0 → 客户发消息永远不回。修法是让
     scan_unread 复用同一滚动机制滚整列表找视口外未读。
     与 B 的关键区别（不破坏 SPI 树 / 不重蹈「回一次就不理」）：scan_unread 滚动【只读】收集未读的
     引用/名字，绝不开会话/开群（不在滚动里调 _open_chat 去读群标题），滚完原子归位回顶 +
     还原窗口状态。开群破坏 SPI 树那条祸根仍只在 B（见不变量 2/3/4 锁死 B 隔离）。
2. B 封装——`scan_recent_contacts` 只允许被采集 job `run_friend_scan` 调用（不散落到主循环）。
3. B 受调度守卫——`run_friend_scan` 只有唯一调用方（主循环），且与回复优先守卫 `_should_insert_scan`
   同处一个函数（采集必经窗口锁调度，绝不裸调）。
4. B 跑完重建可读态——`run_friend_scan` 函数体内必调 `_ensure_uia_flag`（否则 A 接手读不到会话）。

proven-to-fire：把 B 的采集调用（scan_recent_contacts/run_friend_scan）塞回主循环、或删掉
_ensure_uia_flag、或绕过 _should_insert_scan 裸调 run_friend_scan，对应断言立即红。
"""
from __future__ import annotations

import ast
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LISTEN_CHAT = os.path.abspath(os.path.join(HERE, "..", "listen_chat.py"))


def _tree() -> ast.Module:
    with open(LISTEN_CHAT, encoding="utf-8") as f:
        return ast.parse(f.read())


def _call_name(node: ast.Call):
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


def _callers_of(tree: ast.Module, callee: str):
    """返回函数体内（直接）调用了 callee 的顶层函数名集合。"""
    callers = set()
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef):
            for node in ast.walk(fn):
                if isinstance(node, ast.Call) and _call_name(node) == callee:
                    callers.add(fn.name)
    return callers


def _callees_in(tree: ast.Module, func_name: str):
    """返回名为 func_name 的函数体内调用到的所有被调名字集合。"""
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name == func_name:
            names = set()
            for node in ast.walk(fn):
                if isinstance(node, ast.Call):
                    nm = _call_name(node)
                    if nm:
                        names.add(nm)
            return names
    return set()


def test_scroll_only_in_scan_bodies_never_in_reply_loop():
    """★滚动只允许出现在两个扫描体（scan_recent_contacts 采集 / scan_unread 只读扫未读），
    绝不散落到回复主循环（run_listen_loop）或其它地方。

    2026-07-01 放开 scan_unread：它需滚整列表找视口外未读（自检刷屏顶掉客户未读的回归），但
    只读收集、滚完归位、不开会话/开群 —— 不破坏 SPI 树。回复主循环本身仍绝不直接滚（防回退）。
    """
    callers = _callers_of(_tree(), "_scroll_session_list_wheel")
    assert callers == {"scan_recent_contacts", "scan_unread"}, (
        f"_scroll_session_list_wheel 应只被 scan_recent_contacts + scan_unread 调用，实际: {callers}"
    )


def test_scan_recent_contacts_only_in_run_friend_scan():
    """★B 封装：滚全列表的 scan_recent_contacts 只允许被采集 job run_friend_scan 调用。"""
    callers = _callers_of(_tree(), "scan_recent_contacts")
    assert callers == {"run_friend_scan"}, (
        f"scan_recent_contacts 应只被 run_friend_scan 调用，实际: {callers}"
    )


def test_run_friend_scan_single_caller_guarded_by_scheduler():
    """★B 受调度守卫：run_friend_scan 唯一调用方，且与回复优先守卫 _should_insert_scan 同函数。"""
    tree = _tree()
    scan_callers = _callers_of(tree, "run_friend_scan")
    guard_callers = _callers_of(tree, "_should_insert_scan")
    assert len(scan_callers) == 1, f"run_friend_scan 应只有唯一调用方(主循环)，实际: {scan_callers}"
    assert scan_callers == guard_callers, (
        f"采集必经回复优先窗口锁调度：run_friend_scan 与 _should_insert_scan 须同函数，"
        f"实际 run={scan_callers} guard={guard_callers}"
    )


def test_run_friend_scan_rebuilds_readable_state():
    """★B 跑完重建可读态：run_friend_scan 函数体必调 _ensure_uia_flag。"""
    callees = _callees_in(_tree(), "run_friend_scan")
    assert "_ensure_uia_flag" in callees, (
        "run_friend_scan 必须调 _ensure_uia_flag 重建可读态（否则 A 接手读不到会话）"
    )
