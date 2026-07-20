"""
test_launch_weixin.py — find_weixin.launch_weixin / is_weixin_running 纯函数单测。

跨平台：顶层不 import win32 / ctypes / subprocess 真调用，全 mock。

跨进程互斥锁回归（2026-07-17，xian-rog 实锤）：CI self-hosted runner（job2/job3）和常驻 staging
Line04 agent 按既定设计合一跑在同一台机器、同一个真实微信会话上。launch_weixin() 文档写"已运行时
也返回 True（幂等）"但原实现从不检查是否已运行、无条件 Popen；CI 一次性进程和常驻 agent 进程各自
独立判定"没找到主窗口"就各自启动，无协调，实测炸出 4 个 Weixin.exe + 8 个 WeChatAppEx.exe 几乎
同时诞生，其中一个卡进幽灵坐标(-32000,-32000)，导致 job3 真机气泡 gate 的 reply_in_chat fail-closed。
修法：调用前真实检查 is_weixin_running()（补上文档承诺的幂等）+ 跨进程文件锁（原子 os.open
O_CREAT|O_EXCL，陈旧锁超时自动抢占）包住"检查是否运行→决定要不要启动"整个判断+启动动作。
"""
from __future__ import annotations

import os
import sys
import threading
import time
import types
from unittest.mock import MagicMock, patch

import pytest

# 保证 find_weixin 可在 macOS/Linux 上 import（pywinauto 软依赖通过函数体内 import 绕过）
sys.path.insert(0, __file__.replace("/tests/test_launch_weixin.py", ""))

from find_weixin import (  # noqa: E402
    acquire_launch_lock,
    launch_weixin,
    is_weixin_running,
    release_launch_lock,
)


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
    """全部显式 mock is_weixin_running + 传 tmp_path 锁文件路径——因为 job2 这套 pytest 套件本身
    就跑在真实 xian-rog 机器上，那台机器上真实微信随时可能已在运行，不显式 mock 会导致测试结果
    随真机状态漂移（这正是 launch_weixin 加 is_weixin_running 前置检查之后必须处理的既有测试）。"""

    def test_returns_false_when_exe_not_found(self, tmp_path):
        nonexistent = str(tmp_path / "nonexistent" / "Weixin.exe")
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=False):
            assert launch_weixin(exe_path=nonexistent, lock_path=lock_path) is False

    def test_returns_true_when_popen_succeeds(self, tmp_path):
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            result = launch_weixin(exe_path=str(fake_exe), lock_path=lock_path)
        assert result is True
        mock_popen.assert_called_once()

    def test_returns_false_when_popen_raises(self, tmp_path):
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("subprocess.Popen", side_effect=PermissionError("access denied")):
            assert launch_weixin(exe_path=str(fake_exe), lock_path=lock_path) is False

    def test_uses_default_path_when_no_exe_path_given(self, tmp_path):
        """不传 exe_path 时使用 WEIXIN_EXE_DEFAULT（mock isfile 返回 False → launch_weixin 返回 False）。"""
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("find_weixin.os.path.isfile", return_value=False):
            result = launch_weixin(lock_path=lock_path)
        assert result is False

    def test_skips_popen_when_already_running(self, tmp_path):
        """微信已在运行时（is_weixin_running=True）必须跳过 Popen，直接返回 True（幂等，
        补上文档一直承诺但原实现从未兑现的行为——这正是 xian-rog 重复启动的根因之一）。"""
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=True), \
             patch("subprocess.Popen") as mock_popen:
            result = launch_weixin(exe_path=str(fake_exe), lock_path=lock_path)
        assert result is True
        mock_popen.assert_not_called()

    def test_skips_popen_when_lock_held_by_another_process(self, tmp_path):
        """锁被另一进程持有（未过期）时必须放弃启动，不调 Popen——直接反映当前
        is_weixin_running() 的真实结果（不重试等待，交给下一轮循环）。"""
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = tmp_path / "launch.lock"
        lock_path.write_text("999999")  # 模拟另一进程持有的新鲜锁
        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("subprocess.Popen") as mock_popen:
            result = launch_weixin(exe_path=str(fake_exe), lock_path=str(lock_path))
        assert result is False
        mock_popen.assert_not_called()

    def test_releases_lock_after_launch(self, tmp_path):
        """启动完成后（无论成功失败）必须释放锁文件，不留下永久占用。"""
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = str(tmp_path / "launch.lock")
        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("subprocess.Popen") as mock_popen:
            mock_popen.return_value = MagicMock()
            launch_weixin(exe_path=str(fake_exe), lock_path=lock_path)
        assert not os.path.exists(lock_path), "启动完成后必须释放锁文件"

    def test_concurrent_launch_calls_only_popen_once(self, tmp_path):
        """核心回归：两个几乎同时的调用方（用线程模拟两个独立进程）争抢同一把锁，
        跨进程互斥必须确保只有一次真实 Popen 发生——这是 xian-rog CI job 和常驻 staging
        agent 并发启动微信、堆出 4 个 Weixin.exe 进程的根因回归测试。"""
        fake_exe = tmp_path / "Weixin.exe"
        fake_exe.write_bytes(b"")
        lock_path = str(tmp_path / "launch.lock")
        popen_calls = []
        calls_guard = threading.Lock()

        def fake_popen(*args, **kwargs):
            with calls_guard:
                popen_calls.append(1)
            time.sleep(0.05)  # 拉长临界区，扩大竞态窗口，逼真实的启动耗时
            return MagicMock()

        def worker():
            launch_weixin(exe_path=str(fake_exe), lock_path=lock_path)

        with patch("find_weixin.is_weixin_running", return_value=False), \
             patch("subprocess.Popen", side_effect=fake_popen):
            t1 = threading.Thread(target=worker)
            t2 = threading.Thread(target=worker)
            t1.start()
            t2.start()
            t1.join(timeout=5)
            t2.join(timeout=5)

        assert len(popen_calls) == 1, (
            f"两个并发调用应只触发一次真实启动（跨进程锁互斥），实际触发了 {len(popen_calls)} 次"
        )


