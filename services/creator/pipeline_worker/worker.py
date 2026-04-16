#!/usr/bin/env python3
"""Pipeline Worker — 轮询 pipeline_runs WHERE status='running'，执行 6 阶段。

用法：
    python3 worker.py           # dry-run，只打印待处理的 pipeline
    python3 worker.py --apply   # 真正执行

环境变量：
    CREATOR_API_BASE  — Creator API 地址（默认 http://localhost:8899）
    BRAIN_URL         — Cecelia Brain 地址（默认 http://localhost:5221）
    CONTENT_OUTPUT_DIR — 内容产出目录

阶段：
    1. research      — NotebookLM 调研
    2. copywriting   — LLM 文案生成
    3. copy_review   — 品牌/禁用词审查
    4. generate      — 图片生成
    5. image_review  — 图片完整性/尺寸审查
    6. export        — rsync 到 NAS + manifest.json
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# 添加父路径以支持相对导入
sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline_worker.cecelia_client import can_run
from pipeline_worker.executors.research import execute_research
from pipeline_worker.executors.copywriting import execute_copywriting
from pipeline_worker.executors.copy_review import execute_copy_review
from pipeline_worker.executors.generate import execute_generate
from pipeline_worker.executors.image_review import execute_image_review
from pipeline_worker.executors.export import execute_export

# ─── 日志 ───────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipeline-worker")

# ─── 配置 ───────────────────────────────────────────────
CREATOR_API_BASE = os.environ.get("CREATOR_API_BASE", "http://localhost:8899")
DB_PATH = Path(__file__).parent.parent / "data" / "creator.db"

# 阶段定义：(名称, cecelia 资源类型, 执行函数)
STAGES: list[tuple[str, str | None, callable]] = [
    ("research", "notebooklm", execute_research),
    ("copywriting", "llm", execute_copywriting),
    ("copy_review", None, execute_copy_review),
    ("generate", "image-gen", execute_generate),
    ("image_review", None, execute_image_review),
    ("export", None, execute_export),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_pipeline_runs_table(conn: sqlite3.Connection) -> None:
    """确保 pipeline_runs 表存在（首次运行时自动创建）。"""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id TEXT PRIMARY KEY,
            topic_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running'
                CHECK(status IN ('running', 'completed', 'failed')),
            current_stage TEXT,
            error_message TEXT,
            output_manifest TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_pipeline_runs_topic ON pipeline_runs(topic_id)")
    conn.commit()


def _ensure_topics_has_waiting_status(conn: sqlite3.Connection) -> None:
    """确保 topics 表的 status CHECK 约束包含'待发布'。
    SQLite 不支持 ALTER CHECK，用 PRAGMA 检查并在必要时重建表。
    """
    # 检查是否已包含'待发布'
    cur = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='topics'")
    row = cur.fetchone()
    if row and "待发布" not in (row[0] or ""):
        logger.info("topics 表需添加'待发布'状态，执行表重建...")
        conn.executescript("""
            BEGIN;
            ALTER TABLE topics RENAME TO topics_old;
            CREATE TABLE topics (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                angle TEXT,
                priority INTEGER NOT NULL DEFAULT 100,
                status TEXT NOT NULL DEFAULT '待研究'
                    CHECK(status IN ('待研究', '已通过', '研究中', '待发布', '已发布', '已拒绝')),
                target_platforms TEXT NOT NULL DEFAULT '["xiaohongshu","douyin","kuaishou","shipinhao","x","toutiao","weibo","wechat"]',
                scheduled_date TEXT,
                pipeline_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                published_at TEXT,
                deleted_at TEXT
            );
            INSERT INTO topics SELECT * FROM topics_old;
            DROP TABLE topics_old;
            CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
            CREATE INDEX IF NOT EXISTS idx_topics_priority ON topics(priority);
            CREATE INDEX IF NOT EXISTS idx_topics_scheduled_date ON topics(scheduled_date);
            CREATE INDEX IF NOT EXISTS idx_topics_deleted_at ON topics(deleted_at);
            COMMIT;
        """)
        logger.info("topics 表重建完成，已添加'待发布'状态")


def fetch_running_pipelines(conn: sqlite3.Connection) -> list[dict]:
    """获取所有 status='running' 的 pipeline_runs。"""
    cur = conn.execute("""
        SELECT pr.id, pr.topic_id, pr.status, pr.current_stage,
               pr.started_at, pr.created_at,
               t.title as keyword, t.angle, t.status as topic_status
        FROM pipeline_runs pr
        LEFT JOIN topics t ON pr.topic_id = t.id
        WHERE pr.status = 'running'
        ORDER BY pr.created_at ASC
    """)
    return [dict(row) for row in cur.fetchall()]


def update_pipeline_stage(conn: sqlite3.Connection, pipeline_id: str, stage: str) -> None:
    conn.execute(
        "UPDATE pipeline_runs SET current_stage = ?, updated_at = ? WHERE id = ?",
        (stage, _now_iso(), pipeline_id),
    )
    conn.commit()


def complete_pipeline(conn: sqlite3.Connection, pipeline_id: str, topic_id: str, manifest: dict | None) -> None:
    now = _now_iso()
    manifest_json = json.dumps(manifest, ensure_ascii=False) if manifest else None
    conn.execute(
        "UPDATE pipeline_runs SET status = 'completed', completed_at = ?, output_manifest = ?, updated_at = ? WHERE id = ?",
        (now, manifest_json, now, pipeline_id),
    )
    # 更新 topic 状态为'待发布'
    conn.execute(
        "UPDATE topics SET status = '待发布', updated_at = ? WHERE id = ?",
        (now, topic_id),
    )
    conn.commit()
    logger.info("pipeline %s 完成，topic %s → 待发布", pipeline_id[:8], topic_id[:8])


def fail_pipeline(conn: sqlite3.Connection, pipeline_id: str, error: str) -> None:
    now = _now_iso()
    conn.execute(
        "UPDATE pipeline_runs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?",
        (error, now, now, pipeline_id),
    )
    # topic 保持'研究中'不变
    conn.commit()
    logger.error("pipeline %s 失败: %s", pipeline_id[:8], error)


def process_pipeline(conn: sqlite3.Connection, pipeline: dict, dry_run: bool = True) -> bool:
    """处理单个 pipeline，执行 6 阶段。

    Returns:
        True if completed, False if failed.
    """
    pid = pipeline["id"]
    keyword = pipeline.get("keyword") or "unknown"
    topic_id = pipeline["topic_id"]
    current_stage = pipeline.get("current_stage") or ""

    logger.info("处理 pipeline %s: keyword=%s, current_stage=%s", pid[:8], keyword, current_stage or "(起始)")

    if dry_run:
        logger.info("[dry-run] 跳过执行: %s", keyword)
        return True

    # 构建执行上下文
    run_data = {
        "keyword": keyword,
        "pipeline_id": pid,
        "topic_id": topic_id,
        "content_type": "solo-company-case",
        "notebook_id": os.environ.get("DEFAULT_NOTEBOOK_ID"),
    }

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
                fail_pipeline(conn, pid, msg)
                return False

        # 更新当前阶段
        update_pipeline_stage(conn, pid, stage_name)

        # 执行
        try:
            result = executor(run_data)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error("阶段 %s 异常: %s\n%s", stage_name, e, tb)
            fail_pipeline(conn, pid, f"阶段 {stage_name} 异常: {e}")
            return False

        if not result.get("success", False):
            error = result.get("error", f"阶段 {stage_name} 失败")
            fail_pipeline(conn, pid, error)
            return False

        # copy_review / image_review 失败 → pipeline 失败
        if "review_passed" in result and not result["review_passed"]:
            issues = result.get("issues", [])
            fail_pipeline(conn, pid, f"审查未通过: {'; '.join(issues)}")
            return False

        # 把结果合并到 run_data 供后续阶段使用
        if result.get("output_dir"):
            run_data["output_dir"] = result["output_dir"]
        if result.get("findings_path"):
            run_data["findings_path"] = result["findings_path"]
        if result.get("export_path"):
            run_data["export_path"] = result["export_path"]

        logger.info("阶段 %s 完成", stage_name)

    # 所有阶段完成
    manifest = None
    if run_data.get("output_dir"):
        manifest_path = Path(run_data["output_dir"]) / "manifest.json"
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                pass

    complete_pipeline(conn, pid, topic_id, manifest)
    return True


def main():
    parser = argparse.ArgumentParser(description="Pipeline Worker — 6 阶段内容执行器")
    parser.add_argument("--apply", action="store_true", help="真正执行（默认 dry-run）")
    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run:
        logger.info("=== DRY-RUN 模式（加 --apply 真正执行）===")

    if not DB_PATH.exists():
        logger.warning("数据库不存在: %s，跳过", DB_PATH)
        return

    conn = get_db()

    # 确保表结构
    _ensure_pipeline_runs_table(conn)
    _ensure_topics_has_waiting_status(conn)

    # 获取待处理的 pipeline
    pipelines = fetch_running_pipelines(conn)
    if not pipelines:
        logger.info("无待处理的 pipeline（status=running），退出")
        conn.close()
        return

    logger.info("发现 %d 个 running pipeline", len(pipelines))

    completed = 0
    failed = 0
    for p in pipelines:
        ok = process_pipeline(conn, p, dry_run=dry_run)
        if ok:
            completed += 1
        else:
            failed += 1

    logger.info("执行完毕: completed=%d, failed=%d", completed, failed)
    conn.close()


if __name__ == "__main__":
    main()
