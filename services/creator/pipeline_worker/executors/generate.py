"""Stage 4: 图片生成

调用图片生成脚本（复用 scripts/engine/）生成信息图卡片。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import date
from pathlib import Path

logger = logging.getLogger("pipeline-worker.generate")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)

GEN_V6_SCRIPT = Path.home() / "claude-output" / "scripts" / "gen-v6-person.mjs"


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


def _load_findings(keyword: str) -> list[dict]:
    research_dir = Path(OUTPUT_BASE) / "research"
    if not research_dir.exists():
        return []
    s = _slug(keyword)
    best: list[dict] = []
    for cand in research_dir.iterdir():
        if s in cand.name:
            fp = cand / "findings.json"
            if fp.exists():
                try:
                    data = json.loads(fp.read_text("utf-8"))
                    f = data.get("findings", [])
                    if len(f) > len(best):
                        best = f
                except (json.JSONDecodeError, OSError):
                    pass
    return best


def execute_generate(run_data: dict) -> dict:
    """执行图片生成。

    Returns:
        {success: bool, output_dir?: str, image_count: int, error?: str}
    """
    from ._fake import fake_output_dir, is_fake_mode

    keyword = run_data.get("keyword", "")
    image_count = run_data.get("image_count", 9)

    # PR-e/5 端到端 CI fake 模式：不生成真图
    if is_fake_mode():
        out_dir = fake_output_dir(run_data, "generate")
        logger.info("[generate] fake mode: skipping image generation, dir=%s", out_dir)
        return {"success": True, "output_dir": out_dir, "image_count": 0}

    logger.info("[generate] 开始图片生成: %s", keyword)

    out_dir = _find_output_dir(keyword)
    if not out_dir:
        today_str = date.today().isoformat()
        out_dir = Path(OUTPUT_BASE) / f"{today_str}-{_slug(keyword)}"
        (out_dir / "cards").mkdir(parents=True, exist_ok=True)
        (out_dir / "article").mkdir(parents=True, exist_ok=True)
        logger.info("[generate] 产出目录已创建: %s", out_dir)

    # 尝试使用 V6 生成器（如果存在）
    if GEN_V6_SCRIPT.exists():
        person_data_path = out_dir / "person-data.json"

        # 总是用当前 findings 重建 person-data.json。
        # Why: 复用当天 output_dir 时，上次跑剩的文件会服老数据给 V6 渲染。
        findings = _load_findings(keyword)
        if findings:
            from ..person_data_builder import build_person_data
            person_data = build_person_data(keyword, findings)
            person_data_path.write_text(
                json.dumps(person_data, ensure_ascii=False, indent=2), encoding="utf-8",
            )
            logger.info(
                "[generate] person-data 已生成: name=%s handle=%s",
                person_data.get("name"), person_data.get("handle"),
            )

        if person_data_path.exists():
            keyword_slug = _slug(keyword)
            try:
                result = subprocess.run(
                    ["node", str(GEN_V6_SCRIPT), "--data", str(person_data_path), "--slug", keyword_slug],
                    capture_output=True, text=True, timeout=180,
                )
                if result.returncode == 0:
                    logger.info("[generate] V6 生成器完成: %s", result.stdout[:300])
                else:
                    logger.warning("[generate] V6 生成器失败: %s", result.stderr[:300])
            except Exception as e:
                logger.warning("[generate] V6 生成器异常: %s", e)

    # LLM 卡片内容（写入 llm-card-content.json 供 image_review 使用）
    card_content_path = out_dir / "cards" / "llm-card-content.json"
    if not card_content_path.exists():
        findings = _load_findings(keyword)
        if findings:
            cards = [
                {
                    "index": i + 1,
                    "title": f.get("title", "")[:30],
                    "content": (f.get("content") or "")[:80],
                    "highlight": "",
                }
                for i, f in enumerate(findings[:image_count])
            ]
            card_content_path.write_text(
                json.dumps({"cards": cards}, ensure_ascii=False, indent=2), encoding="utf-8",
            )

    logger.info("[generate] 图片生成完成: %s", out_dir)
    return {
        "success": True,
        "output_dir": str(out_dir),
        "image_count": image_count,
    }
