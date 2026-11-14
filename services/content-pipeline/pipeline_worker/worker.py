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
import socket
from uuid import uuid4
import traceback
from pathlib import Path

# 添加父路径以支持相对导入
sys.path.insert(0, str(Path(__file__).parent.parent))

from lib.http_client import ZenithJoyAPIError, ZenithJoyClient  # noqa: E402
from pipeline_worker.cecelia_client import can_run  # noqa: E402
from pipeline_worker.brain_tasks import BrainTaskClient, CoordinationUnknown, LeaseHeartbeat  # noqa: E402
from pipeline_worker.polling import state_directory, poll_page, recover_terminals  # noqa: E402
from pipeline_worker.terminal_checkpoint import (checkpoint_path, load_checkpoint,
    save_checkpoint, settle_checkpoint)  # noqa: E402
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


class BoundPipelineClient:
    """阶段写入携带同一租约；最终副作用交 worker 在 Brain 回执后提交。"""
    def __init__(self, client, identity, lease):
        self.client = client
        self.identity = identity
        self.lease = lease
        self.final = None

    def stage_complete(self, pipeline_id, stage, *, output=None, is_final=False):
        self.lease.check()
        if is_final:
            self.final = {'stage': stage, 'output': output or {}}
            return {}
        try:
            return self.client.stage_complete(pipeline_id, stage, output=output,
                is_final=False, identity=self.identity)
        except ZenithJoyAPIError as error:
            if error.status_code in (401, 403):
                raise
            raise CoordinationUnknown('ZJ 阶段回执未确认，禁止推进') from error


def process_pipeline(client: ZenithJoyClient, pipeline: dict, dry_run: bool = True,
                     *, brain_client=None, checkpoint_dir=None, heartbeat_interval=30) -> bool:
    """先领取 Brain 有限租约，再执行业务；未知回执仅重放终态、不重跑阶段。"""
    pid = pipeline['id']
    if dry_run:
        logger.info('[dry-run] pipeline %s 跳过执行', str(pid)[:8])
        return True
    task_id = pipeline.get('cecelia_task_id')
    if not task_id:
        logger.warning('pipeline %s 缺 Brain 工作单，禁止执行', str(pid)[:8])
        return False
    brain = brain_client or BrainTaskClient()
    lease = None
    try:
        path = checkpoint_path(task_id, checkpoint_dir if checkpoint_dir is not None else state_directory(client, brain))
        if path.exists():
            return settle_checkpoint(brain, client, path, load_checkpoint(path, pipeline))
        # 有旧 claim 但无终态材料：不能接管一个可能仍在运行的执行者。
        if (pipeline.get('output_manifest') or {}).get('brain_claim'):
            logger.warning('pipeline %s 已有认领但无终态恢复材料，不重复执行', str(pid)[:8])
            return False
        claimer = f'zj-content:{socket.gethostname()}:{os.getpid()}:{uuid4().hex}'
        identity = brain.claim(task_id, claimer, 300)
        lease = LeaseHeartbeat(brain, identity, seconds=300, interval=heartbeat_interval)
        lease.start()
        client.claim_pipeline(pid, identity)
        bound = BoundPipelineClient(client, identity, lease)
        names = [stage[0] for stage in _stage_defs_from_module()]
        current = pipeline.get('current_stage') or ''
        state = {
            'pipeline_id': pid,
            'keyword': pipeline.get('topic_title') or pipeline.get('keyword') or pipeline.get('topic') or 'unknown',
            'topic_id': pipeline.get('topic_id'),
            'content_type': pipeline.get('content_type') or 'solo-company-case',
            'notebook_id': pipeline.get('notebook_id') or os.environ.get('CREATOR_DEFAULT_NOTEBOOK_ID') or os.environ.get('DEFAULT_NOTEBOOK_ID'),
            'completed_stages': names[:names.index(current) + 1] if current in names else [],
        }
        if pipeline.get('output_dir'):
            state['output_dir'] = pipeline['output_dir']
        graph = build_graph(bound, dry_run=False, can_run_fn=can_run,
            stage_defs=_stage_defs_from_module(), execution_guard=lease.check)
        final = graph.invoke(state, config={'configurable': {'thread_id': str(pid)}})
        lease.check(refresh=True)
        lease.stop()
        lease = None
        error = final.get('error')
        record = {'pipeline_id': pid, 'identity': identity}
        if error:
            stage = final.get('failed_stage')
            result = {'pipeline_id': pid, 'error': error, 'stage': stage}
            record.update(status='failed', error=error, stage=stage, result=result)
        else:
            if bound.final is None:
                raise CoordinationUnknown('缺少最终产物回执，不自动标为成功')
            output = bound.final['output']
            result = {'pipeline_id': pid, 'output_manifest': output}
            record.update(status='completed', stage=bound.final['stage'], output=output, result=result)
        save_checkpoint(path, record)
        return settle_checkpoint(brain, client, path, record)
    except ZenithJoyAPIError as error:
        logger.error('pipeline %s 协同未确认：%s', str(pid)[:8], error)
        if error.status_code in (401, 403):
            raise
        return False
    except Exception as error:
        # 网络/租约未知不可转成内容失败，也不可再执行业务或覆盖终态。
        logger.error('pipeline %s 停止推进：%s', str(pid)[:8], error)
        return False
    finally:
        if lease is not None:
            try:
                lease.stop()
            except CoordinationUnknown as error:
                logger.warning('续约停止未确认：%s', error)
        if brain_client is None:
            brain.close()


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
        if not dry_run:
            recover_terminals(client)
        try:
            pipelines = poll_page(client)
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
