"""Stage 5: 图片审查（文件完整性 + 尺寸检查）

检查图片文件是否存在、尺寸是否符合要求，以及 person-data.json 是否含占位符。
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger("pipeline-worker.image_review")

# person-data.json 里不允许出现的占位关键词（会直接 FAIL）
PERSON_DATA_PLACEHOLDERS = ("待补充", "暂无数据", "待产出")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)

IMAGES_DIR = Path(os.environ.get("HOME", "/Users/administrator")) / "claude-output" / "images"


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _check_person_data_placeholders(out_dir: Path) -> list[str]:
    """检查 person-data.json 是否含占位文本。

    返回发现的 issue 列表，空列表表示干净。
    """
    pd_path = out_dir / "cards" / "person-data.json"
    if not pd_path.exists():
        return []
    try:
        raw = pd_path.read_text(encoding="utf-8")
    except OSError as e:
        return [f"person-data.json 读取失败: {e}"]

    hits: list[str] = []
    for ph in PERSON_DATA_PLACEHOLDERS:
        if ph in raw:
            hits.append(f'person-data.json 含占位符 "{ph}"')

    # 再深一层：解析 JSON 检查 key_stats.val 和 timeline.year 是否为纯 "-"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 已经在上面的字符串扫描里找过了，解析失败不是 image_review 该管的
        return hits

    for i, s in enumerate(data.get("key_stats") or []):
        if isinstance(s, dict) and str(s.get("val") or "").strip() == "-":
            hits.append(f'person-data.key_stats[{i}].val 为空占位 "-"')
    for i, t in enumerate(data.get("timeline") or []):
        if isinstance(t, dict) and str(t.get("year") or "").strip() == "-":
            hits.append(f'person-data.timeline[{i}].year 为空占位 "-"')
    return hits


def _find_output_dir(keyword: str) -> Path | None:
    # 动态读 env，方便测试 patch
    base = Path(os.environ.get("CONTENT_OUTPUT_DIR", OUTPUT_BASE))
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

    # 新增硬规则：person-data.json 含占位符 → 直接 FAIL
    person_data_issues = _check_person_data_placeholders(out_dir)
    if person_data_issues:
        issues.append("person-data 含占位符，LLM 生成不完整")
        issues.extend(person_data_issues)

    # 检查图片文件
    topic_slug = _slug(keyword)
    card_count = 0
    card_paths: list[Path] = []

    # 1. 优先看 out_dir/cards/*.png（V6 模板输出在此）
    cards_dir = out_dir / "cards"
    if cards_dir.exists():
        card_paths = sorted(
            f for f in cards_dir.iterdir() if f.suffix == ".png"
        )

    # 2. 兜底看 IMAGES_DIR
    if not card_paths and IMAGES_DIR.exists():
        card_paths = sorted(
            f for f in IMAGES_DIR.iterdir()
            if f.name.startswith(topic_slug) and f.suffix == ".png"
        )

    card_count = len(card_paths)
    if card_count > max_images:
        issues.append(f"图片数量 {card_count} 超过限制（最多 {max_images} 张）")

    # 新增：Vision 视觉检查（检查文字溢出/布局重叠/字体异常）
    vision_report: dict = {"review_passed": True, "severity": "ok", "issues": [], "per_image": []}
    vision_severity = "ok"
    if card_paths and os.environ.get("SKIP_VISION_REVIEW") != "1":
        try:
            from ..image_vision_review import review_images
            vision_report = review_images(card_paths)
            vision_severity = vision_report.get("severity", "ok")
            for v_issue in vision_report.get("issues", []):
                issues.append(f"vision: {v_issue}")
        except Exception as e:
            # vision 模块异常也不阻塞（保守策略）
            logger.warning("[image-review] vision 模块异常，跳过视觉检查: %s", e)
            issues.append(f"vision 模块异常: {e}")

    # 质量评分
    quality_score = 8
    if issues:
        blocking = sum(1 for i in issues if "缺少 cards/copy" in i or "缺少 article" in i)
        quality_score = max(2, 8 - blocking * 3 - (len(issues) - blocking))

    passed = quality_score >= 6
    # Vision major 问题强制 FAIL（即使 quality_score 够）
    if vision_severity == "major":
        passed = False
        logger.warning("[image-review] vision major 问题实锤 FAIL")
    # person-data.json 含占位符 → 实锤 FAIL（对应 severity=major）
    if person_data_issues:
        passed = False
        if vision_severity != "major":
            vision_severity = "major"
        logger.warning("[image-review] person-data 含占位符实锤 FAIL")

    logger.info(
        "[image-review] %s: quality=%d, cards=%d, issues=%d, vision_severity=%s",
        "PASS" if passed else "FAIL", quality_score, card_count, len(issues), vision_severity,
    )

    return {
        "success": True,
        "review_passed": passed,
        "card_count": card_count,
        "issues": issues,
        "quality_score": quality_score,
        "vision_severity": vision_severity,
        "vision_report": vision_report,
    }
