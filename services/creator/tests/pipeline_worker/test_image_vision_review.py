"""image_vision_review 单测

覆盖：
- 无图：空返回
- vision 返回 major → review_passed=False
- vision 返回 minor → review_passed=True（轻微不阻断）
- 多张图聚合 severity
- vision 调用失败（subprocess 返回 None）→ skipped 计数，不阻塞
- subprocess 调用参数/env 正确性（-p, --image, --dangerously-skip-permissions,
  CLAUDE_CONFIG_DIR）

所有 vision 调用通过 mock `subprocess.run` 或 `_call_vision` 实现，不走真实 CLI。
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker import image_vision_review as ivr  # noqa: E402


class TestReviewImages(unittest.TestCase):
    def _make_fake_png(self, tmp_path: Path, name: str) -> Path:
        p = tmp_path / name
        p.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)  # minimal PNG-ish bytes
        return p

    def test_no_images(self):
        result = ivr.review_images([])
        self.assertTrue(result["review_passed"])
        self.assertEqual(result["checked"], 0)
        self.assertEqual(result["severity"], "ok")

    def test_all_major_fail(self):
        """所有图都 major → review_passed=False"""
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, f"{i}.png") for i in range(3)]

            def fake_call(path, *args, **kwargs):
                return {"pass": False, "severity": "major",
                        "issues": ["文字溢出"]}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertFalse(result["review_passed"])
        self.assertEqual(result["severity"], "major")
        self.assertEqual(result["checked"], 3)
        self.assertEqual(len(result["per_image"]), 3)
        # issues 有带图名前缀
        self.assertTrue(any("0.png" in i for i in result["issues"]))

    def test_all_ok_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, f"{i}.png") for i in range(2)]

            def fake_call(path, *args, **kwargs):
                return {"pass": True, "severity": "ok", "issues": []}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["severity"], "ok")
        self.assertEqual(result["checked"], 2)
        self.assertEqual(result["issues"], [])

    def test_minor_still_passes(self):
        """minor 问题 → review_passed=True，但上报 issues"""
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, "a.png")]

            def fake_call(path, *args, **kwargs):
                return {"pass": True, "severity": "minor",
                        "issues": ["配色一般"]}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["severity"], "minor")
        self.assertTrue(any("配色" in i for i in result["issues"]))

    def test_mixed_severity_aggregates_to_worst(self):
        """ok + minor + major → 聚合 major + FAIL"""
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [
                self._make_fake_png(tmpd, "ok.png"),
                self._make_fake_png(tmpd, "minor.png"),
                self._make_fake_png(tmpd, "major.png"),
            ]
            severity_map = {
                "ok.png": ("ok", True, []),
                "minor.png": ("minor", True, ["轻微"]),
                "major.png": ("major", False, ["溢出"]),
            }

            def fake_call(path, *args, **kwargs):
                sev, p, iss = severity_map[path.name]
                return {"pass": p, "severity": sev, "issues": iss}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertFalse(result["review_passed"])
        self.assertEqual(result["severity"], "major")
        self.assertEqual(result["checked"], 3)

    def test_vision_failure_skip_not_block(self):
        """vision 调用返回 None → skipped，不判 FAIL"""
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, "a.png"), self._make_fake_png(tmpd, "b.png")]

            with patch.object(ivr, "_call_vision", return_value=None):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["checked"], 0)
        self.assertEqual(result["skipped"], 2)

    def test_missing_image_path(self):
        """图文件不存在 → skipped"""
        def fake_call(path, *args, **kwargs):
            raise AssertionError("不应被调用")

        with patch.object(ivr, "_call_vision", side_effect=fake_call):
            result = ivr.review_images([Path("/tmp/doesnotexist-9999.png")])

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["skipped"], 1)


class TestCallVisionSubprocess(unittest.TestCase):
    """验证 _call_vision 正确调 subprocess 并传参。"""

    def _mock_run_ok(self, stdout_text: str) -> MagicMock:
        fake = MagicMock()
        fake.returncode = 0
        fake.stdout = stdout_text
        fake.stderr = ""
        return fake

    def test_subprocess_called_with_correct_args_and_env(self):
        """claude CLI 被调用时带 -p, --image, --dangerously-skip-permissions；
        env 里 CLAUDE_CONFIG_DIR 指向订阅账号；CLAUDECODE 被移除。"""
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")

            fake_result = self._mock_run_ok(
                '{"pass": true, "severity": "ok", "issues": []}'
            )
            with patch.dict(
                os.environ,
                {"CLAUDECODE": "1", "VISION_CLAUDE_ACCOUNT": "account1"},
                clear=False,
            ):
                with patch("subprocess.run", return_value=fake_result) as mock_run:
                    resp = ivr._call_vision(img)

            self.assertIsNotNone(resp)
            self.assertEqual(resp["severity"], "ok")
            self.assertTrue(resp["pass"])

            mock_run.assert_called_once()
            args, kwargs = mock_run.call_args
            cmd = args[0]
            # 参数必须包含 -p / --image <path> / --dangerously-skip-permissions
            self.assertIn("-p", cmd)
            self.assertIn("--image", cmd)
            img_idx = cmd.index("--image")
            self.assertEqual(cmd[img_idx + 1], str(img))
            self.assertIn("--dangerously-skip-permissions", cmd)
            self.assertIn("--output-format", cmd)

            # env：CLAUDE_CONFIG_DIR 指向订阅账号；CLAUDECODE 被移除
            env = kwargs.get("env") or {}
            self.assertEqual(
                env.get("CLAUDE_CONFIG_DIR"),
                str(Path.home() / ".claude-account1"),
            )
            self.assertNotIn("CLAUDECODE", env)

            # subprocess 的 timeout/cwd/capture_output 都正确
            self.assertIn("timeout", kwargs)
            self.assertEqual(kwargs.get("cwd"), "/tmp")
            self.assertTrue(kwargs.get("capture_output"))
            self.assertTrue(kwargs.get("text"))

    def test_custom_account_from_env(self):
        """VISION_CLAUDE_ACCOUNT=account2 → CLAUDE_CONFIG_DIR=~/.claude-account2"""
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")

            fake_result = self._mock_run_ok(
                '{"pass": true, "severity": "ok", "issues": []}'
            )
            with patch.dict(os.environ, {"VISION_CLAUDE_ACCOUNT": "account2"}, clear=False):
                with patch("subprocess.run", return_value=fake_result) as mock_run:
                    ivr._call_vision(img)

            _args, kwargs = mock_run.call_args
            env = kwargs.get("env") or {}
            self.assertEqual(
                env.get("CLAUDE_CONFIG_DIR"),
                str(Path.home() / ".claude-account2"),
            )

    def test_nonzero_returncode_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            fail = MagicMock()
            fail.returncode = 1
            fail.stdout = ""
            fail.stderr = "some cli error"
            with patch("subprocess.run", return_value=fail):
                self.assertIsNone(ivr._call_vision(img))

    def test_timeout_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            with patch("subprocess.run",
                       side_effect=subprocess.TimeoutExpired(cmd="claude", timeout=1)):
                self.assertIsNone(ivr._call_vision(img, timeout=1))

    def test_cli_missing_returns_none(self):
        """claude CLI 不存在 → 返回 None（不抛，pipeline 不阻塞）"""
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            with patch("subprocess.run", side_effect=FileNotFoundError("no claude")):
                self.assertIsNone(ivr._call_vision(img))

    def test_stdout_with_markdown_fence_parsed(self):
        """claude -p 输出带 ```json 栅栏也能解析。"""
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            fenced = '```json\n{"pass": false, "severity": "major", "issues": ["溢出"]}\n```'
            fake_result = self._mock_run_ok(fenced)
            with patch("subprocess.run", return_value=fake_result):
                resp = ivr._call_vision(img)
            self.assertIsNotNone(resp)
            self.assertEqual(resp["severity"], "major")
            self.assertFalse(resp["pass"])
            self.assertIn("溢出", resp["issues"])

    def test_invalid_json_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            fake_result = self._mock_run_ok("this is not json at all")
            with patch("subprocess.run", return_value=fake_result):
                self.assertIsNone(ivr._call_vision(img))

    def test_empty_stdout_returns_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "x.png"
            img.write_bytes(b"\x89PNG\r\n\x1a\n")
            fake_result = self._mock_run_ok("")
            with patch("subprocess.run", return_value=fake_result):
                self.assertIsNone(ivr._call_vision(img))


class TestStripJsonFence(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(ivr._strip_json_fence('```json\n{"a":1}\n```'), '{"a":1}')

    def test_no_fence(self):
        self.assertEqual(ivr._strip_json_fence('{"a":1}'), '{"a":1}')


if __name__ == "__main__":
    unittest.main()
