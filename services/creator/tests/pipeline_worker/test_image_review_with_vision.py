"""image_review executor 集成 vision 的测试

覆盖：
- vision major → review_passed=False（即使 quality_score ≥ 6）
- vision ok → review_passed 依赖 quality_score
- SKIP_VISION_REVIEW=1 → 不调 vision
- vision 模块异常 → 不阻塞 pipeline（保守 pass）
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _setup_minimal_content(base: Path, slug: str) -> Path:
    """创建最小合法 content-output 目录结构，返回 out_dir。"""
    from datetime import date
    out_dir = base / f"{date.today().isoformat()}-{slug}"
    (out_dir / "cards").mkdir(parents=True, exist_ok=True)
    (out_dir / "article").mkdir(parents=True, exist_ok=True)
    # 必需文件
    (out_dir / "cards" / "copy.md").write_text("copy", encoding="utf-8")
    (out_dir / "article" / "article.md").write_text("article", encoding="utf-8")
    (out_dir / "cards" / "llm-card-content.json").write_text("{}", encoding="utf-8")
    # 假 PNG
    for i in range(3):
        (out_dir / "cards" / f"{slug}-{i:02d}.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    return out_dir


class TestImageReviewWithVision(unittest.TestCase):
    def test_vision_major_forces_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "test-slug"
            _setup_minimal_content(base, slug)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "",
            }, clear=False):
                from pipeline_worker.executors import image_review
                # mock vision 返回 major
                with patch(
                    "pipeline_worker.image_vision_review.review_images"
                ) as mock_review:
                    mock_review.return_value = {
                        "review_passed": False,
                        "checked": 3,
                        "skipped": 0,
                        "issues": ["cover.png: 文字溢出"],
                        "per_image": [],
                        "severity": "major",
                    }
                    result = image_review.execute_image_review({
                        "keyword": slug,
                        "image_count": 9,
                    })

        self.assertTrue(result["success"])
        self.assertFalse(result["review_passed"])
        self.assertEqual(result["vision_severity"], "major")
        self.assertTrue(any("文字溢出" in i for i in result["issues"]))

    def test_vision_ok_allows_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "clean-slug"
            _setup_minimal_content(base, slug)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "",
            }, clear=False):
                from pipeline_worker.executors import image_review
                with patch(
                    "pipeline_worker.image_vision_review.review_images"
                ) as mock_review:
                    mock_review.return_value = {
                        "review_passed": True,
                        "checked": 3,
                        "skipped": 0,
                        "issues": [],
                        "per_image": [],
                        "severity": "ok",
                    }
                    result = image_review.execute_image_review({
                        "keyword": slug,
                        "image_count": 9,
                    })

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["vision_severity"], "ok")

    def test_skip_vision_env_flag(self):
        """SKIP_VISION_REVIEW=1 → 不调 vision，老逻辑判 pass"""
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "no-vision-slug"
            _setup_minimal_content(base, slug)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "1",
            }, clear=False):
                from pipeline_worker.executors import image_review
                with patch(
                    "pipeline_worker.image_vision_review.review_images"
                ) as mock_review:
                    result = image_review.execute_image_review({
                        "keyword": slug,
                        "image_count": 9,
                    })
                    mock_review.assert_not_called()

        self.assertTrue(result["review_passed"])
        self.assertEqual(result["vision_severity"], "ok")

    def test_vision_module_exception_not_blocking(self):
        """vision 模块 import 失败 → 不阻塞（但上报 issue）"""
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "err-slug"
            _setup_minimal_content(base, slug)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "",
            }, clear=False):
                from pipeline_worker.executors import image_review
                with patch(
                    "pipeline_worker.image_vision_review.review_images",
                    side_effect=RuntimeError("模拟 vision 异常"),
                ):
                    result = image_review.execute_image_review({
                        "keyword": slug,
                        "image_count": 9,
                    })

        # vision 异常不应强制 FAIL（保守策略）
        self.assertTrue(result["success"])
        # 应当有异常记录在 issues
        self.assertTrue(any("vision 模块异常" in i for i in result["issues"]))


if __name__ == "__main__":
    unittest.main()
