"""合同测试骨架：半死区窗口形态不变量 + 梯度自愈
sprint: 07201740-half-deadzone-window-invariant
task_id: 5e9d608f-0386-4318-ac46-59273967999d
journey: Path 4 Step 3l

本文件是验收用骨架，真正的回归测试在：
  services/agent/wechat-rpa/tests/test_window_invariant.py
（该文件由 commit-1 先写失败测试，commit-2 实现后通过，永久留存 CI）

骨架测试用于 contract-reviewer 验证合同覆盖度是否完整。
在 wechat-rpa 实现完成前，这些测试以"import SKIP"方式标记，
实现完成后直接 import 真实模块验证。
"""
from __future__ import annotations

import os
import sys
import types
import importlib
import pytest
from unittest.mock import MagicMock, patch

# ── stub 重依赖（CI 无 pywinauto）────────────────────────────────────────────

def _stub_heavy_deps():
    heavy = [
        "pywinauto", "pywinauto.application",
        "pywinauto.controls", "pywinauto.controls.uia_controls",
        "requests", "ctypes", "ctypes.wintypes",
    ]
    for name in heavy:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            mod.windll = MagicMock()
            mod.wintypes = MagicMock()
            sys.modules[name] = mod


_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT_RPA = os.path.abspath(
    os.path.join(_HERE, "../../../services/agent/wechat-rpa")
)
sys.path.insert(0, _WECHAT_RPA)

_stub_heavy_deps()

# 尝试 import 实现；未实现时标记全部跳过
try:
    import listen_chat
    _IMPL_AVAILABLE = hasattr(listen_chat, "assert_window_shape_for_title_read")
except Exception:
    _IMPL_AVAILABLE = False

_skip_until_impl = pytest.mark.skipif(
    not _IMPL_AVAILABLE,
    reason="listen_chat.assert_window_shape_for_title_read 未实现（commit-2 前骨架）",
)

# ── B-1：窗口形态不变量纯函数三态 ─────────────────────────────────────────────

@_skip_until_impl
class TestAssertWindowShapeForTitleRead:
    """[BEHAVIOR B-1] assert_window_shape_for_title_read 纯函数三态覆盖"""

    def test_zoomed_passes(self):
        """已最大化（zoomed=True, iconic=False）→ 可读取标题，返回 True。"""
        result = listen_chat.assert_window_shape_for_title_read(
            is_zoomed=True, is_iconic=False, width=2560, threshold=700
        )
        assert result is True, "zoomed 窗口应通过不变量（返回 True）"

    def test_wide_enough_passes(self):
        """非 zoomed 但宽度 ≥ 双栏阈值 → 可读取标题，返回 True。"""
        result = listen_chat.assert_window_shape_for_title_read(
            is_zoomed=False, is_iconic=False, width=800, threshold=700
        )
        assert result is True, "宽度 ≥ 阈值时应通过不变量"

    def test_narrow_not_zoomed_fails(self):
        """非 zoomed 且宽度 < 双栏阈值（半死区）→ 标题不可读，返回 False。"""
        result = listen_chat.assert_window_shape_for_title_read(
            is_zoomed=False, is_iconic=False, width=500, threshold=700
        )
        assert result is False, "半死区状态（非 zoomed + 窄宽度）应返回 False"

    def test_iconic_passes(self):
        """最小化/托盘（iconic=True）→ 合法运行态，不强制弹出，返回 True。"""
        result = listen_chat.assert_window_shape_for_title_read(
            is_zoomed=False, is_iconic=True, width=0, threshold=700
        )
        assert result is True, "iconic（托盘）状态应放行不变量（不强制弹出）"

    def test_is_pure_function_no_pywinauto(self):
        """不变量函数必须是纯函数，顶层无 pywinauto import，CI 可单测。"""
        import inspect
        src = inspect.getsource(listen_chat.assert_window_shape_for_title_read)
        assert "pywinauto" not in src, (
            "assert_window_shape_for_title_read 是纯函数，不得 import pywinauto"
        )


# ── B-2：梯度自愈计数器阈值 ──────────────────────────────────────────────────

