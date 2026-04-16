"""pipeline worker 单测"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker.worker import (
    _ensure_pipeline_runs_table,
    _ensure_topics_has_waiting_status,
    fetch_running_pipelines,
    update_pipeline_stage,
    complete_pipeline,
    fail_pipeline,
    _now_iso,
)


def _create_test_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    # 创建 topics 表（初始版本不含'待发布'）
    conn.execute("""
        CREATE TABLE topics (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            angle TEXT,
            priority INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT '待研究'
                CHECK(status IN ('待研究', '已通过', '研究中', '已发布', '已拒绝')),
            target_platforms TEXT NOT NULL DEFAULT '[]',
            scheduled_date TEXT,
            pipeline_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT,
            deleted_at TEXT
        )
    """)
    conn.commit()
    return conn


class TestPipelineRunsTable(unittest.TestCase):
    def test_ensure_table_created(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            conn = sqlite3.connect(f.name)
            conn.row_factory = sqlite3.Row
            _ensure_pipeline_runs_table(conn)
            # 验证表存在
            cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_runs'")
            self.assertIsNotNone(cur.fetchone())
            conn.close()

    def test_ensure_table_idempotent(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            conn = sqlite3.connect(f.name)
            conn.row_factory = sqlite3.Row
            _ensure_pipeline_runs_table(conn)
            _ensure_pipeline_runs_table(conn)  # 第二次不报错
            conn.close()


class TestTopicsStatusMigration(unittest.TestCase):
    def test_adds_waiting_status(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            conn = _create_test_db(Path(f.name))
            # 插入一条测试数据
            conn.execute(
                "INSERT INTO topics (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                ("t1", "测试选题", "研究中", _now_iso(), _now_iso()),
            )
            conn.commit()

            _ensure_topics_has_waiting_status(conn)

            # 验证'待发布'已加入
            cur = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='topics'")
            sql = cur.fetchone()[0]
            self.assertIn("待发布", sql)

            # 验证数据完整
            cur = conn.execute("SELECT * FROM topics WHERE id = 't1'")
            row = cur.fetchone()
            self.assertEqual(row["title"], "测试选题")
            self.assertEqual(row["status"], "研究中")
            conn.close()


class TestPipelineOperations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.conn = _create_test_db(Path(self.tmp.name))
        _ensure_pipeline_runs_table(self.conn)
        _ensure_topics_has_waiting_status(self.conn)

        # 插入测试 topic
        now = _now_iso()
        self.conn.execute(
            "INSERT INTO topics (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            ("topic-1", "AI 一人公司", "研究中", now, now),
        )
        # 插入测试 pipeline_run
        self.conn.execute(
            "INSERT INTO pipeline_runs (id, topic_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("run-1", "topic-1", "running", now, now, now),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        os.unlink(self.tmp.name)

    def test_fetch_running_pipelines(self):
        pipelines = fetch_running_pipelines(self.conn)
        self.assertEqual(len(pipelines), 1)
        self.assertEqual(pipelines[0]["id"], "run-1")
        self.assertEqual(pipelines[0]["keyword"], "AI 一人公司")

    def test_update_stage(self):
        update_pipeline_stage(self.conn, "run-1", "research")
        cur = self.conn.execute("SELECT current_stage FROM pipeline_runs WHERE id = 'run-1'")
        self.assertEqual(cur.fetchone()[0], "research")

    def test_complete_pipeline(self):
        manifest = {"version": "1.0", "keyword": "AI 一人公司"}
        complete_pipeline(self.conn, "run-1", "topic-1", manifest)

        # pipeline 完成
        cur = self.conn.execute("SELECT status, output_manifest FROM pipeline_runs WHERE id = 'run-1'")
        row = cur.fetchone()
        self.assertEqual(row[0], "completed")
        self.assertIn("AI 一人公司", row[1])

        # topic 状态变为'待发布'
        cur = self.conn.execute("SELECT status FROM topics WHERE id = 'topic-1'")
        self.assertEqual(cur.fetchone()[0], "待发布")

    def test_fail_pipeline(self):
        fail_pipeline(self.conn, "run-1", "NotebookLM 超时")
        cur = self.conn.execute("SELECT status, error_message FROM pipeline_runs WHERE id = 'run-1'")
        row = cur.fetchone()
        self.assertEqual(row[0], "failed")
        self.assertIn("超时", row[1])

        # topic 保持'研究中'
        cur = self.conn.execute("SELECT status FROM topics WHERE id = 'topic-1'")
        self.assertEqual(cur.fetchone()[0], "研究中")


class TestFetchNoPipelines(unittest.TestCase):
    def test_empty_result(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            conn = sqlite3.connect(f.name)
            conn.row_factory = sqlite3.Row
            _ensure_pipeline_runs_table(conn)
            # 不创建 topics 表，模拟无数据
            conn.execute("""
                CREATE TABLE IF NOT EXISTS topics (
                    id TEXT PRIMARY KEY, title TEXT, status TEXT,
                    angle TEXT, target_platforms TEXT DEFAULT '[]',
                    scheduled_date TEXT, pipeline_id TEXT,
                    created_at TEXT, updated_at TEXT, published_at TEXT, deleted_at TEXT
                )
            """)
            conn.commit()
            result = fetch_running_pipelines(conn)
            self.assertEqual(result, [])
            conn.close()


if __name__ == "__main__":
    unittest.main()
