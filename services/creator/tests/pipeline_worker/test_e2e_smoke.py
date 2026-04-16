"""端到端 smoke test（mock NotebookLM/LLM）"""

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
    process_pipeline,
    _now_iso,
)


def _setup_test_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE topics (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            angle TEXT,
            priority INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT '待研究'
                CHECK(status IN ('待研究', '已通过', '研究中', '已发布', '已拒绝')),
            target_platforms TEXT NOT NULL DEFAULT '[]',
            scheduled_date TEXT, pipeline_id TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            published_at TEXT, deleted_at TEXT
        )
    """)
    conn.commit()
    _ensure_pipeline_runs_table(conn)
    _ensure_topics_has_waiting_status(conn)

    now = _now_iso()
    conn.execute(
        "INSERT INTO topics (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ("topic-smoke", "AI 能力下放", "研究中", now, now),
    )
    conn.execute(
        "INSERT INTO pipeline_runs (id, topic_id, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("run-smoke", "topic-smoke", "running", now, now, now),
    )
    conn.commit()
    return conn


class TestE2ESmoke(unittest.TestCase):
    """端到端 smoke：mock 所有外部调用，验证 pipeline 正常走完 6 阶段。"""

    def _make_mock_stages(self, mock_results):
        """创建 mock STAGES 列表，替换 executor 函数为 MagicMock。"""
        from pipeline_worker.worker import STAGES
        mock_stages = []
        stage_map = {
            "research": mock_results.get("execute_research"),
            "copywriting": mock_results.get("execute_copywriting"),
            "copy_review": mock_results.get("execute_copy_review"),
            "generate": mock_results.get("execute_generate"),
            "image_review": mock_results.get("execute_image_review"),
            "export": mock_results.get("execute_export"),
        }
        for name, resource_type, _orig_fn in STAGES:
            mock_fn = MagicMock(return_value=stage_map.get(name, {"success": True}))
            mock_stages.append((name, resource_type, mock_fn))
        return mock_stages

    def test_full_pipeline_mock(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            conn = _setup_test_db(db_path)

            output_dir = Path(tmp) / "output"
            output_dir.mkdir()

            mock_results = {
                "execute_research": {"success": True, "findings_path": str(output_dir / "f.json"), "findings_count": 5},
                "execute_copywriting": {"success": True, "output_dir": str(output_dir), "files": ["cards/copy.md"]},
                "execute_copy_review": {"success": True, "review_passed": True, "issues": [], "quality_score": 8},
                "execute_generate": {"success": True, "output_dir": str(output_dir), "image_count": 9},
                "execute_image_review": {"success": True, "review_passed": True, "card_count": 0, "issues": [], "quality_score": 7},
                "execute_export": {"success": True, "manifest_path": str(output_dir / "manifest.json"), "card_count": 0, "export_path": "/nas/test"},
            }

            (output_dir / "manifest.json").write_text(json.dumps({"version": "1.0"}))

            mock_stages = self._make_mock_stages(mock_results)

            with patch("pipeline_worker.worker.STAGES", mock_stages), \
                 patch("pipeline_worker.worker.can_run", return_value={"approved": True, "reason": "mock"}):

                pipeline = {
                    "id": "run-smoke",
                    "topic_id": "topic-smoke",
                    "keyword": "AI 能力下放",
                    "current_stage": None,
                }
                ok = process_pipeline(conn, pipeline, dry_run=False)

            self.assertTrue(ok)

            cur = conn.execute("SELECT status FROM pipeline_runs WHERE id = 'run-smoke'")
            self.assertEqual(cur.fetchone()[0], "completed")

            cur = conn.execute("SELECT status FROM topics WHERE id = 'topic-smoke'")
            self.assertEqual(cur.fetchone()[0], "待发布")

            conn.close()

    def test_review_failure_stops_pipeline(self):
        """审查失败时 pipeline 应标记为 failed。"""
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            conn = _setup_test_db(db_path)

            mock_results = {
                "execute_research": {"success": True, "findings_path": "/tmp/f.json", "findings_count": 3},
                "execute_copywriting": {"success": True, "output_dir": tmp},
                "execute_copy_review": {"success": True, "review_passed": False, "issues": ["禁用词"], "quality_score": 3},
            }
            mock_stages = self._make_mock_stages(mock_results)

            with patch("pipeline_worker.worker.STAGES", mock_stages), \
                 patch("pipeline_worker.worker.can_run", return_value={"approved": True, "reason": "mock"}):

                pipeline = {
                    "id": "run-smoke",
                    "topic_id": "topic-smoke",
                    "keyword": "AI 能力下放",
                    "current_stage": None,
                }
                ok = process_pipeline(conn, pipeline, dry_run=False)

            self.assertFalse(ok)

            cur = conn.execute("SELECT status, error_message FROM pipeline_runs WHERE id = 'run-smoke'")
            row = cur.fetchone()
            self.assertEqual(row[0], "failed")
            self.assertIn("审查未通过", row[1])

            cur = conn.execute("SELECT status FROM topics WHERE id = 'topic-smoke'")
            self.assertEqual(cur.fetchone()[0], "研究中")

            conn.close()


if __name__ == "__main__":
    unittest.main()
