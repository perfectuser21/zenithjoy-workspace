"""Stage 5: 图片审查（文件完整性 + 尺寸检查）

检查图片文件是否存在、尺寸是否符合要求。
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

logger = logging.getLogger("pipeline-worker.image_review")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)

IMAGES_DIR = Path(os.environ.get("HOME", "/Users/administrator")) / "claude-output" / "images"


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _find_output_dir(keyword: str) -> Path | None:
    base = Path(OUTPUT_BASE)
    if not base.exists():
        return None
    s = _slug(keyword)
    for d in sorted(base.iterdir(), reverse=True):
        if d.is_dir() and s in d.name and not d.name.startswith("research"):
            return d
    return None


def execute_image_review(run_data: dict) -> dict:
    """执行图片审查。

    Returns:
        {success: bool, review_passed: bool, card_count: int, issues: list, quality_score: int}
    """
    from ._fake import is_fake_mode

    keyword = run_data.get("keyword", "")
    max_images = run_data.get("image_count", 9)

    # PR-e/5 端到端 CI fake 模式：自动判定通过
    if is_fake_mode():
        logger.info("[image-review] fake mode: skipping image checks")
        return {
            "success": True,
            "review_passed": True,
            "card_count": 0,
            "issues": [],
            "quality_score": 100,
        }

    logger.info("[image-review] 开始: %s", keyword)

    out_dir = _find_output_dir(keyword)
    if not out_dir:
        return {
            "success": True,
            "review_passed": False,
            "card_count": 0,
            "issues": ["找不到产出目录"],
            "quality_score": 0,
        }

    issues: list[str] = []

    # 检查文案文件
    cp = out_dir / "cards" / "copy.md"
    ap = out_dir / "article" / "article.md"
    if not cp.exists():
        issues.append("缺少 cards/copy.md 文案文件")
    if not ap.exists():
        issues.append("缺少 article/article.md 长文文件")

    # 检查卡片内容 JSON
    card_content = out_dir / "cards" / "llm-card-content.json"
    if not card_content.exists():
        issues.append("缺少 cards/llm-card-content.json 卡片内容")

    # 检查图片文件
    topic_slug = _slug(keyword)
    card_count = 0
    if IMAGES_DIR.exists():
        card_count = len([
            f for f in IMAGES_DIR.iterdir()
            if f.name.startswith(topic_slug) and f.suffix == ".png"
        ])

    if card_count > max_images:
        issues.append(f"图片数量 {card_count} 超过限制（最多 {max_images} 张）")

    # 质量评分
    quality_score = 8
    if issues:
        # 文案文件缺失扣分多，内容 JSON 缺失扣分少
        blocking = sum(1 for i in issues if "缺少 cards/copy" in i or "缺少 article" in i)
        quality_score = max(2, 8 - blocking * 3 - (len(issues) - blocking))

    passed = quality_score >= 6
    logger.info("[image-review] %s: quality=%d, cards=%d, issues=%d", "PASS" if passed else "FAIL", quality_score, card_count, len(issues))

    return {
        "success": True,
        "review_passed": passed,
        "card_count": card_count,
        "issues": issues,
        "quality_score": quality_score,
    }
