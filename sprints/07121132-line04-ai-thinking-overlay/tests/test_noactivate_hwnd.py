"""
NOACTIVATE 窗口标志测试骨架
对应：[BEHAVIOR-INV-3] 禁止抢焦点

注意：真实 Win32 API 测试只能在 Windows 环境运行。
本文件在非 Windows 环境跳过 Win32 相关测试，只运行纯逻辑断言。
"""
import sys
import pytest


IS_WINDOWS = sys.platform == "win32"

# Win32 常量
WS_EX_NOACTIVATE = 0x08000000
WS_EX_TOOLWINDOW = 0x00000080


class TestNoActivateFlags:
    """窗口标志断言"""

    def test_ex_style_constants(self):
        """验证 WS_EX_NOACTIVATE 和 WS_EX_TOOLWINDOW 常量正确"""
        assert WS_EX_NOACTIVATE == 0x08000000
        assert WS_EX_TOOLWINDOW == 0x00000080

    def test_ex_style_combined(self):
        """组合标志按位或正确"""
        combined = WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
        assert combined & WS_EX_NOACTIVATE
        assert combined & WS_EX_TOOLWINDOW

    @pytest.mark.skipif(not IS_WINDOWS, reason="Win32 API only on Windows")
    def test_foreground_unchanged_on_attach(self):
        """
        [CI 层 - notepad 替身测试]
        spawn notepad 并置为前台 → 模拟 overlay SetWindowPos(SWP_NOACTIVATE) →
        断言 GetForegroundWindow() 仍为 notepad_hwnd。

        注意：此测试在 windows_cloud GHA runner 上真实运行（IS_WINDOWS=True）。
        真机层（xian-rog）以真实浮窗进程的 GetWindowLongW 验收（见 BEHAVIOR-INV-3 备注）。
        """
        import ctypes
        import subprocess
        import time

        user32 = ctypes.windll.user32

        SWP_NOACTIVATE = 0x0010
        SWP_NOMOVE     = 0x0002
        SWP_NOSIZE     = 0x0001
        HWND_TOPMOST   = -1

        # 1. spawn notepad 作为替身前台窗口
        proc = subprocess.Popen(["notepad.exe"])
        try:
            # 等待 notepad 窗口出现（最多 3 秒）
            notepad_hwnd = 0
            for _ in range(30):
                time.sleep(0.1)
                notepad_hwnd = user32.FindWindowW("Notepad", None)
                if notepad_hwnd:
                    break
            assert notepad_hwnd != 0, "notepad window did not appear within 3s"

            # 2. 将 notepad 置为前台窗口
            user32.SetForegroundWindow(notepad_hwnd)
            time.sleep(0.1)

            fg_after_set = user32.GetForegroundWindow()
            assert fg_after_set == notepad_hwnd, \
                f"SetForegroundWindow failed: expected {notepad_hwnd}, got {fg_after_set}"

            # 3. 模拟 overlay 贴靠更新（SetWindowPos + SWP_NOACTIVATE）
            #    此处对 notepad 本身执行一次 SWP_NOACTIVATE 以验证该标志不夺焦
            result = user32.SetWindowPos(
                notepad_hwnd,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            )
            assert result != 0, "SetWindowPos returned 0 (failed)"

            # 4. 断言前台窗口未变
            fg_after_attach = user32.GetForegroundWindow()
            assert fg_after_attach == notepad_hwnd, (
                f"Foreground window changed after SWP_NOACTIVATE attach: "
                f"{notepad_hwnd} -> {fg_after_attach}"
            )
        finally:
            proc.terminate()

    @pytest.mark.skipif(not IS_WINDOWS, reason="Win32 API only on Windows")
    def test_overlay_window_has_noactivate_style(self):
        """
        浮窗窗口扩展样式包含 WS_EX_NOACTIVATE
        需要实际浮窗进程运行后才能验证，此处为结构占位
        """
        # 待实现：启动浮窗，查找其 HWND，验证 GetWindowLongW(hwnd, GWL_EXSTYLE)
        import ctypes
        user32 = ctypes.windll.user32
        GWL_EXSTYLE = -20

        # 占位：查找浮窗窗口（按类名或标题）
        # hwnd = user32.FindWindowW("PyWebviewChrome", None)
        # if hwnd:
        #     ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        #     assert ex_style & WS_EX_NOACTIVATE
        #     assert ex_style & WS_EX_TOOLWINDOW
        pytest.skip("Overlay process not running in unit test context")


class TestNoHooksRegistered:
    """无键鼠钩子"""

    def test_no_keyboard_hook_constant(self):
        """键盘钩子常量不应在浮窗代码中使用"""
        WH_KEYBOARD_LL = 13
        WH_MOUSE_LL = 14
        # 架构约束：这些常量不应在浮窗 Python 代码中被 SetWindowsHookEx 使用
        # grep 型验证在 CI smoke 中执行
        assert WH_KEYBOARD_LL == 13
        assert WH_MOUSE_LL == 14
