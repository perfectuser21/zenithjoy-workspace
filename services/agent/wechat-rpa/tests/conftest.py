# -*- coding: utf-8 -*-
"""测试隔离（2026-07-03 事故后强制）：pytest 绝不允许碰真实持久化文件。

事故：CI job2 在 xian-rog（生产客服机）上跑 pytest，测试里调 _record_sent_text /
_commit_reply_success / _save_replied 把 C:\\Users\\Public\\zj-*.json 覆盖成测试
垃圾（"回给A"/"测试消息"…）→ 监听进程重启加载后判向历史全废 → 自回自话 +
锚点切错丢消息。本 conftest 把三个持久化路径 autouse 重定向到 tmp。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)


@pytest.fixture(autouse=True)
def _isolate_persistence(tmp_path, monkeypatch):
    import listen_chat
    monkeypatch.setattr(listen_chat, "_SENT_TEXTS_FILE",
                        str(tmp_path / "zj-sent-texts.json"))
    monkeypatch.setattr(listen_chat, "_REPLY_ANCHOR_FILE",
                        str(tmp_path / "zj-reply-anchor.json"))
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE",
                        str(tmp_path / "zj-replied.json"))
    # 内存态同样隔离：测试之间/测试与真机之间绝不共享
    listen_chat._SENT_TEXTS.clear()
    listen_chat._REPLY_ANCHOR.clear()
    yield
    listen_chat._SENT_TEXTS.clear()
    listen_chat._REPLY_ANCHOR.clear()