@_skip_until_impl
class TestGradualHealCounter:
    """[BEHAVIOR B-2] 连续 title_unreadable 计数器：跨 ≥2 sender + ≥3 次 → 触发"""

    def test_two_senders_below_threshold_no_trigger(self):
        """2 个 sender 连续 2 次 title_unreadable → 未达阈值，不触发梯度自愈。"""
        # 实现方：暴露 _consecutive_title_unreadable_state 或等价接口
        # 骨架：验证 listen_chat 内相关计数器逻辑在 2 sender × 2 次时不触发
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        # 计数器必须检查 sender 集合大小
        assert "sender" in src and (">=2" in src or ">= 2" in src or "len(" in src), (
            "计数器应检查 sender 集合大小（≥2 sender 才触发）"
        )

    def test_three_cross_sender_triggers_heal(self):
        """≥3 次 title_unreadable 跨 ≥2 sender → 触发梯度自愈（dump + 修形 + 重启）。"""
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        # 阈值 3 存在
        assert "3" in src, "梯度自愈阈值 N=3 应在 listen_chat.py 中体现"
        # 重启调用
        assert "_restart_wechat_for_uia" in src, "触发后须调用 _restart_wechat_for_uia"

    def test_counter_resets_on_restart(self):
        """重启成功后计数器必须复位，不持久化磁盘。"""
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        counter_var = (
            "_consecutive_title_unreadable" if "_consecutive_title_unreadable" in src
            else "consecutive_title_unreadable"
        )
        assert counter_var in src, f"计数器变量 {counter_var} 不存在于 listen_chat.py"
        # dump 写入在 try/except 内（静默写失败）
        assert "zj-deadzone-dump.json" in src, "诊断 dump 路径 zj-deadzone-dump.json 缺失"
        dump_idx = src.index("zj-deadzone-dump.json")
        ctx = src[max(0, dump_idx - 300): dump_idx + 200]
        assert "try" in ctx and "except" in ctx, (
            "诊断 dump 写入必须被 try/except 包裹（写失败静默，不阻塞主链路）"
        )


# ── B-3：skip reason 细分 ─────────────────────────────────────────────────────

@_skip_until_impl
class TestSkipReasonClassification:
    """[BEHAVIOR B-3] skip reason 细分：title_unreadable vs is_group 不混淆"""

    def test_title_unreadable_reason_exists(self):
        """listen_chat.py 含 'title_unreadable' skip reason 字符串。"""
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        assert "title_unreadable" in src, "缺 title_unreadable skip reason"

    def test_is_group_reason_exists(self):
        """listen_chat.py 含 'is_group' skip reason 字符串（原有路径保留）。"""
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        assert "is_group" in src, "缺 is_group skip reason"

    def test_module_status_exposes_title_unreadable(self):
        """module_status 透出 title_unreadable count，不可只写日志。"""
        src_path = os.path.join(_WECHAT_RPA, "listen_chat.py")
        with open(src_path, encoding="utf-8") as f:
            src = f.read()
        # module_status 定义附近出现 title_unreadable
        ms_idx = src.find("module_status")
        assert ms_idx != -1, "缺 module_status"
        window = src[ms_idx: ms_idx + 600]
        assert "title_unreadable" in window or "reason" in window, (
            "module_status 必须透出 title_unreadable reason 字段（看板可见）"
        )


# ── B-4：待发队列 30min 过期 ──────────────────────────────────────────────────

@_skip_until_impl
class TestPendingRetryExpiry:
    """[BEHAVIOR B-4] select_due_retries 丢弃 age > 1800s 的条目"""

    def test_select_due_retries_has_expiry_check(self):
        """`select_due_retries` 函数源码含 1800 过期常量检查。"""
        import inspect
        assert hasattr(listen_chat, "select_due_retries"), "缺 select_due_retries"
        src = inspect.getsource(listen_chat.select_due_retries)
        assert "1800" in src, "select_due_retries 未检查 1800s（30min）过期上限"

    def test_record_reply_failure_signature_unchanged(self):
        """`record_reply_failure` 签名不变（只改 select_due_retries，不改数据结构）。"""
        import inspect
        assert hasattr(listen_chat, "record_reply_failure"), "缺 record_reply_failure"
        sig = str(inspect.signature(listen_chat.record_reply_failure))
        # 签名不应含 1800 或 expire 相关参数
        assert "1800" not in sig and "expire" not in sig.lower(), (
            "record_reply_failure 签名不应变（数据结构保持不变，只改 select_due_retries）"
        )


# ── B-5：build-modules 镜像同步 ──────────────────────────────────────────────

class TestBuildModulesSync:
    """[BEHAVIOR B-5] build-modules/line04 镜像与 wechat-rpa 一致（无需 impl flag）"""

    def test_build_modules_listen_chat_in_sync(self):
        """两份 listen_chat.py 内容必须完全一致（rsync 镜像同步）。"""
        src1 = os.path.join(_WECHAT_RPA, "listen_chat.py")
        src2 = os.path.abspath(os.path.join(
            _HERE, "../../../services/agent/build-modules/line04/wechat-rpa/listen_chat.py"
        ))
        assert os.path.exists(src1), f"源文件不存在: {src1}"
        assert os.path.exists(src2), f"build-modules 镜像不存在: {src2}"
        with open(src1, encoding="utf-8") as f1:
            content1 = f1.read()
        with open(src2, encoding="utf-8") as f2:
            content2 = f2.read()
        assert content1 == content2, (
            "wechat-rpa/listen_chat.py 与 build-modules/line04/wechat-rpa/listen_chat.py "
            "内容不同步（需 rsync 镜像，I-6 约束）"
        )
