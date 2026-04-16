#!/usr/bin/env python3
"""Pipeline Worker — 轮询 apps/api /api/pipelines/running，执行 6 阶段。

PR-c 起：本 worker 不再直连 SQLite，全部改走 apps/api HTTP 端点。

用法：
    python3 worker.py           # dry-run，只打印待处理的 pipeline
    python3 worker.py --apply   # 真正执行

环境变量：
    APPS_API_BASE               apps/api 地址（默认 http://localhost:5200；兼容 CREATOR_API_BASE）
    ZENITHJOY_INTERNAL_TOKEN    内部 API 鉴权 token（401/403 → 本轮退出，不崩溃）
    BRAIN_URL                   Cecelia Brain 地址（默认 http://localhost:5221）
    CONTENT_OUTPUT_DIR          内容产出目录
    DEFAULT_NOTEBOOK_ID         NotebookLM 默认 notebook

阶段：
    1. research      — NotebookLM 调研
    2. copywriting   — LLM 文案生成
    3. copy_review   — 品牌/禁用词审查
    4. generate      — 图片生成
    5. image_review  — 图片完整性/尺寸审查
    6. export        — rsync 到 NAS + manifest.json

Brain Task: fff07775-ce14-45cd-b4ee-2be074353267
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import traceback
from pathlib import Path

# 添加父路径以支持相对导入
sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.http_client import ZenithJoyAPIError, ZenithJoyClient  # noqa: E402
from pipeline_worker.cecelia_client import can_run  # noqa: E402
from pipeline_worker.executors.copy_review import execute_copy_review  # noqa: E402
from pipeline_worker.executors.copywriting import execute_copywriting  # noqa: E402
from pipeline_worker.executors.export import execute_export  # noqa: E402
from pipeline_worker.executors.generate import execute_generate  # noqa: E402
from pipeline_worker.executors.image_review import execute_image_review  # noqa: E402
from pipeline_worker.executors.research import execute_research  # noqa: E402

# ─── 日志 ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipeline-worker")

# 阶段定义：(名称, cecelia 资源类型, 执行函数)
STAGES: list[tuple[str, str | None, callable]] = [
    ("research", "notebooklm", execute_research),
    ("copywriting", "llm", execute_copywriting),
    ("copy_review", None, execute_copy_review),
    ("generate", "image-gen", execute_generate),
    ("image_review", None, execute_image_review),
    ("export", None, execute_export),
]


def process_pipeline(
    client: ZenithJoyClient,
    pipeline: dict,
    dry_run: bool = True,
) -> bool:
    """处理单个 pipeline，执行 6 阶段。

    Returns:
        True if completed, False if failed.
    """
    pid = pipeline["id"]
    keyword = pipeline.get("keyword") or pipeline.get("topic") or "unknown"
    topic_id = pipeline.get("topic_id")
    current_stage = pipeline.get("current_stage") or ""

    logger.info(
        "处理 pipeline %s: keyword=%s, current_stage=%s",
        str(pid)[:8], keyword, current_stage or "(起始)",
    )

    if dry_run:
        logger.info("[dry-run] 跳过执行: %s", keyword)
        return True

    # 构建执行上下文（executors 只吃 run_data dict，不感知 DB/HTTP）
    run_data = {
        "keyword": keyword,
        "pipeline_id": pid,
        "topic_id": topic_id,
        "content_type": pipeline.get("content_type") or "solo-company-case",
        "notebook_id": os.environ.get("DEFAULT_NOTEBOOK_ID"),
    }
    if pipeline.get("output_dir"):
        run_data["output_dir"] = pipeline["output_dir"]

    # 确定起始阶段
    stage_names = [s[0] for s in STAGES]
    start_idx = 0
    if current_stage in stage_names:
        start_idx = stage_names.index(current_stage) + 1

    for i in range(start_idx, len(STAGES)):
        stage_name, resource_type, executor = STAGES[i]
        logger.info("─── 阶段 %d/6: %s ───", i + 1, stage_name)

        # 询问 Cecelia 是否可执行
        if resource_type:
            cr = can_run(resource_type)
            if not cr.get("approved", True):
                retry_after = cr.get("retry_after")
                msg = f"Cecelia 拒绝 {resource_type}: {cr.get('reason')}"
                if retry_after:
                    msg += f"（建议 {retry_after}s 后重试）"
                _safe_fail(client, pid, msg, stage=stage_name)
                return False

        # 执行 executor
        try:
            result = executor(run_data)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error("阶段 %s 异常: %s\n%s", stage_name, e, tb)
            _safe_fail(client, pid, f"阶段 {stage_name} 异常: {e}", stage=stage_name)
            return False

        if not result.get("success", False):
            error = result.get("error", f"阶段 {stage_name} 失败")
            _safe_fail(client, pid, error, stage=stage_name)
            return False

        # copy_review / image_review 失败 → pipeline 失败
        if "review_passed" in result and not result["review_passed"]:
            issues = result.get("issues", [])
            _safe_fail(
                client,
                pid,
                f"审查未通过: {'; '.join(issues)}",
                stage=stage_name,
            )
            return False

        # 把结果合并到 run_data 供后续阶段使用
        stage_output: dict[str, object] = {}
        for k in ("output_dir", "findings_path", "export_path"):
            if result.get(k):
                stage_output[k] = result[k]
                run_data[k] = result[k]

        is_final = (i == len(STAGES) - 1)  # export 阶段 = 终态
        stage_output_for_api = stage_output or None
        if is_final:
            # 终态：合并 manifest.json 到 output_manifest
            manifest = _read_manifest(run_data.get("output_dir"))
            if manifest:
                stage_output_for_api = {**(stage_output or {}), **manifest}

        try:
            client.stage_complete(
                pid,
                stage_name,
                output=stage_output_for_api,
                is_final=is_final,
            )
        except ZenithJoyAPIError as e:
            logger.error(
                "stage-complete 上报失败（stage=%s, pipeline=%s）：%s",
                stage_name, str(pid)[:8], e,
            )
            # 上报失败不中断执行，记录即可；pipeline 下轮仍可被拉起
            if e.status_code in (401, 403):
                raise
            return False

        logger.info("阶段 %s 完成", stage_name)

    logger.info("pipeline %s 全部阶段完成", str(pid)[:8])
    return True


def _read_manifest(output_dir: object) -> dict | None:
    if not output_dir:
        return None
    try:
        manifest_path = Path(str(output_dir)) / "manifest.json"
        if not manifest_path.exists():
            return None
        return json.loads(manifest_path.read_text("utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("读 manifest.json 失败：%s", e)
        return None


def _safe_fail(
    client: ZenithJoyClient,
    pipeline_id: str,
    error: str,
    *,
    stage: str | None = None,
) -> None:
    """调 /fail；网络错误不再冒泡（失败转 warning）。"""
    try:
        client.fail_pipeline(pipeline_id, error, stage=stage)
    except ZenithJoyAPIError as e:
        logger.error("fail_pipeline 上报失败：%s（原始错误：%s）", e, error)
        if e.status_code in (401, 403):
            raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipeline Worker — 6 阶段内容执行器")
    parser.add_argument("--apply", action="store_true", help="真正执行（默认 dry-run）")
    parser.add_argument(
        "--api-base",
        default=None,
        help="apps/api 地址；默认从 env APPS_API_BASE / CREATOR_API_BASE 读",
    )
    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run:
        logger.info("=== DRY-RUN 模式（加 --apply 真正执行）===")

    if args.api_base:
        token = os.environ.get("ZENITHJOY_INTERNAL_TOKEN")
        client = ZenithJoyClient(base_url=args.api_base, token=token)
    else:
        client = ZenithJoyClient.from_env()

    try:
        try:
            pipelines = client.list_running_pipelines()
        except ZenithJoyAPIError as e:
            if e.status_code in (401, 403):
                logger.error(
                    "apps/api 鉴权失败（%s），请检查 ZENITHJOY_INTERNAL_TOKEN",
                    e.status_code,
                )
                return 3
            logger.warning("list_running_pipelines 失败，本轮退出等待下一轮：%s", e)
            return 0

        if not pipelines:
            logger.info("无待处理的 pipeline（status=running），退出")
            return 0

        logger.info("发现 %d 个 running pipeline", len(pipelines))

        completed = 0
        failed = 0
        for p in pipelines:
            try:
                ok = process_pipeline(client, p, dry_run=dry_run)
            except ZenithJoyAPIError as e:
                if e.status_code in (401, 403):
                    logger.error("鉴权失败中断处理：%s", e)
                    return 3
                logger.error("pipeline %s 处理异常：%s", str(p.get("id"))[:8], e)
                failed += 1
                continue
            if ok:
                completed += 1
            else:
                failed += 1

        logger.info("执行完毕: completed=%d, failed=%d", completed, failed)
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
