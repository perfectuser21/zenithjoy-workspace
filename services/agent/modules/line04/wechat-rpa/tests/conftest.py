# -*- coding: utf-8 -*-
"""测试隔离（2026-07-03 事故后强制）：pytest 绝不允许碰真实持久化文件。

事故：CI job2 在 xian-rog（生产客服机）上跑 pytest，测试里调 _record_sent_text /
_commit_reply_success / _save_replied 把 C:\\Users\\Public\\zj-*.json 覆盖成测试
垃圾（"回给A"/"测试消息"…）→ 监听进程重启加载后判向历史全废 → 自回自话 +
锚点切错丢消息。

隔离用 ZJ_STATE_DIR 环境变量（不是 monkeypatch）：conftest 模块级代码在任何
test 模块导入之前执行，且部分测试会 `del sys.modules["listen_chat"]` 重导入
——monkeypatch 只打得到单个模块对象，env 对所有导入副本都生效。
"""
import os
import sys
import tempfile

import pytest

# 必须在任何 listen_chat 导入之前生效（conftest 在 collection 最先导入）
os.environ.setdefault(
    "ZJ_STATE_DIR", tempfile.mkdtemp(prefix="zj-test-state-"))

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)


_MUTABLE_STATE = ("_SENT_TEXTS", "_REPLY_ANCHOR", "_INFLIGHT", "_LAST_EMIT",
                  "_TRAILING_STALL", "_ANCHOR_STALL", "_KNOWN_GROUPS")


def _clear_state(mod) -> None:
    for name in _MUTABLE_STATE:
        obj = getattr(mod, name, None)
        if obj is not None:
            try:
                obj.clear()
            except Exception:
                pass


@pytest.fixture(autouse=True)
def _isolate_memory_state(request):
    """内存态隔离：测试之间绝不共享可变全局。

    关键（2026-07-03 教训）：16 个历史测试文件在导入时 `del sys.modules`
    重导入 listen_chat → 同一进程里存在**多份模块副本**，只清 sys.modules
    里的那份会让用旧副本的测试文件状态跨测试残留（一次 19 红）。
    必须清"当前测试文件实际绑定的那份"（request.module.listen_chat）
    ＋ sys.modules 里的那份，双保险。
    """
    import listen_chat as _current
    mods = {id(_current): _current}
    _bound = getattr(request.module, "listen_chat", None)
    if _bound is not None:
        mods[id(_bound)] = _bound
    for m in mods.values():
        _clear_state(m)
    yield
    for m in mods.values():
        _clear_state(m)
