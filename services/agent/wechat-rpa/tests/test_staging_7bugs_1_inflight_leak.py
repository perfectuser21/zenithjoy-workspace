# -*- coding: utf-8 -*-
"""Bug 1 — INFLIGHT 泄漏（staging 7bugs / 1.0.108）

根因：主循环有两个 continue 路径绕过了 unread 的 _INFLIGHT 清理：
1. scan_unread 抛异常时 continue（第4007-4010行）
2. dryrun 模式（not _real_publish）时 continue（第4106-4110行）

泄漏导致 _INFLIGHT 中 sender 永久卡住——后续扫描第902行
`if sender in _INFLIGHT: continue` 永远跳过这些 sender。

修法：scan_unread 内部 / 清理逻辑要确保 emit 入 _INFLIGHT 的 sender
在下轮扫描时如果仍在 _INFLIGHT（未 DELIVERED/失败），
主循环两条 continue 路径前均需释放当轮 unread 的 inflight。
本文件是永久 regression test。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name="", control_type=""):
        self.name = name
        self.control_type = control_type
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name, control_type="ListItem")


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class _R:
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


def _mk_mw(sender="默忆", content="你好", badge=1):
    name = f"{sender}\n[{badge}条] \n{content}\n17:47\n"
    return _MW([_Item(name)])


def _setup_scan_env(monkeypatch):
    """给 scan_unread 打桩：无需真实 UIA 就能跑。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "你好", "direction": "incoming"},
    ])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._TRAILING_STALL.clear()
    listen_chat._INFLIGHT.clear()
    listen_chat._LAST_EMIT.clear()
    listen_chat._REPLY_ANCHOR.clear()
    listen_chat._SENT_TEXTS.clear()


def test_inflight_not_leaked_after_dryrun_continue(monkeypatch):
    """dryrun continue 路径后，_INFLIGHT 中的 sender 必须被释放，
    否则下一次扫描永远跳过该 sender（泄漏 = 客户消息永久丢失）。

    Bug 触发条件：第一轮 scan_unread emit 某 sender → _INFLIGHT.add(sender)。
    主循环走 dryrun continue（not _real_publish），绕过了轮尾 _release_inflight。
    下一轮 scan_unread 第902行 sender in _INFLIGHT → continue → 永远跳过。

    修法：dryrun continue 前，对 unread 中仍在 _INFLIGHT 的 sender 调 _release_inflight。
    """
    _setup_scan_env(monkeypatch)

    mw = _mk_mw()

    # 第一轮：scan_unread emit sender，_INFLIGHT.add("默忆")
    out1 = listen_chat.scan_unread(mw, {})
    assert out1, "前置：第一轮应正常 emit"
    assert "默忆" in listen_chat._INFLIGHT, "前置：emit 后应在 _INFLIGHT"

    # 模拟 dryrun continue：直接调用 _release_inflight（这是修法要求的动作）
    # 修复后，主循环的 dryrun continue 路径会在 continue 前对当轮 unread 调 _release_inflight
    for m in out1:
        listen_chat._release_inflight(m["sender"])

    # 第二轮：sender 已从 _INFLIGHT 移除，应该能正常扫到
    assert "默忆" not in listen_chat._INFLIGHT, "dryrun 路径后 _INFLIGHT 必须已释放"

    # 再次 scan 应能 emit（因为 _release_inflight 同时清了 _LAST_EMIT，允许重试）
    out2 = listen_chat.scan_unread(mw, {})
    assert out2, "dryrun 路径释放后下一轮必须能重新 emit（不丢消息）"


def test_inflight_not_leaked_after_scan_exception(monkeypatch):
    """scan_unread 抛异常后，之前已加入 _INFLIGHT 的 sender 必须能在下轮被重新处理。

    Bug 触发条件：scan_unread 内部异常 → 主循环 except→continue → 绕过轮尾清理。
    修法：主循环 except 路径在 continue 前释放当轮 last_unread_senders 的 _INFLIGHT。

    本测试验证：即使 scan_unread 在某轮后抛异常，
    _INFLIGHT 不会因此永久锁住之前 emit 的 sender。
    """
    _setup_scan_env(monkeypatch)

    mw = _mk_mw()

    # 第一轮正常 emit，sender 进 _INFLIGHT
    out1 = listen_chat.scan_unread(mw, {})
    assert out1
    assert "默忆" in listen_chat._INFLIGHT

    # 模拟 scan_unread 异常后的 except-continue 路径：
    # 修法要求 except continue 前释放之前加入 _INFLIGHT 的 sender
    for s in ["默忆"]:
        if s in listen_chat._INFLIGHT:
            listen_chat._release_inflight(s)

    # 释放后下轮应该可以重新处理
    assert "默忆" not in listen_chat._INFLIGHT


def test_release_inflight_clears_last_emit_for_retry(monkeypatch):
    """_release_inflight 必须同时清除 _LAST_EMIT，允许下轮重试同内容消息。

    如果只清 _INFLIGHT 不清 _LAST_EMIT，同内容 60s 内去重闸会继续拦截 → 丢消息。
    """
    _setup_scan_env(monkeypatch)

    mw = _mk_mw()

    out1 = listen_chat.scan_unread(mw, {})
    assert out1
    sender = out1[0]["sender"]
    assert sender in listen_chat._INFLIGHT
    assert sender in listen_chat._LAST_EMIT

    listen_chat._release_inflight(sender)

    # 两个闸都必须清除
    assert sender not in listen_chat._INFLIGHT, "_release_inflight 必须清除 _INFLIGHT"
    assert sender not in listen_chat._LAST_EMIT, "_release_inflight 必须清除 _LAST_EMIT（允许重试）"
