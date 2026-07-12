"""
浮窗生命周期测试骨架
对应：[BEHAVIOR-FUNC-3] 关闭不被拉回
"""
import time
import pytest


class OverlayLifecycleStub:
    """
    守活逻辑占位实现
    待实现：from services.overlay.watchdog import OverlayWatchdog
    """
    RESTART_INTERVAL = 30  # 30s 心跳重拉间隔

    def __init__(self):
        self.process_running = False
        self.user_closed = False  # 用户主动关闭标志
        self.tray_visible = False
        self.spawn_count = 0
        self._last_spawn_ts = 0

    def spawn(self) -> bool:
        """尝试启动浮窗进程"""
        if self.user_closed:
            return False  # 用户关闭后不自动重拉
        self.process_running = True
        self.spawn_count += 1
        self._last_spawn_ts = time.time()
        return True

    def on_user_close(self):
        """用户点击关闭按钮"""
        self.process_running = False
        self.user_closed = True

    def on_tray_show(self):
        """托盘菜单「显示 AI 浮窗」"""
        self.user_closed = False
        self.spawn()
        self.tray_visible = True

    def tick(self):
        """守活心跳（30s 周期）"""
        if not self.process_running and not self.user_closed:
            self.spawn()


class TestCloseNotRevived:
    """[BEHAVIOR-FUNC-3] 关闭不被拉回"""

    def test_close_not_revived(self):
        """用户关闭后 30s 内不重拉"""
        wdog = OverlayLifecycleStub()
        wdog.spawn()
        assert wdog.process_running

        wdog.on_user_close()
        assert not wdog.process_running
        initial_spawn_count = wdog.spawn_count

        # 模拟多次心跳
        for _ in range(5):
            wdog.tick()

        assert wdog.spawn_count == initial_spawn_count, "Should not respawn after user close"
        assert not wdog.process_running

    def test_tray_reopen(self):
        """托盘菜单重开成功"""
        wdog = OverlayLifecycleStub()
        wdog.spawn()
        wdog.on_user_close()
        assert not wdog.process_running

        # 用户通过托盘菜单重开
        wdog.on_tray_show()
        assert wdog.process_running
        assert wdog.tray_visible

    def test_crash_revived(self):
        """进程崩溃（非用户关闭）→ 守活重拉"""
        wdog = OverlayLifecycleStub()
        wdog.spawn()
        wdog.process_running = False  # 模拟崩溃
        # user_closed 仍为 False

        wdog.tick()
        assert wdog.process_running, "Watchdog should revive crashed process"

    def test_spawn_count_tracks(self):
        """spawn 计数正确"""
        wdog = OverlayLifecycleStub()
        wdog.spawn()
        assert wdog.spawn_count == 1

        # 崩溃重拉
        wdog.process_running = False
        wdog.tick()
        assert wdog.spawn_count == 2
