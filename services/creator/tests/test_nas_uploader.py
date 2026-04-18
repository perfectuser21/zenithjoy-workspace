"""nas_uploader 单测（tar over ssh）。

覆盖：
- ssh mkdir 调用参数正确（使用 alias）
- tar -cf | ssh tar -xf 调用参数正确
- 成功路径：返回 success=True + nas_path
- ssh mkdir 失败 → 重试后 return False
- tar 失败 → 重试后 return False
- 超时 → return False
- 自定义 ssh_alias 参数生效
- 默认 alias 来自 NAS_SSH_ALIAS env / 默认值 "nas"
"""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline_worker import nas_uploader  # noqa: E402


def _mk_completed(returncode: int = 0, stderr: str = "") -> MagicMock:
    cp = MagicMock(spec=subprocess.CompletedProcess)
    cp.returncode = returncode
    cp.stderr = stderr
    cp.stdout = ""
    return cp


def _mk_popen(returncode: int = 0, stderr_bytes: bytes = b"") -> MagicMock:
    proc = MagicMock()
    proc.stdout = MagicMock()
    proc.stdout.close = MagicMock()
    proc.returncode = returncode
    proc.communicate = MagicMock(return_value=(b"", stderr_bytes))
    proc.kill = MagicMock()
    return proc


class TestRunMkdir(unittest.TestCase):
    def test_success(self):
        with patch.object(nas_uploader.subprocess, "run", return_value=_mk_completed(0)) as m:
            ok, err = nas_uploader._run_mkdir("nas", "/volume1/a/b")
        self.assertTrue(ok)
        self.assertEqual(err, "")
        # 参数：["ssh", "nas", "mkdir -p '/volume1/a/b'"]
        args, kwargs = m.call_args
        self.assertEqual(args[0], ["ssh", "nas", "mkdir -p '/volume1/a/b'"])
        self.assertEqual(kwargs.get("timeout"), nas_uploader.MKDIR_TIMEOUT)

    def test_failure_returns_stderr(self):
        cp = _mk_completed(255, stderr="Permission denied\n")
        with patch.object(nas_uploader.subprocess, "run", return_value=cp):
            ok, err = nas_uploader._run_mkdir("nas", "/remote")
        self.assertFalse(ok)
        self.assertIn("Permission denied", err)

    def test_timeout(self):
        exc = subprocess.TimeoutExpired(cmd="ssh", timeout=30)
        with patch.object(nas_uploader.subprocess, "run", side_effect=exc):
            ok, err = nas_uploader._run_mkdir("nas", "/remote")
        self.assertFalse(ok)
        self.assertIn("超时", err)

    def test_uses_custom_alias(self):
        with patch.object(nas_uploader.subprocess, "run", return_value=_mk_completed(0)) as m:
            nas_uploader._run_mkdir("custom-alias", "/x")
        args, _ = m.call_args
        self.assertEqual(args[0][1], "custom-alias")


class TestRunTarOverSsh(unittest.TestCase):
    def test_success(self):
        proc = _mk_popen(returncode=0)
        ssh_cp = _mk_completed(0)
        with patch.object(nas_uploader.subprocess, "Popen", return_value=proc) as p_mock, \
             patch.object(nas_uploader.subprocess, "run", return_value=ssh_cp) as r_mock:
            ok, err = nas_uploader._run_tar_over_ssh("/tmp/src", "nas", "/remote/dst")

        self.assertTrue(ok)
        self.assertEqual(err, "")

        # tar 调用参数
        tar_args, _ = p_mock.call_args
        self.assertEqual(tar_args[0], ["tar", "-cf", "-", "-C", "/tmp/src", "."])

        # ssh 调用参数
        ssh_args, ssh_kwargs = r_mock.call_args
        self.assertEqual(ssh_args[0], ["ssh", "nas", "cd '/remote/dst' && tar -xf -"])
        self.assertEqual(ssh_kwargs.get("stdin"), proc.stdout)
        self.assertEqual(ssh_kwargs.get("timeout"), nas_uploader.TAR_TIMEOUT)

        # stdout 被关闭
        proc.stdout.close.assert_called()

    def test_ssh_failure(self):
        proc = _mk_popen(returncode=0)
        ssh_cp = _mk_completed(2, stderr="tar: short read\n")
        with patch.object(nas_uploader.subprocess, "Popen", return_value=proc), \
             patch.object(nas_uploader.subprocess, "run", return_value=ssh_cp):
            ok, err = nas_uploader._run_tar_over_ssh("/tmp/src", "nas", "/remote")
        self.assertFalse(ok)
        self.assertIn("short read", err)

    def test_tar_failure(self):
        proc = _mk_popen(returncode=2, stderr_bytes=b"tar: cannot open\n")
        ssh_cp = _mk_completed(0)
        with patch.object(nas_uploader.subprocess, "Popen", return_value=proc), \
             patch.object(nas_uploader.subprocess, "run", return_value=ssh_cp):
            ok, err = nas_uploader._run_tar_over_ssh("/tmp/src", "nas", "/remote")
        self.assertFalse(ok)
        self.assertIn("cannot open", err)

    def test_timeout(self):
        proc = _mk_popen(returncode=0)
        exc = subprocess.TimeoutExpired(cmd="ssh", timeout=120)
        with patch.object(nas_uploader.subprocess, "Popen", return_value=proc), \
             patch.object(nas_uploader.subprocess, "run", side_effect=exc):
            ok, err = nas_uploader._run_tar_over_ssh("/tmp/src", "nas", "/remote")
        self.assertFalse(ok)
        self.assertIn("超时", err)
        proc.kill.assert_called()


