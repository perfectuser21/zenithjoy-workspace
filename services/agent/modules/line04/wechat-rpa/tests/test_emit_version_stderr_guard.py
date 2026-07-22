"""
回归 — pythonw 下 sys.stderr=None 时 _emit_version_to_stderr 不得崩（PrepPRD §5 致命坑）。

致命坑：listen_chat import 顶层会调 _emit_version_to_stderr() 往 stderr 写 pywinauto 版本。
pythonw.exe 的 sys.stderr 是 None → `.write` 抛 AttributeError → **import 直接崩、不报错**；
上层脚本读到的是上次 python.exe 跑留下的旧输出 → 误判"成功"假信号。

修复：写 stderr 前守卫 `if sys.stderr is None: return`，pythonw 下安全跳过不崩。

本测试永久留 CI：任何去掉守卫的回退都会让它变红。
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


def test_emit_version_no_crash_when_stderr_none(monkeypatch):
    """sys.stderr 为 None（pythonw）时调用不抛异常（守卫生效）。"""
    monkeypatch.setattr(listen_chat.sys, "stderr", None)
    # 不应抛 AttributeError；安静返回即可
    listen_chat._emit_version_to_stderr()


def test_emit_version_still_writes_when_stderr_available(monkeypatch):
    """sys.stderr 正常时仍照写版本信息（守卫不误伤正常路径）。"""
    import io

    buf = io.StringIO()
    monkeypatch.setattr(listen_chat.sys, "stderr", buf)
    listen_chat._emit_version_to_stderr()
    out = buf.getvalue()
    assert "pywinauto" in out, "stderr 可用时必须输出 pywinauto 可用性信息"
