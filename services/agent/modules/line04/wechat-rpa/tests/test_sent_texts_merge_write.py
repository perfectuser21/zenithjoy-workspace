# -*- coding: utf-8 -*-
"""_record_sent_text 合并写守卫（2026-07-03 08:49 事故）：

job3 真机 gate（selfcheck_bubbles）是独立进程，模块导入后 _SENT_TEXTS 为空；
它发 marker 时 _record_sent_text 把**空内存列表+1条**整个 dump 到磁盘 →
覆盖掉监听进程积累的全部已发送历史 → 监听重启加载后旧回复判向失灵 →
机器人 08:18 的旧回复在 08:49 被当客户消息混进 AI 上下文。

修法：写盘用"读盘→合并→写盘"（磁盘是跨进程 union），内存列表只服务本进程。
本文件是该事故的永久 regression test。
"""
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_record_sent_text_merges_with_disk(tmp_path, monkeypatch):
    """新进程（内存空）记一条 → 磁盘上已有的历史必须保留，不能被覆盖。"""
    f = tmp_path / "zj-sent-texts.json"
    f.write_text(json.dumps(["历史回复A", "历史回复B"], ensure_ascii=False),
                 encoding="utf-8")
    monkeypatch.setattr(listen_chat, "_SENT_TEXTS_FILE", str(f))
    listen_chat._SENT_TEXTS.clear()  # 模拟 gate/新进程：内存为空

    listen_chat._record_sent_text("[bubble-gate] 12345")

    disk = json.loads(f.read_text(encoding="utf-8"))
    assert "历史回复A" in disk and "历史回复B" in disk, (
        f"磁盘历史被覆盖丢失（2026-07-03 08:49 事故根因），实际 {disk!r}"
    )
    assert "[bubble-gate] 12345" in disk


def test_record_sent_text_dedupes_and_caps(tmp_path, monkeypatch):
    f = tmp_path / "zj-sent-texts.json"
    monkeypatch.setattr(listen_chat, "_SENT_TEXTS_FILE", str(f))
    listen_chat._SENT_TEXTS.clear()
    listen_chat._record_sent_text("同一条")
    listen_chat._record_sent_text("同一条")
    disk = json.loads(f.read_text(encoding="utf-8"))
    assert disk.count("同一条") == 1, "连续重复文本不重复入盘"
    assert len(disk) <= listen_chat._SENT_TEXTS_CAP