class TestUploadToNas(unittest.TestCase):
    def setUp(self):
        # 避免真的 sleep
        self._sleep_patcher = patch.object(nas_uploader.time, "sleep", return_value=None)
        self._sleep_patcher.start()

    def tearDown(self):
        self._sleep_patcher.stop()

    def test_success_first_try(self):
        with patch.object(nas_uploader, "_run_mkdir", return_value=(True, "")) as mk, \
             patch.object(nas_uploader, "_run_tar_over_ssh", return_value=(True, "")) as tar:
            result = nas_uploader.upload_to_nas("/tmp/src", "pipe123")

        self.assertTrue(result["success"])
        self.assertEqual(result["error"], None)
        self.assertTrue(result["nas_path"].endswith("/pipe123"))
        mk.assert_called_once()
        tar.assert_called_once()

        # 默认 alias
        mk_args, _ = mk.call_args
        self.assertEqual(mk_args[0], nas_uploader.NAS_SSH_ALIAS)

    def test_mkdir_fail_retries_then_gives_up(self):
        with patch.object(nas_uploader, "_run_mkdir", return_value=(False, "boom")) as mk, \
             patch.object(nas_uploader, "_run_tar_over_ssh") as tar:
            result = nas_uploader.upload_to_nas("/tmp/src", "p")
        self.assertFalse(result["success"])
        self.assertIsNone(result["nas_path"])
        self.assertIn("mkdir 失败", result["error"])
        # MAX_RETRIES+1 次尝试
        self.assertEqual(mk.call_count, nas_uploader.MAX_RETRIES + 1)
        tar.assert_not_called()

    def test_tar_fail_retries_then_gives_up(self):
        with patch.object(nas_uploader, "_run_mkdir", return_value=(True, "")) as mk, \
             patch.object(nas_uploader, "_run_tar_over_ssh", return_value=(False, "pipe closed")) as tar:
            result = nas_uploader.upload_to_nas("/tmp/src", "p")
        self.assertFalse(result["success"])
        self.assertIn("pipe closed", result["error"])
        self.assertEqual(mk.call_count, nas_uploader.MAX_RETRIES + 1)
        self.assertEqual(tar.call_count, nas_uploader.MAX_RETRIES + 1)

    def test_retry_then_succeed(self):
        mkdir_side = [(True, ""), (True, "")]
        tar_side = [(False, "transient"), (True, "")]
        with patch.object(nas_uploader, "_run_mkdir", side_effect=mkdir_side), \
             patch.object(nas_uploader, "_run_tar_over_ssh", side_effect=tar_side) as tar:
            result = nas_uploader.upload_to_nas("/tmp/src", "p")
        self.assertTrue(result["success"])
        self.assertEqual(tar.call_count, 2)

    def test_custom_ssh_alias(self):
        with patch.object(nas_uploader, "_run_mkdir", return_value=(True, "")) as mk, \
             patch.object(nas_uploader, "_run_tar_over_ssh", return_value=(True, "")) as tar:
            nas_uploader.upload_to_nas("/tmp/src", "p", ssh_alias="custom")
        mk_args, _ = mk.call_args
        self.assertEqual(mk_args[0], "custom")
        tar_args, _ = tar.call_args
        # _run_tar_over_ssh(local_dir, alias, remote_dir)
        self.assertEqual(tar_args[1], "custom")


class TestModuleConstants(unittest.TestCase):
    def test_default_ssh_alias(self):
        # 默认应为 "nas"（除非 env 覆盖）
        self.assertTrue(isinstance(nas_uploader.NAS_SSH_ALIAS, str))
        self.assertGreater(len(nas_uploader.NAS_SSH_ALIAS), 0)


if __name__ == "__main__":
    unittest.main()
