"""image_review executor 集成 vision 的测试

覆盖：
- vision major → review_passed=False（即使 quality_score ≥ 6）
- vision ok → review_passed 依赖 quality_score
- SKIP_VISION_REVIEW=1 → 不调 vision
- vision 模块异常 → 不阻塞 pipeline（保守 pass）
- person-data.json 含 "待补充" 等占位符 → review_passed=False + severity=major
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def _setup_minimal_content(base: Path, slug: str, person_data: dict | None = None) -> Path:
    """创建最小合法 content-output 目录结构，返回 out_dir。

    Args:
        person_data: 若提供，会写入 cards/person-data.json
    """
    from datetime import date
    out_dir = base / f"{date.today().isoformat()}-{slug}"
    (out_dir / "cards").mkdir(parents=True, exist_ok=True)
    (out_dir / "article").mkdir(parents=True, exist_ok=True)
    # 必需文件
    (out_dir / "cards" / "copy.md").write_text("copy", encoding="utf-8")
    (out_dir / "article" / "article.md").write_text("article", encoding="utf-8")
    (out_dir / "cards" / "llm-card-content.json").write_text("{}", encoding="utf-8")
    if person_data is not None:
        (out_dir / "cards" / "person-data.json").write_text(
            json.dumps(person_data, ensure_ascii=False), encoding="utf-8",
        )
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


class TestImageReviewPersonDataPlaceholder(unittest.TestCase):
    """person-data.json 含占位符 → image_review 实锤 FAIL。"""

    def test_person_data_with_placeholder_forces_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "pd-placeholder"
            bad_person_data = {
                "name": "某名",
                "handle": "@x",
                "headline": "headline",
                "key_stats": [{"val": "-", "label": "待补充", "sub": ""}],
                "flywheel": ["a", "b", "c", "d"],
                "flywheel_insight": "一次投入",
                "quote": "q",
                "timeline": [{"year": "-", "title": "待补充", "desc": "暂无数据"}] * 5,
                "day_schedule": [{"time": "-", "title": "待补充", "desc": "暂无数据"}] * 4,
                "qa": [{"q": "q", "a": "a"}] * 4,
            }
            _setup_minimal_content(base, slug, person_data=bad_person_data)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "1",  # 隔离 vision，单独验证占位符检查
            }, clear=False):
                from pipeline_worker.executors import image_review
                result = image_review.execute_image_review({
                    "keyword": slug,
                    "image_count": 9,
                })

        self.assertTrue(result["success"])
        self.assertFalse(result["review_passed"])
        self.assertEqual(result["vision_severity"], "major")
        self.assertTrue(
            any("person-data 含占位符" in i for i in result["issues"]),
            f"issues 应该指出 person-data 占位符问题：{result['issues']}",
        )

    def test_person_data_clean_passes(self):
        """干净的 person-data.json 不应触发占位符规则。"""
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            slug = "pd-clean"
            good_person_data = {
                "name": "龙虾效应",
                "handle": "@solo-lobster",
                "headline": "一人公司的终极形态",
                "key_stats": [{"val": "千万", "label": "虚拟团队", "sub": "AI 调度"}] * 3,
                "flywheel": ["输入", "加工", "输出", "反哺"],
                "flywheel_insight": "一次投入",
                "quote": "系统即员工。",
                "timeline": [{"year": "2026", "title": "龙虾时代", "desc": "一人公司主流化"}] * 5,
                "day_schedule": [{"time": "早上", "title": "规划", "desc": "制定今日优先级"}] * 4,
                "qa": [{"q": "门槛高吗", "a": "会用 AI 即可"}] * 4,
            }
            _setup_minimal_content(base, slug, person_data=good_person_data)

            with patch.dict(os.environ, {
                "CONTENT_OUTPUT_DIR": str(base),
                "SKIP_VISION_REVIEW": "1",
            }, clear=False):
                from pipeline_worker.executors import image_review
                result = image_review.execute_image_review({
                    "keyword": slug,
                    "image_count": 9,
                })

        self.assertTrue(result["review_passed"])
        self.assertFalse(
            any("person-data 含占位符" in i for i in result["issues"]),
            f"干净 person-data 不应被误判：{result['issues']}",
        )


if __name__ == "__main__":
    unittest.main()
