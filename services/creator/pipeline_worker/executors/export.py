"""Stage 6: 导出 — rsync 到 NAS + manifest.json

将产出物归档并上传到 NAS，生成 manifest.json。
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path

from ..nas_uploader import upload_to_nas

logger = logging.getLogger("pipeline-worker.export")

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


def execute_export(run_data: dict) -> dict:
    """执行导出阶段。

    Args:
        run_data: {keyword, content_type, pipeline_id, ...}

    Returns:
        {success: bool, manifest_path?: str, card_count: int, export_path?: str, error?: str}
    """
    keyword = run_data.get("keyword", "")
    content_type = run_data.get("content_type", "solo-company-case")
    pipeline_id = run_data.get("pipeline_id")

    logger.info("[export] 开始: %s", keyword)

    out_dir = _find_output_dir(keyword)
    if not out_dir:
        return {"success": False, "error": "找不到产出目录"}

    # 收集卡片文件
    topic_slug = _slug(keyword)
    card_files: list[str] = []
    if IMAGES_DIR.exists():
        card_files = sorted([
            f.name for f in IMAGES_DIR.iterdir()
            if f.name.startswith(topic_slug) and f.suffix == ".png"
        ])

    # 生成 manifest.json
    manifest = {
        "version": "1.0",
        "keyword": keyword,
        "content_type": content_type,
        "pipeline_id": pipeline_id,
        "created_at": datetime.now().isoformat(),
        "status": "ready_for_publish",
        "image_set": {
            "framework": "/share-card",
            "status": "ready" if card_files else "no_images",
            "files": card_files,
        },
        "article": {
            "path": "article/article.md",
            "status": "ready" if (out_dir / "article" / "article.md").exists() else "missing",
        },
        "copy": {
            "path": "cards/copy.md",
            "status": "ready" if (out_dir / "cards" / "copy.md").exists() else "missing",
        },
        "platforms": {
            "image": ["douyin", "kuaishou", "xiaohongshu", "weibo"],
            "article": ["wechat", "zhihu", "toutiao"],
        },
    }

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # NAS 上传
    export_path = None
    if pipeline_id:
        nas_result = upload_to_nas(str(out_dir), pipeline_id)
        if nas_result["success"]:
            export_path = nas_result["nas_path"]
        else:
            logger.warning("[export] NAS 上传失败（不阻断流程）: %s", nas_result.get("error"))
    else:
        logger.warning("[export] NAS 上传跳过：无 pipeline_id")

    logger.info("[export] 完成: %d 张卡片 + manifest → %s", len(card_files), out_dir)

    return {
        "success": True,
        "manifest_path": str(manifest_path),
        "card_count": len(card_files),
        "card_files": card_files,
        "export_path": export_path,
    }
