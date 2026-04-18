"""image_vision_review 单测

覆盖：
- 无图：空返回
- 无 API key：跳过所有图（保守 pass，不阻塞 pipeline）
- vision 返回 major → review_passed=False
- vision 返回 minor → review_passed=True（轻微不阻断）
- 多张图聚合 severity
- vision 调用失败（HTTP error）→ skipped 计数，不阻塞

所有 vision 调用通过 monkeypatch `_call_vision` 实现，不走真实网络。
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker import image_vision_review as ivr  # noqa: E402


class TestReviewImages(unittest.TestCase):
    def setUp(self):
        # 确保测试不读真实 credentials
        self.env_patcher = patch.dict(
            "os.environ", {"ANTHROPIC_API_KEY": "test-key-ignored"}
        )
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

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
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, f"{i}.png") for i in range(3)]

            def fake_call(path, api_key):
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
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, f"{i}.png") for i in range(2)]

            def fake_call(path, api_key):
                return {"pass": True, "severity": "ok", "issues": []}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["severity"], "ok")
        self.assertEqual(result["checked"], 2)
        self.assertEqual(result["issues"], [])

    def test_minor_still_passes(self):
        """minor 问题 → review_passed=True，但上报 issues"""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, "a.png")]

            def fake_call(path, api_key):
                return {"pass": True, "severity": "minor",
                        "issues": ["配色一般"]}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["severity"], "minor")
        self.assertTrue(any("配色" in i for i in result["issues"]))

    def test_mixed_severity_aggregates_to_worst(self):
        """ok + minor + major → 聚合 major + FAIL"""
        import tempfile
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

            def fake_call(path, api_key):
                sev, p, iss = severity_map[path.name]
                return {"pass": p, "severity": sev, "issues": iss}

            with patch.object(ivr, "_call_vision", side_effect=fake_call):
                result = ivr.review_images(imgs)

        self.assertFalse(result["review_passed"])
        self.assertEqual(result["severity"], "major")
        self.assertEqual(result["checked"], 3)

    def test_vision_failure_skip_not_block(self):
        """vision API 调用返回 None → skipped，不判 FAIL"""
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            imgs = [self._make_fake_png(tmpd, "a.png"), self._make_fake_png(tmpd, "b.png")]

            with patch.object(ivr, "_call_vision", return_value=None):
                result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["checked"], 0)
        self.assertEqual(result["skipped"], 2)

    def test_missing_api_key(self):
        """无 API key → 全部跳过，保守 pass"""
        with patch.dict("os.environ", {}, clear=False):
            # 覆盖 env 并保证不读 ~/.credentials
            with patch("os.environ.get", side_effect=lambda k, d=None: None if k == "ANTHROPIC_API_KEY" else d):
                with patch.object(ivr, "_load_anthropic_api_key", return_value=None):
                    import tempfile
                    with tempfile.TemporaryDirectory() as tmp:
                        tmpd = Path(tmp)
                        imgs = [self._make_fake_png(tmpd, "a.png")]
                        result = ivr.review_images(imgs)

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["skipped"], 1)
        self.assertTrue(any("ANTHROPIC_API_KEY" in i for i in result["issues"]))

    def test_missing_image_path(self):
        """图文件不存在 → skipped"""
        def fake_call(path, api_key):
            raise AssertionError("不应被调用")

        with patch.object(ivr, "_call_vision", side_effect=fake_call):
            result = ivr.review_images([Path("/tmp/doesnotexist-9999.png")])

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["skipped"], 1)


class TestStripJsonFence(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(ivr._strip_json_fence('```json\n{"a":1}\n```'), '{"a":1}')


if __name__ == "__main__":
    unittest.main()
