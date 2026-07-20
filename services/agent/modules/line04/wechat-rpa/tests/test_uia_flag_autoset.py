"""
回归测试：listen_chat 每次轮询必须主动检测并补设 UIA 屏幕阅读器标志。

根因：SPI_SETSCREENREADER 标志在 Windows 会话锁定/进程重启后会被清除。
旧实现：只在启动时设一次 + found_window=False 时每 45 秒重设 → 标志丢失后
最多等 45 秒才恢复，用户看到后台回复停止响应。

修法 v1.0.36：
  _ensure_uia_flag() — 调用 SPI_GETSCREENREADER (0x0046) 检查标志，
  若标志已清 → 立即调 _activate_uia() 补设，不等 45 秒冷却。
  在轮询主循环每轮开头调用，确保标志常驻。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, call, patch

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


class TestUiaFlagAutoset:
    """_ensure_uia_flag() 在标志缺失时必须立即补设。"""

    def test_ensure_uia_flag_exists_when_flag_already_set(self):
        """SPI 标志已设 → _ensure_uia_flag() 返回 True，不重复调 _activate_uia。"""
        with patch.object(listen_chat, "_is_uia_flag_set", return_value=True), \
             patch.object(listen_chat, "_activate_uia") as mock_activate:
            result = listen_chat._ensure_uia_flag()
        assert result is True, "_ensure_uia_flag 标志已设时必须返回 True"
        mock_activate.assert_not_called()

    def test_ensure_uia_flag_resets_when_flag_cleared(self):
        """SPI 标志被清 → _ensure_uia_flag() 立即调 _activate_uia()，返回 False。"""
        with patch.object(listen_chat, "_is_uia_flag_set", return_value=False), \
             patch.object(listen_chat, "_activate_uia") as mock_activate:
            result = listen_chat._ensure_uia_flag()
        assert result is False, "_ensure_uia_flag 标志缺失时必须返回 False"
        mock_activate.assert_called_once()

    def test_is_uia_flag_set_returns_bool(self):
        """_is_uia_flag_set() 在 Windows 上读 SPI_GETSCREENREADER (0x0046)，返回 bool。"""
        import ctypes
        import platform
        if platform.system() != "Windows":
            # 非 Windows → 直接返回 True（无需 SPI）
            result = listen_chat._is_uia_flag_set()
            assert result is True
            return

        # Windows 上：函数调 SystemParametersInfoW(0x0046, ...)
        mock_user32 = MagicMock()
        mock_user32.SystemParametersInfoW.return_value = 1

        def _fake_spi(action, wparam, pvParam, fWinIni):
            if action == 0x0046:
                pvParam._obj.value = True  # 模拟标志已设
            return 1

        mock_user32.SystemParametersInfoW.side_effect = _fake_spi
        windll_orig = getattr(ctypes, "windll", None)
        try:
            ctypes.windll = MagicMock(user32=mock_user32, kernel32=MagicMock())
            result = listen_chat._is_uia_flag_set()
        finally:
            if windll_orig is not None:
                ctypes.windll = windll_orig
            elif hasattr(ctypes, "windll"):
                del ctypes.windll

        assert isinstance(result, bool)

    def test_version_is_1036(self):
        """manifest.json 版本号必须 >= 1.0.36（v1.0.36 引入 UIA 标志修复，后续 bump 不应使本测试变红）。"""
        import json
        candidates = [
            os.path.join(WECHAT_RPA_DIR, "..", "..", "build-modules", "line04", "manifest.json"),
            os.path.join(WECHAT_RPA_DIR, "..", "build-modules", "line04", "manifest.json"),
        ]
        manifest_path = None
        for c in candidates:
            p = os.path.normpath(c)
            if os.path.exists(p):
                manifest_path = p
                break
        assert manifest_path, "找不到 manifest.json"
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)
        version = manifest.get("version", "")
        parts = tuple(int(x) for x in version.split("."))
        assert parts >= (1, 0, 36), (
            f"manifest version 必须 >= 1.0.36（v1.0.36 引入UIA标志修复），实际 {version!r}"
        )