class TestLaunchLock:
    def test_acquire_succeeds_when_no_lock_exists(self, tmp_path):
        lock_path = str(tmp_path / "launch.lock")
        assert acquire_launch_lock(lock_path) is True
        assert os.path.exists(lock_path)

    def test_acquire_fails_when_fresh_lock_held(self, tmp_path):
        lock_path = str(tmp_path / "launch.lock")
        assert acquire_launch_lock(lock_path) is True  # 第一次持有
        assert acquire_launch_lock(lock_path) is False  # 第二次（模拟另一进程）必须失败

    def test_acquire_steals_stale_lock(self, tmp_path):
        """锁文件存在但已超过 stale_after 秒未更新（持有者大概率已崩溃退出）→ 视为陈旧锁，
        自动清理后重新获取成功，防止一个崩溃的持锁进程永久卡死后续所有启动。"""
        lock_path = tmp_path / "launch.lock"
        lock_path.write_text("123456")
        old_time = time.time() - 3600
        os.utime(str(lock_path), (old_time, old_time))
        assert acquire_launch_lock(str(lock_path), stale_after=30) is True

    def test_acquire_does_not_steal_fresh_lock(self, tmp_path):
        lock_path = tmp_path / "launch.lock"
        lock_path.write_text("123456")  # mtime = 刚刚，未过期
        assert acquire_launch_lock(str(lock_path), stale_after=30) is False

    def test_release_removes_lock_file(self, tmp_path):
        lock_path = str(tmp_path / "launch.lock")
        acquire_launch_lock(lock_path)
        release_launch_lock(lock_path)
        assert not os.path.exists(lock_path)

    def test_release_noop_when_no_lock_file(self, tmp_path):
        """锁文件不存在时释放不应抛异常。"""
        lock_path = str(tmp_path / "nonexistent.lock")
        release_launch_lock(lock_path)  # 不应抛异常
