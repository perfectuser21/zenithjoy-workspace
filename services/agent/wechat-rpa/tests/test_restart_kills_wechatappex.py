"""
回归测试：_restart_wechat_for_uia() 必须同时杀 WeChatAppEx.exe。

根因（Issue 05630ae5）：
  微信 4.x 中 Weixin.exe 是 launcher，真正常驻进程是 WeChatAppEx.exe。
  旧实现只 taskkill /F /IM Weixin.exe，WeChatAppEx.exe 继续存活。
  每次自愈 = 杀空壳 + 叠加新 Weixin.exe，从未真正修复死区。
  _WECHAT_RESTART_MAX=5 与客户机实测残留 5 个 Weixin.exe 精确对应。

修法：同一次 restart 调用内增加 taskkill /F /IM WeChatAppEx.exe /T。

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


def _make_fake_find_weixin():
    fw = types.ModuleType("find_weixin")
    fw.launch_weixin = MagicMock(return_value=True)
    return fw


class TestRestartKillsWeChatAppEx:
    """_restart_wechat_for_uia() 必须在同一次调用内杀掉 WeChatAppEx.exe。

    根因：旧代码只 taskkill Weixin.exe，WeChatAppEx.exe（真正常驻进程）存活
    → 微信进程残留叠加 → 死区永不修复。
    """

    def test_wechatappex_is_killed(self):
        """WeChatAppEx.exe 必须出现在至少一次 taskkill 调用中。

        只有 Weixin.exe 被杀 → 断言失败（这是 regression 保护的核心）。
        """
        fake_fw = _make_fake_find_weixin()
        with patch.object(listen_chat, "_activate_uia"), \
             patch("platform.system", return_value="Windows"), \
             patch.dict(sys.modules, {"find_weixin": fake_fw}), \
             patch("subprocess.run") as mock_run, \
             patch("time.sleep"):
            listen_chat._restart_wechat_for_uia()

        killed_targets = []
        for c in mock_run.call_args_list:
            args = c.args[0] if c.args else []
            killed_targets.extend(str(a) for a in args)

        assert any("WeChatAppEx.exe" in t for t in killed_targets), (
            "_restart_wechat_for_uia() 未杀 WeChatAppEx.exe——"
            "旧实现只杀 Weixin.exe（launcher 空壳），WeChatAppEx.exe（真正常驻进程）"
            "继续存活，叠加新进程，死区永不修复。"
            f"\n实际 taskkill 调用参数：{killed_targets}"
        )

    def test_weixin_exe_still_killed(self):
        """向后兼容：Weixin.exe 也必须被杀（launcher 需要清掉）。"""
        fake_fw = _make_fake_find_weixin()
        with patch.object(listen_chat, "_activate_uia"), \
             patch("platform.system", return_value="Windows"), \
             patch.dict(sys.modules, {"find_weixin": fake_fw}), \
             patch("subprocess.run") as mock_run, \
             patch("time.sleep"):
            listen_chat._restart_wechat_for_uia()

        killed_targets = []
        for c in mock_run.call_args_list:
            args = c.args[0] if c.args else []
            killed_targets.extend(str(a) for a in args)

        assert any("Weixin.exe" in t for t in killed_targets), (
            "_restart_wechat_for_uia() 未杀 Weixin.exe——向后兼容性断裂。"
            f"\n实际 taskkill 调用参数：{killed_targets}"
        )

    def test_launch_weixin_called_after_kill(self):
        """进程全部杀完后必须重启微信。"""
        fake_fw = _make_fake_find_weixin()
        with patch.object(listen_chat, "_activate_uia"), \
             patch("platform.system", return_value="Windows"), \
             patch.dict(sys.modules, {"find_weixin": fake_fw}), \
             patch("subprocess.run"), \
             patch("time.sleep"):
            result = listen_chat._restart_wechat_for_uia()

        fake_fw.launch_weixin.assert_called_once()
        assert result is True

    def test_returns_false_on_non_windows(self):
        """非 Windows 平台直接返回 False，不执行任何杀进程操作。"""
        with patch("platform.system", return_value="Linux"), \
             patch("subprocess.run") as mock_run:
            result = listen_chat._restart_wechat_for_uia()
        assert result is False
        mock_run.assert_not_called()
