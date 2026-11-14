"""Stage 3: 文案审查（品牌对齐 + 禁用词）

程序化检查 + LLM 审查（可选）。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from ..artifact_paths import owned_directory, owned_file, guard

logger = logging.getLogger("pipeline-worker.copy_review")


BRAND_KEYWORDS = ["能力", "系统", "一人公司", "小组织", "AI", "能力下放", "能力放大"]
BANNED_WORDS = ["coding", "搭建", "agent workflow", "builder", "Cecelia", "智能体搭建", "代码部署"]


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
    from ._fake import is_fake_mode

    keyword = run_data.get("keyword", "")

    # PR-e/5 端到端 CI fake 模式：自动判定通过
    if is_fake_mode():
        logger.info("[copy-review] fake mode: skipping review checks")
        return {"success": True, "review_passed": True, "issues": [], "quality_score": 100}

    logger.info("[copy-review] 开始: %s", keyword)

    try:
        guard(run_data)
        out_dir = owned_directory(run_data)
        owned_file(run_data, 'cards/copy.md')
        owned_file(run_data, 'article/article.md')
    except ValueError as error:
        return {'success': False, 'error': str(error)}
    if not out_dir.is_dir():
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
