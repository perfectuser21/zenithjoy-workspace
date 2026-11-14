"""Stage 4: 图片生成

调用图片生成脚本（复用 scripts/engine/）生成信息图卡片。
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from ..artifact_paths import owned_directory, owned_file, load_findings, guard
from ..brain_tasks import CoordinationUnknown

V6_OUTPUT_DIR = Path.home() / "claude-output" / "images"

logger = logging.getLogger("pipeline-worker.generate")


GEN_V6_SCRIPT = Path.home() / "claude-output" / "scripts" / "gen-v6-person.mjs"


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _copy_v6_pngs_to_cards(slug: str, out_dir: Path) -> int:
    # V6 脚本硬编码写到 ~/claude-output/images/，pipeline 的 cards/ 需要这些图给
    # content-images HTTP 路由读。把 slug-*.png 复制过去。
    cards_dir = out_dir / "cards"
    cards_dir.mkdir(parents=True, exist_ok=True)
    matches = sorted(V6_OUTPUT_DIR.glob(f"{slug}-*.png"))
    for src in matches:
        shutil.copy2(src, cards_dir / src.name)
    logger.info("[generate] 拷贝 %d 张 PNG 到 cards/: %s", len(matches), cards_dir)
    return len(matches)


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

    try:
        guard(run_data)
        out_dir = owned_directory(run_data, create=True)
        findings = load_findings(run_data)
    except (ValueError, OSError) as error:
        return {'success': False, 'error': str(error)}

    # 尝试使用 V6 生成器（如果存在）
    if GEN_V6_SCRIPT.exists():
        person_data_path = owned_file(run_data, "person-data.json")

        # 总是用当前 findings 重建 person-data.json。
        # Why: 复用当天 output_dir 时，上次跑剩的文件会服老数据给 V6 渲染。
        if findings:
            from ..person_data_builder import build_person_data
            guard(run_data)
            person_data = build_person_data(keyword, findings)
            guard(run_data)
            person_data_path.write_text(
                json.dumps(person_data, ensure_ascii=False, indent=2), encoding="utf-8",
            )
            logger.info(
                "[generate] person-data 已生成: name=%s handle=%s",
                person_data.get("name"), person_data.get("handle"),
            )

        if person_data_path.exists():
            keyword_slug = f"{_slug(keyword)}-{run_data['pipeline_id']}"
            try:
                guard(run_data)
                result = subprocess.run(
                    ["node", str(GEN_V6_SCRIPT), "--data", str(person_data_path), "--slug", keyword_slug],
                    capture_output=True, text=True, timeout=180,
                )
                guard(run_data)
                if result.returncode == 0:
                    logger.info("[generate] V6 生成器完成: %s", result.stdout[:300])
                    _copy_v6_pngs_to_cards(keyword_slug, out_dir)
                else:
                    logger.warning("[generate] V6 生成器失败: %s", result.stderr[:300])
            except CoordinationUnknown:
                raise
            except Exception as e:
                logger.warning("[generate] V6 生成器异常: %s", e)

    # LLM 卡片内容（写入 llm-card-content.json 供 image_review 使用）
    guard(run_data)
    card_content_path = owned_file(run_data, "cards/llm-card-content.json")
    if not card_content_path.exists():
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
