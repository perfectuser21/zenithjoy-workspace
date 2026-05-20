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
from pipeline_worker.graph import build_graph  # noqa: E402

# ─── 日志 ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipeline-worker")

# 阶段定义：(名称, cecelia 资源类型, 执行函数)
# 保留 STAGES 作为向后兼容的元数据（旧测试套件按 stage 顺序 patch）。
# 真正的调度走 pipeline_worker.graph.build_graph()。
STAGES: list[tuple[str, str | None, callable]] = [
    ("research", "notebooklm", execute_research),
    ("copywriting", "llm", execute_copywriting),
    ("copy_review", None, execute_copy_review),
    ("generate", "image-gen", execute_generate),
    ("image_review", None, execute_image_review),
    ("export", None, execute_export),
]


def _stage_defs_from_module():
    """读取本 module 的 STAGES（允许 monkeypatch）→ 返回当前生效的 (name,rtype,executor) 列表。"""
    return list(STAGES)


def process_pipeline(
    client: ZenithJoyClient,
    pipeline: dict,
    dry_run: bool = True,
) -> bool:
    """处理单个 pipeline，6 阶段由 LangGraph 编排。

    Returns:
        True if completed, False if failed.
    """
    pid = pipeline["id"]
    # PR-e/5: apps/api /api/pipelines/running 已经 COALESCE(topic.title, pr.topic) 返回 keyword
    # 这里优先用 topic_title（真选题 SoT），退回 keyword（来自 SQL coalesce），再退回 'unknown'
    keyword = (
        pipeline.get("topic_title")
        or pipeline.get("keyword")
        or pipeline.get("topic")
        or "unknown"
    )
    topic_id = pipeline.get("topic_id")
    current_stage = pipeline.get("current_stage") or ""

    logger.info(
        "处理 pipeline %s: keyword=%s, current_stage=%s",
        str(pid)[:8], keyword, current_stage or "(起始)",
    )

    if dry_run:
        logger.info("[dry-run] 跳过执行: %s", keyword)
        return True

    # 构建初始 state（与原 run_data 字段同义）
    # 阶段 A+：notebook_id 来自 apps/api /running 端点（COALESCE pr.notebook_id, t.notebook_id）。
    # 若 API 未下发，研究 executor 内部再 fallback env CREATOR_DEFAULT_NOTEBOOK_ID（兼容老 DEFAULT_NOTEBOOK_ID）。
    initial_state: dict = {
        "pipeline_id": pid,
        "keyword": keyword,
        "topic_id": topic_id,
        "content_type": pipeline.get("content_type") or "solo-company-case",
        "notebook_id": pipeline.get("notebook_id")
        or os.environ.get("CREATOR_DEFAULT_NOTEBOOK_ID")
        or os.environ.get("DEFAULT_NOTEBOOK_ID"),
        "completed_stages": [],
    }
    if pipeline.get("output_dir"):
        initial_state["output_dir"] = pipeline["output_dir"]

    # Resume：根据 current_stage 把已完成 stage 写入 completed_stages，
    # graph node 内部据此跳过（保持幂等）。
    stage_names = [s[0] for s in _stage_defs_from_module()]
    if current_stage in stage_names:
        idx = stage_names.index(current_stage)
        initial_state["completed_stages"] = stage_names[: idx + 1]

    # 构建 graph 并执行（client/can_run 闭包注入；测试可 patch worker.can_run / worker.STAGES）
    graph = build_graph(
        client,
        dry_run=False,
        can_run_fn=can_run,
        stage_defs=_stage_defs_from_module(),
    )

    try:
        final_state: dict = graph.invoke(
            initial_state,
            config={"configurable": {"thread_id": str(pid)}},
        )
    except ZenithJoyAPIError as e:
        # 401/403 由 graph node 直接 raise，让上层 main() 转 exit 3
        if e.status_code in (401, 403):
            raise
        logger.error("graph 执行抛出 APIError：%s", e)
        _safe_fail(client, pid, f"graph 执行异常: {e}")
        return False
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        logger.error("graph 执行未捕获异常：%s\n%s", e, tb)
        _safe_fail(client, pid, f"graph 执行未捕获异常: {e}")
        return False

    # 失败终态：在 graph 内只标记 error，由 worker 调 fail_pipeline 上报
    if final_state.get("error"):
        _safe_fail(
            client,
            pid,
            final_state.get("error", "未知错误"),
            stage=final_state.get("failed_stage"),
        )
        return False

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
