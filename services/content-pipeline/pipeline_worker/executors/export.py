"""Stage 6: 导出 — rsync 到 NAS + manifest.json

将产出物归档并上传到 NAS，生成 manifest.json。
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from ..artifact_paths import owned_directory, owned_file, guard

from ..nas_uploader import upload_to_nas

logger = logging.getLogger("pipeline-worker.export")




def execute_export(run_data: dict) -> dict:
    """执行导出阶段。

    Args:
        run_data: {keyword, content_type, pipeline_id, ...}

    Returns:
        {success: bool, manifest_path?: str, card_count: int, export_path?: str, error?: str}
    """
    from ._fake import fake_output_dir, is_fake_mode

    keyword = run_data.get("keyword", "")
    content_type = run_data.get("content_type", "solo-company-case")
    pipeline_id = run_data.get("pipeline_id")

    # PR-e/5 端到端 CI fake 模式：跳过 rsync 到 NAS，只产一个本地 manifest
    if is_fake_mode():
        import json as _json

        out_dir = fake_output_dir(run_data, "export")
        manifest = {
            "keyword": keyword,
            "content_type": content_type,
            "pipeline_id": pipeline_id,
            "fake": True,
            "cards": [],
        }
        manifest_path = Path(out_dir) / "manifest.json"
        manifest_path.write_text(_json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        logger.info("[export] fake mode: skipping NAS upload, manifest=%s", manifest_path)
        return {
            "success": True,
            "manifest_path": str(manifest_path),
            "card_count": 0,
            "export_path": out_dir,
            "output_dir": out_dir,
        }

    logger.info("[export] 开始: %s", keyword)

    try:
        guard(run_data)
        out_dir = owned_directory(run_data)
        manifest_path = owned_file(run_data, 'manifest.json')
    except ValueError as error:
        return {'success': False, 'error': str(error)}
    if not out_dir.is_dir():
        return {"success": False, "error": "找不到产出目录"}

    # 只收集本 run 目录中的产物，拒绝借用同主题历史图片。
    card_files = []
    cards_dir = owned_file(run_data, 'cards')
    if cards_dir.is_dir():
        for file in sorted(cards_dir.glob('*.png')):
            owned_file(run_data, 'cards/' + file.name)
            card_files.append(file.name)
    owned_file(run_data, 'article/article.md')
    owned_file(run_data, 'cards/copy.md')

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

    manifest_path = owned_file(run_data, "manifest.json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # NAS 上传
    export_path = None
    if pipeline_id:
        guard(run_data)
        nas_result = upload_to_nas(str(out_dir), pipeline_id, execution_guard=run_data.get("execution_guard"))
        guard(run_data)
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
