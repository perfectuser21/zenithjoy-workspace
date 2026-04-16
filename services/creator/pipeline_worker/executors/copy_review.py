"""Stage 3: 文案审查（品牌对齐 + 禁用词）

程序化检查 + LLM 审查（可选）。
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger("pipeline-worker.copy_review")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)

BRAND_KEYWORDS = ["能力", "系统", "一人公司", "小组织", "AI", "能力下放", "能力放大"]
BANNED_WORDS = ["coding", "搭建", "agent workflow", "builder", "Cecelia", "智能体搭建", "代码部署"]


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


def _load_copy_text(out_dir: Path) -> str:
    texts = []
    cp = out_dir / "cards" / "copy.md"
    ap = out_dir / "article" / "article.md"
    if cp.exists():
        texts.append(cp.read_text("utf-8"))
    if ap.exists():
        texts.append(ap.read_text("utf-8"))
    return "\n".join(texts)


def execute_copy_review(run_data: dict) -> dict:
    """执行文案审查。

    Returns:
        {success: bool, review_passed: bool, issues: list, quality_score: int}
    """
    keyword = run_data.get("keyword", "")
    logger.info("[copy-review] 开始: %s", keyword)

    out_dir = _find_output_dir(keyword)
    if not out_dir:
        return {"success": True, "review_passed": False, "issues": ["找不到产出目录"], "quality_score": 0}

    all_text = _load_copy_text(out_dir)
    if not all_text.strip():
        return {"success": True, "review_passed": False, "issues": ["文案内容为空"], "quality_score": 0}

    issues: list[str] = []

    # 1. 禁用词检查
    text_lower = all_text.lower()
    for word in BANNED_WORDS:
        if word.lower() in text_lower:
            issues.append(f"[禁用词] 发现禁用词: {word}")

    # 2. 品牌关键词覆盖检查
    brand_hits = sum(1 for kw in BRAND_KEYWORDS if kw in all_text)
    if brand_hits < 2:
        issues.append(f"[品牌对齐] 品牌关键词覆盖不足（{brand_hits}/{len(BRAND_KEYWORDS)}命中，至少需2个）")

    # 3. 最小长度检查
    if len(all_text) < 800:
        issues.append(f"[长度] 总字数过少（{len(all_text)}字，最少800字）")

    # 质量评分
    quality_score = 8
    if issues:
        quality_score = max(2, 8 - len(issues) * 2)

    passed = quality_score >= 6
    logger.info("[copy-review] %s: quality=%d, issues=%d", "PASS" if passed else "FAIL", quality_score, len(issues))

    return {
        "success": True,
        "review_passed": passed,
        "issues": issues,
        "quality_score": quality_score,
    }
