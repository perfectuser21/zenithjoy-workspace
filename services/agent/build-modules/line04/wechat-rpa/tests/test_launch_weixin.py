"""
test_launch_weixin.py — find_weixin.launch_weixin / is_weixin_running 纯函数单测。

跨平台：顶层不 import win32 / ctypes / subprocess 真调用，全 mock。
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# 保证 find_weixin 可在 macOS/Linux 上 import（pywinauto 软依赖通过函数体内 import 绕过）
sys.path.insert(0, __file__.replace("/tests/test_launch_weixin.py", ""))

from find_weixin import launch_weixin, is_weixin_running  # noqa: E402


class TestIsWeixinRunning:
    def test_returns_true_when_weixin_in_tasklist(self):
        mock_result = MagicMock()
        mock_result.stdout = b"Weixin.exe                   1234 Console"
        with patch("subprocess.run", return_value=mock_result):
            assert is_weixin_running() is True

    def test_returns_true_when_weixinupdate_in_tasklist(self):
        mock_result = MagicMock()
        mock_result.stdout = b"WeixinUpdate.exe             5678 Console"
        with patch("subprocess.run", return_value=mock_result):
            assert is_weixin_running() is True

    def test_returns_false_when_neither_in_tasklist(self):
        mock_result = MagicMock()
        mock_result.stdout = b"System Idle Process              0 Services"
        with patch("subprocess.run", return_value=mock_result):
            assert is_weixin_running() is False

    def test_returns_false_on_exception(self):
        with patch("subprocess.run", side_effect=FileNotFoundError("tasklist not found")):
            assert is_weixin_running() is False


class TestLaunchWeixin:
    def test_returns_false_when_exe_not_found(self, tmp_path):
        nonexistent = str(tmp_path / "nonexistent" / "Weixin.exe")
        assert launch_weixin(exe_path=nonexistent) is False

    def test_returns_true_when_popen_succeeds(self, tmp_path):
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        with patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            result = launch_weixin(exe_path=str(fake_exe))
        assert result is True
        mock_popen.assert_called_once()

    def test_returns_false_when_popen_raises(self, tmp_path):
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        with patch("subprocess.Popen", side_effect=PermissionError("access denied")):
            assert launch_weixin(exe_path=str(fake_exe)) is False

    def test_uses_default_path_when_no_exe_path_given(self):
        """不传 exe_path 时使用 WEIXIN_EXE_DEFAULT（mock isfile 返回 False → launch_weixin 返回 False）。"""
        with patch("find_weixin.os.path.isfile", return_value=False):
            result = launch_weixin()
        assert result is False
