# -*- coding: utf-8 -*-
"""selfcheck_bubbles._weixin_process_running 在中文 Windows（tasklist 输出 GBK）下不得误报"没跑"。

背景（2026-08-16，Brain task 9f8dc2f4）：nightly-real-machine-staging 的 wechat-bubble job 设了
PYTHONUTF8=1；`_weixin_process_running` 用 `subprocess.run(..., text=True)` 跑 tasklist，
Python 按 utf-8 解 tasklist 的 GBK 中文表头（"映像名称 PID 会话名..."）→ reader 线程
UnicodeDecodeError → stdout 为 None → 函数返回 False → 气泡门把"微信在跑但锁屏/登录窗"
误报成 [NO_PROCESS] Weixin.exe 未运行（rog 实测 Weixin.exe PID 3828 在跑）。

本测试用一个"像真 subprocess 一样"的假 run：
  - 调用方传 text=True → 模拟 reader 线程崩溃后的结果：stdout=None
  - 调用方不传 text（拿 bytes）→ 返回带 GBK 表头 + Weixin.exe 行的原始字节
修前（text=True 路径）必红；修后（bytes 路径 + 容错解码）必绿。
"""
import os
import subprocess
import sys

_TOOLS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
if _TOOLS not in sys.path:
    sys.path.insert(0, _TOOLS)

import selfcheck_bubbles  # noqa: E402

# 真 tasklist（中文 Windows，GBK）在微信在跑时的输出：中文表头 + 进程行
_GBK_HEADER = "映像名称                       PID 会话名              会话#       内存使用\r\n".encode("gbk")
_GBK_RULE = b"========================= ======== ================ =========== ============\r\n"
_PROC_LINE = b"Weixin.exe                    3828 Console                    1     64,788 K\r\n"
_TASKLIST_RUNNING_GBK = _GBK_HEADER + _GBK_RULE + _PROC_LINE

# 微信没跑时 tasklist 的输出（GBK 提示语，不含 Weixin.exe）
_TASKLIST_NOT_RUNNING_GBK = "信息: 没有运行的任务匹配指定的标准。\r\n".encode("gbk")


def _fake_run_factory(stdout_bytes):
    """返回一个模拟 subprocess.run 的函数：text=True → 模拟解码崩溃(stdout=None)；否则给 bytes。"""
    def _fake_run(args, **kwargs):
        assert args[0] == "tasklist", args
        if kwargs.get("text") or kwargs.get("universal_newlines") or kwargs.get("encoding") == "utf-8":
            # PYTHONUTF8=1 + text=True 下真实发生的事：reader 线程 UnicodeDecodeError，stdout 拿不到
            return subprocess.CompletedProcess(args, 0, stdout=None, stderr=None)
        return subprocess.CompletedProcess(args, 0, stdout=stdout_bytes, stderr=b"")
    return _fake_run


def test_process_running_detected_under_gbk_output(monkeypatch):
    """微信在跑 + tasklist 出 GBK 表头 → 必须判 True（修前因 text=True 解码崩 → False）。"""
    monkeypatch.setattr(subprocess, "run", _fake_run_factory(_TASKLIST_RUNNING_GBK))
    assert selfcheck_bubbles._weixin_process_running() is True


def test_process_not_running_under_gbk_output(monkeypatch):
    """微信没跑 + tasklist 出 GBK 提示语 → 判 False（不能因为解码容错就把没跑当在跑）。"""
    monkeypatch.setattr(subprocess, "run", _fake_run_factory(_TASKLIST_NOT_RUNNING_GBK))
    assert selfcheck_bubbles._weixin_process_running() is False


def test_probe_failure_is_conservative(monkeypatch):
    """tasklist 本身跑不起来（异常）→ 保守当作在跑（走 UIA_DEAD 分支，宁报死区不误报没跑）——既有语义不变。"""
    def _boom(*_a, **_k):
        raise OSError("tasklist not found")
    monkeypatch.setattr(subprocess, "run", _boom)
    assert selfcheck_bubbles._weixin_process_running() is True
