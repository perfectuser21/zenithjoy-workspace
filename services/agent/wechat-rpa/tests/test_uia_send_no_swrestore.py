"""
回归测试：_uia_send fallback 绝对不允许调用 SW_RESTORE（9）拉前台。

背景（2026-06-09）：PostMessageW Enter 发送失败后，原 fallback 中有
ShowWindow(main_hwnd, SW_RESTORE=9)，把微信窗口激活到前台，违反
wechat-uia-silent-send skill 的零前台激活原则。修法：删除该行，仅保留
iface_invoke.Invoke()（UIA 调用，不依赖前台焦点）。
"""
import sys
import types
import ctypes
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch


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


def _import_listen_chat():
    if "listen_chat" in sys.modules:
        del sys.modules["listen_chat"]
    if "services/agent/wechat-rpa" not in sys.path:
        sys.path.insert(0, "services/agent/wechat-rpa")
    try:
        import listen_chat as lc
        return lc
    except Exception:
        return None


@contextmanager
def _mock_windll(user32):
    """在 macOS/Linux 上注入 ctypes.windll stub，Windows 上替换真实 windll。"""
    windll_mock = MagicMock(user32=user32, kernel32=MagicMock())
    had_windll = hasattr(ctypes, "windll")
    original = getattr(ctypes, "windll", None)
    ctypes.windll = windll_mock
    try:
        yield windll_mock
    finally:
        if had_windll:
            ctypes.windll = original
        else:
            try:
                delattr(ctypes, "windll")
            except AttributeError:
                pass


class TestUiaSendNoSwRestore(unittest.TestCase):
    """_uia_send 在 Enter 未清空时，fallback 不得调用 ShowWindow(SW_RESTORE=9)。"""

    SW_RESTORE = 9

    def setUp(self):
        self.lc = _import_listen_chat()
        if self.lc is None:
            self.skipTest("listen_chat 导入失败（需要 Windows 或 stub 支持）")

    def _run_uia_send(self, user32, get_value_sequence):
        edit = MagicMock()
        edit.element_info.handle = 88888
        edit.get_value = MagicMock(side_effect=list(get_value_sequence))
        edit.iface_value = MagicMock()

        mw = MagicMock()
        mw.element_info.handle = 99999

        user32.IsIconic.return_value = False
        user32.GetCurrentThreadId.return_value = 100
        user32.GetWindowThreadProcessId.return_value = 200
        user32.SetFocus.return_value = 0

        btn = MagicMock()
        with patch("listen_chat._find_send_button", return_value=btn), \
             patch("listen_chat._log"):
            return self.lc._uia_send(edit, mw, "测试消息")

    def _assert_no_sw_restore(self, user32):
        for c in user32.ShowWindow.call_args_list:
            args = c[0]
            flag = args[1] if len(args) >= 2 else None
            self.assertNotEqual(
                flag, self.SW_RESTORE,
                f"ShowWindow 被以 SW_RESTORE={self.SW_RESTORE} 调用 → 微信前台激活，违反静默原则。调用: {c}",
            )

    def test_fallback_never_calls_sw_restore_when_enter_fails(self):
        """Enter 未清空 → fallback Invoke() → 不调用 SW_RESTORE。"""
        user32 = MagicMock()
        with _mock_windll(user32):
            result = self._run_uia_send(user32, ["76字未清空内容xxxxxxx", ""])
        self.assertTrue(result, "_uia_send 在 Invoke 兜底后应返回 True")
        self._assert_no_sw_restore(user32)

    def test_main_path_success_never_calls_sw_restore(self):
        """Enter 成功清空 → 主路径成功 → 不调用 SW_RESTORE。"""
        user32 = MagicMock()
        with _mock_windll(user32):
            result = self._run_uia_send(user32, ["测试消息", ""])  # 首调=验证, 次调=发送后清空
        self.assertTrue(result)
        self._assert_no_sw_restore(user32)

    def test_fallback_also_fails_still_no_sw_restore(self):
        """Enter + Invoke 都失败 → 返回 False，仍然不调用 SW_RESTORE。"""
        user32 = MagicMock()
        with _mock_windll(user32):
            result = self._run_uia_send(user32, ["有内容", "还有内容", "仍然有内容"])  # 3次均非空→Enter和Invoke均失败→False
        self.assertFalse(result, "两次都失败应返回 False")
        self._assert_no_sw_restore(user32)

    def test_uia_send_minimized_offscreen_mode_no_sw_restore(self):
        """was_minimized=True + _OFFSCREEN_REPLY=True → SW_RESTORE=9 禁止被调用，应改用 SW_SHOWNA=8。

        v1.0.26 bug：_uia_send 第 375 行无条件调 ShowWindow(main_hwnd, 9)=SW_RESTORE，
        导致微信窗口激活到前台。修法：_OFFSCREEN_REPLY=True 时改用 SW_SHOWNA=8+SetWindowPos。
        """
        user32 = MagicMock()
        user32.IsIconic.return_value = True  # 模拟最小化到任务栏

        edit = MagicMock()
        edit.element_info.handle = 88888
        edit.get_value = MagicMock(side_effect=["测试消息", ""])
        edit.iface_value = MagicMock()

        mw = MagicMock()
        mw.element_info.handle = 99999

        original_offscreen = self.lc._OFFSCREEN_REPLY
        try:
            self.lc._OFFSCREEN_REPLY = True
            with _mock_windll(user32), \
                 patch("listen_chat._find_chat_input", return_value=edit), \
                 patch("listen_chat._log"), \
                 patch("time.sleep"):
                self.lc._uia_send(edit, mw, "测试消息")
        finally:
            self.lc._OFFSCREEN_REPLY = original_offscreen

        self._assert_no_sw_restore(user32)
        sw_calls = [c[0][1] for c in user32.ShowWindow.call_args_list if len(c[0]) >= 2]
        self.assertIn(8, sw_calls,
                      "minimized + _OFFSCREEN_REPLY=True 必须调 SW_SHOWNA=8 而非 SW_RESTORE=9")


if __name__ == "__main__":
    unittest.main()
