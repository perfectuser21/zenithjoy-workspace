# -*- coding: utf-8 -*-
"""
Bug 7 (记忆污染) regression — 1.0.107 staging 重测发现：

_save_reply_anchor() 直接把内存中的 _REPLY_ANCHOR（新进程启动时为空）dump
到磁盘，覆盖掉另一个进程（监听进程）积累的锚点数据。
_record_sent_text 已在 v1.0.98 改为读盘→合并→写盘，但 _save_reply_anchor
还用旧的"覆写"模式，造成跨进程锚点互清。

修法：_save_reply_anchor 也改为读盘→合并→写盘，与 _record_sent_text 保持
同样的跨进程 union 语义。
"""
import json
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def _write_anchor_file(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def test_save_reply_anchor_merges_with_disk():
    """Bug 7 核心断言：_save_reply_anchor 必须先读盘再合并，不得覆写。

    场景：磁盘有进程A的锚点 {客户甲: "上次回复甲"}，进程B内存有 {客户乙: "上次回复乙"}。
    进程B调 _save_reply_anchor → 必须保留客户甲的锚点，不得覆写。
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        anchor_path = os.path.join(tmpdir, "zj-reply-anchor.json")

        # 磁盘已有进程A的锚点
        _write_anchor_file(anchor_path, {"客户甲": "上次回复甲"})

        # 进程B（内存为空，只有自己的客户）
        original_file = listen_chat._REPLY_ANCHOR_FILE
        original_anchor = dict(listen_chat._REPLY_ANCHOR)
        try:
            listen_chat._REPLY_ANCHOR_FILE = anchor_path
            listen_chat._REPLY_ANCHOR.clear()
            listen_chat._REPLY_ANCHOR["客户乙"] = "上次回复乙"

            listen_chat._save_reply_anchor()

            with open(anchor_path, "r", encoding="utf-8") as f:
                result = json.load(f)

            assert "客户甲" in result, (
                "Bug 7：_save_reply_anchor 覆写磁盘，丢失了进程A的客户甲锚点"
            )
            assert result["客户甲"] == "上次回复甲"
            assert "客户乙" in result
            assert result["客户乙"] == "上次回复乙"
        finally:
            listen_chat._REPLY_ANCHOR_FILE = original_file
            listen_chat._REPLY_ANCHOR.clear()
            listen_chat._REPLY_ANCHOR.update(original_anchor)


def test_save_reply_anchor_in_memory_wins_on_conflict():
    """同一 sender 在内存和磁盘都有记录时，内存（更新的）优先。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        anchor_path = os.path.join(tmpdir, "zj-reply-anchor.json")

        # 磁盘有旧锚点
        _write_anchor_file(anchor_path, {"客户甲": "旧锚点"})

        original_file = listen_chat._REPLY_ANCHOR_FILE
        original_anchor = dict(listen_chat._REPLY_ANCHOR)
        try:
            listen_chat._REPLY_ANCHOR_FILE = anchor_path
            listen_chat._REPLY_ANCHOR.clear()
            listen_chat._REPLY_ANCHOR["客户甲"] = "新锚点"

            listen_chat._save_reply_anchor()

            with open(anchor_path, "r", encoding="utf-8") as f:
                result = json.load(f)

            assert result["客户甲"] == "新锚点", "内存（新）应覆盖磁盘（旧）同一 sender 的锚点"
        finally:
            listen_chat._REPLY_ANCHOR_FILE = original_file
            listen_chat._REPLY_ANCHOR.clear()
            listen_chat._REPLY_ANCHOR.update(original_anchor)
