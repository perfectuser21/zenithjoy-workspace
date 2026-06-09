"""
回归测试 — `_set_clipboard_text` 的 Win32 ctypes 调用必须声明 restype/argtypes，
防 64 位 HANDLE 被 ctypes 默认 c_int 返回值截断。

【背景】2026-06-06 xian-rog 微信真机报错：
    _set_clipboard_text: exception: access violation writing 0x0000000000000000
    _uia_send: Enter未清空(117字)，回退SW_RESTORE+Invoke
    reply_in_chat FAILED sender=糊糊大老婆

  根因：v1.1.104 引入的 `_set_clipboard_text` 里 GlobalAlloc/GlobalLock/GlobalUnlock/
  SetClipboardData 这几个 kernel32/user32 调用没设 `.restype`/`.argtypes`。
  ctypes 默认把返回值当 32 位 c_int 处理，amd64 Windows 上 64 位 HANDLE 高位被截断：
    GlobalAlloc 返回的 HANDLE 被截 → GlobalLock(坏handle) 返回 NULL(0)
    → memmove(0, ...) → access violation writing 0x0000000000000000。

  修法：每个调用前补 `.restype = c_void_p`（HANDLE/指针）+ `.argtypes`。

【两条防线】
  1) test_set_clipboard_text_no_handle_truncation — 行为防线：
     monkeypatch `ctypes.windll`/`ctypes.memmove` 用「会模拟 64 位截断」的假实现，
     直接调 `_set_clipboard_text`。坏代码（无 restype）会把高位 HANDLE 截没 →
     GlobalLock 拿到坏 handle 返回 NULL → memmove(NULL) 抛 access violation → 返回 False。
     修好后（restype=c_void_p）HANDLE 完整 → 返回 True。
  2) test_set_clipboard_text_declares_handle_types — 源码防线：
     断言函数体里 4 个调用都声明了 restype/argtypes（覆盖行为防线管不到的
     GlobalUnlock / SetClipboardData，防将来回退漏声明）。

【CI 安全】纯 monkeypatch，不碰真 ctypes.windll，macOS/Linux/Windows 跑法一致。
"""
from __future__ import annotations

import ctypes
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")

# 故意带高 32 位的 64 位值：一旦被当 c_int 截断，高位丢失 → 与原值不等。
_REAL_HANDLE = 0x0000000123456789  # GlobalAlloc 返回的 HANDLE
_REAL_PTR = 0x00000004ABCDEF00     # GlobalLock 返回的锁定指针


class _FakeFunc:
    """模拟 ctypes 外部函数：按 restype 决定是否截断返回值（复刻真 ctypes 行为）。"""

    def __init__(self, impl):
        self._impl = impl
        # ctypes 未显式设 restype 时默认按 c_int（32 位有符号）处理返回值 —— 这正是 bug 源头。
        self.restype = ctypes.c_int
        self.argtypes = None

    def __call__(self, *args):
        raw = self._impl(*args)
        if not isinstance(raw, int):
            return raw
        if self.restype in (ctypes.c_void_p, ctypes.c_size_t, ctypes.c_ulonglong):
            return raw  # 指针/HANDLE 类型：64 位完整保留（修复后）
        if self.restype is ctypes.c_bool:
            return bool(raw)
        return raw & 0xFFFFFFFF  # 默认 c_int：模拟 32 位截断（bug）


class _FakeKernel32:
    def __init__(self):
        self.GlobalAlloc = _FakeFunc(lambda flags, size: _REAL_HANDLE)
        self.GlobalLock = _FakeFunc(self._global_lock)
        self.GlobalUnlock = _FakeFunc(lambda h: 1)

    @staticmethod
    def _global_lock(hMem):
        # 真 Win32：传入坏 HANDLE → 返回 NULL(0)。HANDLE 被截过 → 必然不等 → NULL。
        if hMem != _REAL_HANDLE:
            return 0
        return _REAL_PTR


class _FakeUser32:
    def __init__(self):
        self.OpenClipboard = _FakeFunc(lambda h: 1)
        self.EmptyClipboard = _FakeFunc(lambda: 1)
        self.CloseClipboard = _FakeFunc(lambda: 1)
        self.SetClipboardData = _FakeFunc(lambda fmt, h: h)


class _FakeWinDLL:
    def __init__(self):
        self.kernel32 = _FakeKernel32()
        self.user32 = _FakeUser32()


def _fake_memmove(dst, src, n):
    """模拟 amd64 memmove：dst 不是合法锁定指针（被截断/NULL）→ access violation。"""
    dst_int = int(dst) if dst else 0
    if dst_int != _REAL_PTR:
        raise OSError(f"access violation writing 0x{dst_int:016x}")
    return dst


def test_set_clipboard_text_no_handle_truncation(monkeypatch):
    """坏代码（无 restype）下 64 位 HANDLE 被截 → 返回 False；修好后返回 True。"""
    import listen_chat  # noqa: PLC0415 — 函数体内 import，避免顶层副作用

    monkeypatch.setattr(ctypes, "windll", _FakeWinDLL(), raising=False)
    monkeypatch.setattr(ctypes, "memmove", _fake_memmove, raising=False)

    ok = listen_chat._set_clipboard_text("你好，糊糊大老婆")

    assert ok is True, (
        "64 位 HANDLE 被 ctypes 默认 c_int 截断 → GlobalLock 拿到坏 handle 返回 NULL "
        "→ memmove(NULL) access violation。必须给 GlobalAlloc/GlobalLock 设 restype=c_void_p。"
    )


def test_set_clipboard_text_declares_handle_types():
    """源码断言：4 个 Win32 调用都显式声明 restype/argtypes（防回退漏声明）。"""
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    func_match = re.search(
        r"def _set_clipboard_text\(.*?\) -> bool:.*?(?=\ndef |\Z)", src, re.DOTALL
    )
    assert func_match, "找不到 _set_clipboard_text 函数体"
    body = func_match.group(0)

    # HANDLE/指针返回值必须声明为 c_void_p，否则 64 位被截。
    for fn in ("GlobalAlloc", "GlobalLock"):
        assert re.search(rf"{fn}\.restype\s*=\s*\w*\.?c_void_p", body), (
            f"{fn}.restype 必须显式设为 c_void_p（HANDLE 64 位防截断）"
        )
    # GlobalUnlock 返回 BOOL；SetClipboardData 返回 HANDLE。两者也必须声明 restype。
    assert re.search(r"GlobalUnlock\.restype\s*=", body), "GlobalUnlock.restype 必须显式声明"
    assert re.search(r"SetClipboardData\.restype\s*=\s*\w*\.?c_void_p", body), (
        "SetClipboardData.restype 必须设为 c_void_p（HANDLE 64 位防截断）"
    )
    # argtypes 也要补全，避免 32 位参数截断。
    for fn in ("GlobalAlloc", "GlobalLock", "GlobalUnlock", "SetClipboardData"):
        assert re.search(rf"{fn}\.argtypes\s*=", body), f"{fn}.argtypes 必须显式声明"
