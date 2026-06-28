"""
回归测试：微信 mmui 无障碍树塌缩（UIA 读不到会话，sessions 永远 0）时，
listener 必须重启微信以让 mmui 在 screenreader 激活态重建 a11y 树。

根因（decision 4ab9b6f7，xian-rog 4.1.8.107 实地坐实 2026-06-29）：
  微信 mmui 无障碍树【仅在微信进程启动时 SPI_SETSCREENREADER 标志已置位】才构建。
  rog 微信被 autologon 外部启动（标志未设）→ mmui::MainWindow 的 UIA 子树永久塌缩到
  只剩 1 个 MMUIRenderSubWindowHW 空 Pane（descendants=1, ListItem=0），会话列表完全不暴露。
  事后 SPI 广播(SPIF_SENDCHANGE) / OFF→ON 翻转 / SetForeground / set_focus 全部无法让
  已运行进程重建树（逐一实测失败）。唯一根因修法 = 重启微信（标志已设态下 mmui 重建完整树，
  实测 descendants 1→71、ListItem 0→6、默忆[5条] 读出）。

修法：
  _is_uia_tree_collapsed(n) — mmui::MainWindow 整树 descendants ≤ 阈值 = 塌缩态（树未构建）。
  _should_restart_for_collapsed_tree(...) — 塌缩持续 + 冷却 + 上限 → 决定是否重启（防抖防无限重启）。
  _restart_wechat_for_uia() — 设标志 → taskkill /F Weixin.exe（微信吞 WM_CLOSE，优雅退无效）→
                              launch_weixin 重启（启动时标志已设 → mmui 构建完整树）。

本文件是永久 regression test，禁止删除。
"""
from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, patch

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


class TestIsUiaTreeCollapsed:
    """塌缩态判定：整树只剩 render pane（descendants≤2）= a11y 树未构建。"""

    def test_bare_render_pane_is_collapsed(self):
        # 实地观测：塌缩时 mmui::MainWindow.descendants() 总数 = 1（只有 MMUIRenderSubWindowHW）
        assert listen_chat._is_uia_tree_collapsed(1) is True
        assert listen_chat._is_uia_tree_collapsed(0) is True
        assert listen_chat._is_uia_tree_collapsed(2) is True

    def test_built_tree_not_collapsed(self):
        # 实地观测：树构建后 descendants=71（即便只有 6 个会话）；登录但 0 会话也有几十个控件
        assert listen_chat._is_uia_tree_collapsed(71) is False
        assert listen_chat._is_uia_tree_collapsed(3) is False
        assert listen_chat._is_uia_tree_collapsed(20) is False


class TestShouldRestartForCollapsedTree:
    """重启决策：冷却窗口 + 单进程重启上限（防抖、防无限重启 loop）。"""

    def test_blocked_within_cooldown(self):
        # 刚重启过（cooldown=600s），now 距上次只过 100s → 不再重启
        assert listen_chat._should_restart_for_collapsed_tree(
            now=1000.0, last_restart_at=900.0, cooldown_s=600.0,
            restarts_done=1, max_restarts=5) is False

    def test_allowed_after_cooldown(self):
        # 距上次重启已过 700s（> 600s 冷却），且未到上限 → 允许重启
        assert listen_chat._should_restart_for_collapsed_tree(
            now=2000.0, last_restart_at=1300.0, cooldown_s=600.0,
            restarts_done=1, max_restarts=5) is True

    def test_first_restart_allowed(self):
        # 从未重启过（last_restart_at=0）→ 允许
        assert listen_chat._should_restart_for_collapsed_tree(
            now=5000.0, last_restart_at=0.0, cooldown_s=600.0,
            restarts_done=0, max_restarts=5) is True

    def test_blocked_at_max_restarts(self):
        # 已达单进程重启上限 → 不再重启（避免无限重启 loop，留给人工/进程级介入）
        assert listen_chat._should_restart_for_collapsed_tree(
            now=99999.0, last_restart_at=0.0, cooldown_s=600.0,
            restarts_done=5, max_restarts=5) is False


class TestRestartWechatForUia:
    """重启动作：先置标志 → /F 杀微信 → launch_weixin 重启。"""

    def test_restart_sets_flag_kills_and_relaunches(self):
        import platform
        if platform.system() != "Windows":
            # 非 Windows：直接返回 False，不执行任何杀进程动作
            with patch.object(listen_chat, "_activate_uia") as mock_act:
                result = listen_chat._restart_wechat_for_uia()
            assert result is False
            mock_act.assert_not_called()
            return

        fake_launch = MagicMock(return_value=True)
        fake_fw = types.ModuleType("find_weixin")
        fake_fw.launch_weixin = fake_launch
        with patch.object(listen_chat, "_activate_uia") as mock_act, \
             patch.dict(sys.modules, {"find_weixin": fake_fw}), \
             patch("subprocess.run") as mock_run, \
             patch("time.sleep"):
            result = listen_chat._restart_wechat_for_uia()
        mock_act.assert_called_once()  # 杀之前必须先置标志（这样重启时微信能读到）
        assert any("taskkill" in str(c).lower() for c in mock_run.call_args_list), \
            "必须 taskkill 微信"
        fake_launch.assert_called_once()  # 必须 launch_weixin 重启
        assert result is True
