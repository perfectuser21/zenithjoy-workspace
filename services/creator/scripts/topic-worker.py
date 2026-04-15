#!/usr/bin/env python3
"""选题池 worker — 每日按节奏从 topics 表挑 N 条建 pipeline。

挑选规则：
- status='已通过' AND deleted_at IS NULL
- AND (scheduled_date IS NULL OR scheduled_date <= today)
- ORDER BY priority ASC, created_at ASC
- LIMIT N（N = pacing_config.daily_limit，env TOPIC_DAILY_LIMIT 优先，默认 1）

行为：
- 选中后置 status='研究中'，记录 pipeline_id（可选，由 pipeline 创建接口回填）
- 真正派发 pipeline 走 apps/api 的 POST /api/pipeline/trigger（带 topic_id）
  - 默认 dry-run（只打印挑选结果），加 --apply 才真正派发
  - 派发地址通过 env CREATOR_PIPELINE_API 控制（默认 http://localhost:3001）

Brain Task: 4aac48fe-048a-4f82-9750-57e6614e0c62
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

DEFAULT_DB = Path(__file__).parent.parent / "data" / "creator.db"
DEFAULT_PIPELINE_API = "http://localhost:3001"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_daily_limit(conn: sqlite3.Connection) -> int:
    """优先 env，其次 pacing_config，默认 1。"""
    env = os.environ.get("TOPIC_DAILY_LIMIT")
    if env:
        try:
            return max(0, int(env))
        except ValueError:
            pass

    cur = conn.execute("SELECT value FROM pacing_config WHERE key = 'daily_limit'")
    row = cur.fetchone()
    if row:
        try:
            return max(0, int(row[0]))
        except (TypeError, ValueError):
            return 1
    return 1


def select_topics(
    conn: sqlite3.Connection,
    limit: int,
    today: Optional[str] = None,
) -> list[dict[str, Any]]:
    """选出今日可派发的 topic 列表。"""
    if limit <= 0:
        return []

    today = today or date.today().isoformat()
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        """
        SELECT id, title, angle, priority, status, target_platforms,
               scheduled_date, created_at
        FROM topics
        WHERE status = '已通过'
          AND deleted_at IS NULL
          AND (scheduled_date IS NULL OR scheduled_date <= ?)
        ORDER BY priority ASC, created_at ASC
        LIMIT ?
        """,
        (today, limit),
    )
    return [dict(r) for r in cur.fetchall()]


def mark_topic_in_progress(
    conn: sqlite3.Connection,
    topic_id: str,
    pipeline_id: Optional[str] = None,
) -> None:
    now = _now_iso()
    if pipeline_id:
        conn.execute(
            "UPDATE topics SET status = '研究中', pipeline_id = ?, updated_at = ? WHERE id = ?",
            (pipeline_id, now, topic_id),
        )
    else:
        conn.execute(
            "UPDATE topics SET status = '研究中', updated_at = ? WHERE id = ?",
            (now, topic_id),
        )
    conn.commit()


def dispatch_pipeline(
    api_base: str,
    topic: dict[str, Any],
    timeout: int = 30,
) -> dict[str, Any]:
    """通过 HTTP 调用 apps/api 的 POST /api/pipeline/trigger。"""
    payload = {
        "content_type": "post",
        "topic": topic.get("title"),
        "topic_id": topic.get("id"),
        "triggered_by": "topic-worker",
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{api_base.rstrip('/')}/api/pipeline/trigger",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec B310
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def run(
    db_path: Path,
    apply: bool = False,
    api_base: Optional[str] = None,
    today: Optional[str] = None,
) -> dict[str, Any]:
    """主入口；返回包含 dispatch 结果的字典（便于测试）。"""
    api_base = api_base or os.environ.get("CREATOR_PIPELINE_API", DEFAULT_PIPELINE_API)
    conn = sqlite3.connect(db_path)
    try:
        limit = get_daily_limit(conn)
        topics = select_topics(conn, limit, today=today)
        results: list[dict[str, Any]] = []

        for t in topics:
            entry: dict[str, Any] = {"topic_id": t["id"], "title": t["title"]}
            if not apply:
                entry["dispatched"] = False
                entry["dry_run"] = True
            else:
                try:
                    resp = dispatch_pipeline(api_base, t)
                    pipeline_id = (
                        resp.get("id")
                        or resp.get("pipeline_id")
                        or resp.get("data", {}).get("id")
                    )
                    mark_topic_in_progress(conn, t["id"], pipeline_id)
                    entry["dispatched"] = True
                    entry["pipeline_id"] = pipeline_id
                except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as e:
                    entry["dispatched"] = False
                    entry["error"] = str(e)
            results.append(entry)

        return {
            "limit": limit,
            "selected": len(topics),
            "apply": apply,
            "results": results,
        }
    finally:
        conn.close()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="真正派发 pipeline（默认 dry-run，只打印挑选结果）",
    )
    parser.add_argument(
        "--api-base",
        default=None,
        help="apps/api 地址；默认从 env CREATOR_PIPELINE_API 读，否则 http://localhost:3001",
    )
    parser.add_argument("--today", default=None, help="覆盖今日日期（YYYY-MM-DD），主要供测试")
    args = parser.parse_args(argv)

    if not args.db.exists():
        print(f"DB 不存在：{args.db}（先跑 apply-migrations.py）", file=sys.stderr)
        return 2

    summary = run(args.db, apply=args.apply, api_base=args.api_base, today=args.today)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
