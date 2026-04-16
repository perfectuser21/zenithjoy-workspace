"""topic-worker 挑选逻辑单测（mock DB）。

- 默认 daily_limit = 1
- 优先级排序（priority ASC, created_at ASC）
- 只挑 status='已通过' 的
- 只挑 scheduled_date<=today 或 NULL
- env TOPIC_DAILY_LIMIT 覆盖配置
- limit=0 不挑任何
- soft-deleted 不挑
- dry-run 不修改 DB
"""

from __future__ import annotations

import importlib
import importlib.util
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# PR-b 起 topics 模块转发到 apps/api，不再保有 ensure_schema 的 SQLite 建表逻辑，
# 本测试直接跑 migration SQL 建表（worker 属 PR-c scope，当前仍直连 SQLite）。
MIGRATION_SQL = (ROOT / "migrations" / "001_create_topics.sql").read_text(encoding="utf-8")


def _ensure_topics_schema(db: Path) -> None:
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db)
    try:
        conn.executescript(MIGRATION_SQL)
        conn.commit()
    finally:
        conn.close()


# 加载 topic-worker（带连字符）
WORKER_PATH = ROOT / "scripts" / "topic-worker.py"
spec = importlib.util.spec_from_file_location("topic_worker", WORKER_PATH)
assert spec and spec.loader
topic_worker = importlib.util.module_from_spec(spec)
sys.modules["topic_worker"] = topic_worker
spec.loader.exec_module(topic_worker)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture()
def db_path(tmp_path):
    db = tmp_path / "creator.db"
    _ensure_topics_schema(db)
    return db


def _insert(db_path: Path, **fields) -> str:
    """插入 topic 并返回 id；使用合理默认值。"""
    import uuid

    now = _now_iso()
    defaults = {
        "id": str(uuid.uuid4()),
        "title": "T",
        "angle": None,
        "priority": 100,
        "status": "已通过",
        "target_platforms": '["xiaohongshu"]',
        "scheduled_date": None,
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    defaults.update(fields)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO topics
                (id, title, angle, priority, status, target_platforms,
                 scheduled_date, created_at, updated_at, deleted_at)
            VALUES (:id, :title, :angle, :priority, :status, :target_platforms,
                    :scheduled_date, :created_at, :updated_at, :deleted_at)
            """,
            defaults,
        )
        conn.commit()
    finally:
        conn.close()
    return defaults["id"]


def test_default_daily_limit_is_one(db_path, monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)
    conn = sqlite3.connect(db_path)
    try:
        assert topic_worker.get_daily_limit(conn) == 1
    finally:
        conn.close()


def test_env_override_limit(db_path, monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "5")
    conn = sqlite3.connect(db_path)
    try:
        assert topic_worker.get_daily_limit(conn) == 5
    finally:
        conn.close()


def test_pacing_config_override(db_path, monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE pacing_config SET value = '3' WHERE key = 'daily_limit'"
        )
        conn.commit()
        assert topic_worker.get_daily_limit(conn) == 3
    finally:
        conn.close()


def test_select_only_approved(db_path):
    _insert(db_path, title="待研究", status="待研究")
    _insert(db_path, title="已通过", status="已通过")
    _insert(db_path, title="研究中", status="研究中")
    conn = sqlite3.connect(db_path)
    try:
        topics = topic_worker.select_topics(conn, limit=10)
        assert [t["title"] for t in topics] == ["已通过"]
    finally:
        conn.close()


def test_priority_order(db_path):
    _insert(db_path, title="低", priority=50)
    _insert(db_path, title="高", priority=10)
    _insert(db_path, title="中", priority=30)
    conn = sqlite3.connect(db_path)
    try:
        topics = topic_worker.select_topics(conn, limit=10)
        assert [t["title"] for t in topics] == ["高", "中", "低"]
    finally:
        conn.close()


def test_scheduled_date_filter(db_path):
    _insert(db_path, title="未来", scheduled_date="2099-01-01")
    _insert(db_path, title="今日", scheduled_date="2026-04-15")
    _insert(db_path, title="过去", scheduled_date="2020-01-01")
    _insert(db_path, title="无日期", scheduled_date=None)

    conn = sqlite3.connect(db_path)
    try:
        topics = topic_worker.select_topics(conn, limit=10, today="2026-04-15")
        titles = sorted(t["title"] for t in topics)
        assert titles == ["今日", "无日期", "过去"]
    finally:
        conn.close()


def test_limit_zero_returns_empty(db_path):
    _insert(db_path, title="X")
    conn = sqlite3.connect(db_path)
    try:
        assert topic_worker.select_topics(conn, limit=0) == []
    finally:
        conn.close()


def test_soft_deleted_excluded(db_path):
    _insert(db_path, title="活的")
    _insert(db_path, title="软删的", deleted_at=_now_iso())
    conn = sqlite3.connect(db_path)
    try:
        topics = topic_worker.select_topics(conn, limit=10)
        assert [t["title"] for t in topics] == ["活的"]
    finally:
        conn.close()


def test_run_dry_run_does_not_mutate(db_path):
    tid = _insert(db_path, title="X")
    summary = topic_worker.run(db_path, apply=False)
    assert summary["selected"] == 1
    assert summary["apply"] is False
    assert summary["results"][0]["dry_run"] is True

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute("SELECT status FROM topics WHERE id = ?", (tid,))
        assert cur.fetchone()[0] == "已通过"
    finally:
        conn.close()


def test_run_apply_marks_in_progress(db_path, monkeypatch):
    """模拟 dispatch 成功，确认 status 被改为'研究中'。"""
    tid = _insert(db_path, title="X")

    def fake_dispatch(api_base, topic, timeout=30):
        return {"id": "fake-pipeline-id-001"}

    monkeypatch.setattr(topic_worker, "dispatch_pipeline", fake_dispatch)
    summary = topic_worker.run(db_path, apply=True, api_base="http://stub")

    assert summary["results"][0]["dispatched"] is True
    assert summary["results"][0]["pipeline_id"] == "fake-pipeline-id-001"

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute(
            "SELECT status, pipeline_id FROM topics WHERE id = ?", (tid,)
        )
        row = cur.fetchone()
        assert row[0] == "研究中"
        assert row[1] == "fake-pipeline-id-001"
    finally:
        conn.close()


def test_run_apply_dispatch_failure_keeps_status(db_path, monkeypatch):
    tid = _insert(db_path, title="X")

    def fake_dispatch(api_base, topic, timeout=30):
        raise topic_worker.urllib.error.URLError("connection refused")

    monkeypatch.setattr(topic_worker, "dispatch_pipeline", fake_dispatch)
    summary = topic_worker.run(db_path, apply=True, api_base="http://stub")

    assert summary["results"][0]["dispatched"] is False
    assert "error" in summary["results"][0]

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.execute("SELECT status FROM topics WHERE id = ?", (tid,))
        assert cur.fetchone()[0] == "已通过"  # 未变
    finally:
        conn.close()
