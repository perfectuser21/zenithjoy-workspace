import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1] / "materials-notion"


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MaterialsProjectionTest(unittest.TestCase):
    def setUp(self):
        self.pm = load("project_materials")
        self.tenant = "11111111-1111-4111-8111-111111111111"
        self.mid = "22222222-2222-4222-8222-222222222222"
        self.database = "33333333-3333-4333-8333-333333333333"
        self.cfg = {"mode": "internal_admin_projection", "source_table": "zenithjoy.materials",
                    "sources": [{"database": "zenithjoy", "tenant_bindings": {self.tenant: "owned organization"}}],
                    "database_id": self.database, "required_fields": ["素材ID", "组织ID"]}
        self.material = {"id": self.mid, "tenant_id": self.tenant, "mime_type": "image/jpeg",
                         "file_name": "owned fixture", "storage_key": "fixture", "size_bytes": 7,
                         "content_hash": "hash", "uploaded_by_license_id": None, "ai_description": None,
                         "created_at": "2026-10-01T00:00:00Z", "refs": 0}
        self.writes = []
        self.sql = []

    def sql_read(self, query, database):
        self.sql.append((query, database))
        if "FROM zenithjoy.tenants" in query:
            return [{"id": self.tenant, "name": "owned organization"}]
        return [dict(self.material)]

    def notion(self, method, path, value=None):
        if method == "GET":
            self.assertEqual(path, "databases/" + self.database)
            return {"properties": {key: {} for key in self.cfg["required_fields"]}}
        if path.endswith("/query"):
            return {"results": [], "has_more": False}
        self.writes.append((method, path, value))
        return {"id": "owned-page"}

    def run_projection(self, notion=None):
        with patch.object(self.pm, "brain", return_value={"value": self.cfg}), \
             patch.object(self.pm, "sql_read", side_effect=self.sql_read), \
             patch.object(self.pm, "notion", side_effect=notion or self.notion):
            return self.pm.run()

    def test_existing_scope_source_ids_and_target_are_preserved(self):
        stats = self.run_projection()
        self.assertEqual(stats["source_rows"], 1)
        self.assertEqual(stats["created"], 1)
        self.assertEqual(stats["source_writes"], 0)
        self.assertFalse(stats["public_sharing_configured"])
        self.assertTrue(all(query.startswith("SELECT ") and database == "zenithjoy" for query, database in self.sql))
        method, path, value = self.writes[0]
        self.assertEqual((method, path), ("POST", "pages"))
        self.assertEqual(value["parent"], {"database_id": self.database})
        self.assertEqual(value["properties"]["素材ID"]["rich_text"][0]["text"]["content"], self.mid)
        self.assertEqual(value["properties"]["同步键"]["rich_text"][0]["text"]["content"], "zenithjoy:" + self.tenant + ":" + self.mid)

    def test_cross_organization_source_is_rejected_before_notion_write(self):
        self.material["tenant_id"] = "44444444-4444-4444-8444-444444444444"
        with self.assertRaisesRegex(ValueError, "跨组织"):
            self.run_projection()
        self.assertEqual(self.writes, [])

    def test_duplicate_source_identity_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "重复素材身份"):
            self.pm.validate_scope([self.material, self.material], {self.tenant: "owned organization"})

    def test_unauthorized_existing_projection_is_not_modified(self):
        def notion(method, path, value=None):
            if path.endswith("/query"):
                return {"results": [{"properties": {"素材ID": {"rich_text": [{"plain_text": self.mid}]},
                         "组织ID": {"rich_text": [{"plain_text": "44444444-4444-4444-8444-444444444444"}]},
                         "来源数据库": {"select": {"name": "zenithjoy"}}}}], "has_more": False}
            return self.notion(method, path, value)
        with self.assertRaisesRegex(ValueError, "未授权来源组织"):
            self.run_projection(notion)
        self.assertEqual(self.writes, [])

    def test_sql_transport_forces_read_only_and_bounded_queries(self):
        from types import SimpleNamespace
        calls = []
        def execute(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout="[]", stderr="")
        with patch.object(self.pm, "item_value", return_value="postgresql://owned:owned@127.0.0.1/zenithjoy"), \
             patch.object(self.pm.subprocess, "run", side_effect=execute):
            self.assertEqual(self.pm.sql_read("SELECT 1", "zenithjoy"), [])
        env = calls[0][1]["env"]
        self.assertIn("default_transaction_read_only=on", env["PGOPTIONS"])
        self.assertIn("statement_timeout=15000", env["PGOPTIONS"])
        self.assertEqual(calls[0][1]["timeout"], 25)

    def test_job_keeps_original_lock_and_brain_receipt_without_openclaw(self):
        with patch.dict(sys.modules, {"project_materials": self.pm}):
            job = load("sync_materials_job")
        calls = []
        def api(path, method, data=None):
            calls.append((path, method, data))
            return {"id": "owned-task"}
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(job, "ROOT", pathlib.Path(directory)), \
             patch.object(job, "api", side_effect=api), \
             patch.object(job, "refresh") as refresh, \
             patch.object(job, "run", return_value={"source_rows": 1, "source_writes": 0}), \
             contextlib.redirect_stdout(io.StringIO()):
            job.main()
            receipt = json.loads((pathlib.Path(directory) / "latest.json").read_text())
        self.assertEqual(receipt["status"], "completed")
        self.assertEqual(receipt["task_id"], "owned-task")
        self.assertEqual(receipt["statistics"]["source_writes"], 0)
        refresh.assert_called_once_with()
        self.assertEqual(calls[-1][2]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
