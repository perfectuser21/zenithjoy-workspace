"""
回归测试：送达读回验证必须【轮询】，不能单次读空就误判未送达。

根因（xian-rog E2E 实地，2026-06-29）：AI 回复真发到默忆对话（聊天气泡可读），但
reply_in_chat 单次 `_read_session_preview` 在刚 `_open_chat` 切完会话那一刻返回空（preview=''）
——微信会话列表预览异步更新 + UIA 读偶发空 → `_delivery_confirmed` 一次没命中就 return False
→ 误判 send_failed/receipt=send_failed（假阴性）。消息真送达了，listener 却以为失败。

修法：`_confirm_delivery(read_preview_fn, sent_text, polls, sleep_fn)` 轮询读回，
任一轮 `_delivery_confirmed` 命中即 True；polls 轮都没命中才 False。既消假阴性，
又不引入假阳性（仍要求发送原文真出现在读回里）。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _stub_heavy_deps():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            sys.modules[name] = mod
    for name in ["requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod


_stub_heavy_deps()

import listen_chat  # noqa: E402


class TestConfirmDeliveryPolling:
    def test_transient_empty_then_delivered(self):
        """前 2 轮读回空(异步预览没更新),第 3 轮读到真预览 → 仍判 DELIVERED(轮询救假阴性)。"""
        reads = ["", "", "默忆\n在的，说\n12:45"]
        it = iter(reads)
        sleeps = []
        ok, preview = listen_chat._confirm_delivery(
            read_preview_fn=lambda: next(it),
            sent_text="在的，说",
            polls=5,
            sleep_fn=lambda: sleeps.append(1),
        )
        assert ok is True
        assert "在的，说" in preview
        assert len(sleeps) == 2  # 第3轮命中前 sleep 了 2 次

    def test_always_empty_is_not_delivered(self):
        """读回一直空 → 判未送达(False),不假阳性。"""
        ok, preview = listen_chat._confirm_delivery(
            read_preview_fn=lambda: "",
            sent_text="在的",
            polls=4,
            sleep_fn=lambda: None,
        )
        assert ok is False

    def test_hit_first_poll_no_extra_sleep(self):
        """第 1 轮就命中 → 立即 True，不多 sleep。"""
        sleeps = []
        ok, _ = listen_chat._confirm_delivery(
            read_preview_fn=lambda: "默忆\n在的，说\n12:45",
            sent_text="在的，说",
            polls=5,
            sleep_fn=lambda: sleeps.append(1),
        )
        assert ok is True
        assert len(sleeps) == 0

    def test_never_reads_more_than_polls(self):
        """最多读 polls 次(不超额轮询)。"""
        calls = {"n": 0}

        def _read():
            calls["n"] += 1
            return ""  # 永不命中

        ok, _ = listen_chat._confirm_delivery(
            read_preview_fn=_read, sent_text="x", polls=3, sleep_fn=lambda: None,
        )
        assert ok is False
        assert calls["n"] == 3

    def test_constants_exist(self):
        """轮询参数常量存在且合理（≥2 轮，sleep>0）。"""
        assert listen_chat._DELIVERY_READBACK_POLLS >= 2
        assert listen_chat._DELIVERY_READBACK_POLL_SLEEP > 0
