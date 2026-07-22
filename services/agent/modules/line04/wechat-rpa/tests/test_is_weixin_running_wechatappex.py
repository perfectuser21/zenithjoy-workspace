"""
回归测试：is_weixin_running() 必须检测 WeChatAppEx.exe。

根因：WeChat 4.x 启动后 Weixin.exe（launcher）很快退出，常驻的是
WeChatAppEx.exe（真正的主进程）。旧实现只检查 Weixin.exe /
WeixinUpdate.exe → 微信已经在跑但 is_weixin_running() 返回 False
→ 上层逻辑认为微信没运行而错误处理。

修复：把 WeChatAppEx.exe 加入 tasklist 检测列表。
"""
from __future__ import annotations

import os
import sys
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import find_weixin  # noqa: E402


def _make_tasklist_result(processes: list) -> mock.MagicMock:
    result = mock.MagicMock()
    result.stdout = ("\n".join(processes) + "\n").encode("utf-8")
    return result


class TestIsWeixinRunningWeChatAppEx:
    """is_weixin_running() 必须能检测 WeChatAppEx.exe。"""

    def test_returns_true_when_only_wechatappex_running(self):
        """只有 WeChatAppEx.exe 在跑（Weixin.exe 已退出）→ 应返回 True。"""
        fake = _make_tasklist_result(["WeChatAppEx.exe", "svchost.exe"])
        with mock.patch("subprocess.run", return_value=fake):
            result = find_weixin.is_weixin_running()
        assert result is True, (
            "WeChatAppEx.exe 在运行但 is_weixin_running() 返回 False — "
            "未将 WeChatAppEx.exe 加入检测列表"
        )

    def test_returns_true_when_weixinexe_running(self):
        """旧路径：Weixin.exe 在跑 → 仍返回 True（兼容性保持）。"""
        fake = _make_tasklist_result(["Weixin.exe", "explorer.exe"])
        with mock.patch("subprocess.run", return_value=fake):
            assert find_weixin.is_weixin_running() is True

    def test_returns_true_when_weixinupdate_running(self):
        """WeixinUpdate.exe 在跑 → 仍返回 True（兼容性保持）。"""
        fake = _make_tasklist_result(["WeixinUpdate.exe"])
        with mock.patch("subprocess.run", return_value=fake):
            assert find_weixin.is_weixin_running() is True

    def test_returns_false_when_neither_running(self):
        """三个进程都不在 → False。"""
        fake = _make_tasklist_result(["chrome.exe", "notepad.exe"])
        with mock.patch("subprocess.run", return_value=fake):
            assert find_weixin.is_weixin_running() is False

    def test_returns_false_on_subprocess_exception(self):
        """tasklist 报错 → 优雅降级返回 False，不抛异常。"""
        with mock.patch("subprocess.run", side_effect=OSError("tasklist not found")):
            assert find_weixin.is_weixin_running() is False
