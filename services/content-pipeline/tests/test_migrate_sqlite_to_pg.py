"""SQLite → Postgres 迁移脚本单测（PR-d/5）。

覆盖：
- dry-run 不调用 psql 写（只 SELECT）
- --apply 按每行构造 INSERT ... ON CONFLICT DO NOTHING 并调用 psql
- 幂等：ON CONFLICT 语法正确，SQL 字符串中包含 ON CONFLICT 子句
- --backup-first 创建 backups/creator.db.bak-<timestamp> 文件
- SQLite 文件不存在 / topics 表缺失时不报错且 0 行迁移
- 数据转换正确：target_platforms TEXT → JSONB、UUID cast、NULL 处理

所有 psql 调用通过 monkeypatch 拦截，不走真实 Postgres。
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
import subprocess
import sys
from io import StringIO
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]  # repo root: tests → creator → services → repo
SCRIPT_PATH = ROOT / "scripts" / "migrate-sqlite-to-pg.py"


@pytest.fixture(scope="module")
def mig():
    """动态加载 migrate-sqlite-to-pg.py（带连字符）。"""
    spec = importlib.util.spec_from_file_location("migrate_sqlite_to_pg", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["migrate_sqlite_to_pg"] = module
    spec.loader.exec_module(module)
    return module


# ───────────────────────────────────────────────────────── 工具


def _make_sqlite(path: Path, rows: list[dict[str, Any]]) -> None:
    """创建 SQLite DB + topics 表 + 填入行。"""
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE topics (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            angle TEXT,
            priority INTEGER NOT NULL DEFAULT 100,
            status TEXT NOT NULL DEFAULT '待研究',
            target_platforms TEXT NOT NULL DEFAULT '[]',
            scheduled_date TEXT,
            pipeline_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            published_at TEXT,
            deleted_at TEXT
        )
        """
    )
    for r in rows:
        conn.execute(
            "INSERT INTO topics (id, title, angle, priority, status, target_platforms, "
            "scheduled_date, pipeline_id, created_at, updated_at, published_at, deleted_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                r["id"], r["title"], r.get("angle"),
                r.get("priority", 100), r.get("status", "待研究"),
                r.get("target_platforms", '["x"]'),
                r.get("scheduled_date"), r.get("pipeline_id"),
                r["created_at"], r["updated_at"],
                r.get("published_at"), r.get("deleted_at"),
            ),
        )
    conn.commit()
    conn.close()


class FakePsql:
    """拦截 run_psql 调用，按 SQL 模式返回固定值，同时记录所有 SQL。"""

    def __init__(self, existing_ids: list[str] | None = None,
                 initial_count: int = 0):
        self.calls: list[str] = []
        self.existing_ids = existing_ids or []
        self.count = initial_count
        self.lobster = "0"

    def __call__(self, pg, sql, *, check=True, psql_bin="psql"):
        self.calls.append(sql)
        upper = sql.strip().upper()
        stdout = ""
        if "COUNT(*)" in upper and "WHERE ID" in upper:
            # 龙虾校验 query
            stdout = self.lobster
        elif "COUNT(*)" in upper:
            stdout = str(self.count)
        elif upper.startswith("SELECT ID FROM ZENITHJOY.TOPICS"):
            stdout = "\n".join(self.existing_ids)
        elif upper.startswith("INSERT"):
            # 模拟插入成功：count + 1，新行加入 existing
            self.count += 1
            stdout = "INSERT 0 1"
        return subprocess.CompletedProcess(
            args=["psql"], returncode=0, stdout=stdout, stderr=""
        )


@pytest.fixture
def patch_psql(monkeypatch, mig):
    fake = FakePsql()
    monkeypatch.setattr(mig, "run_psql", fake)
    return fake


# ───────────────────────────────────────────────────────── 测试


def test_dry_run_no_writes(tmp_path, patch_psql, mig):
    """dry-run 模式：不调用 INSERT/备份，只 SELECT 读 Postgres 现状。"""
    sqlite_path = tmp_path / "creator.db"
    _make_sqlite(sqlite_path, [
        {
            "id": "f108b4d8-244e-4663-bcf6-2e7816ab00fe",
            "title": "龙虾",
            "status": "研究中",
            "created_at": "2026-04-15T14:00:00+00:00",
            "updated_at": "2026-04-15T14:30:00+00:00",
        },
    ])

    buf = StringIO()
    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=False,
        backup_first=False,
        backup_dir=tmp_path / "backups",
        out=buf,
    )
    assert rc == 0
    # 不应该有 INSERT 调用
    inserts = [c for c in patch_psql.calls if c.strip().upper().startswith("INSERT")]
    assert inserts == []
    # 输出里应出现龙虾 id
    assert "f108b4d8" in buf.getvalue()
    # 没备份目录
    assert not (tmp_path / "backups").exists()


def test_apply_inserts_with_on_conflict(tmp_path, patch_psql, mig):
    """--apply 会调用 INSERT ... ON CONFLICT DO NOTHING。"""
    sqlite_path = tmp_path / "creator.db"
    _make_sqlite(sqlite_path, [
        {
            "id": "f108b4d8-244e-4663-bcf6-2e7816ab00fe",
            "title": "龙虾 won't 'break' quotes",
            "angle": None,
            "status": "研究中",
            "target_platforms": '["x","toutiao"]',
            "created_at": "2026-04-15T14:00:00+00:00",
            "updated_at": "2026-04-15T14:30:00+00:00",
            "pipeline_id": "eb1dbe4d-a219-4d79-90fc-36c6307414be",
        },
    ])
    buf = StringIO()
    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=False,
        backup_dir=tmp_path / "backups",
        out=buf,
    )
    assert rc == 0
    inserts = [c for c in patch_psql.calls if c.strip().upper().startswith("INSERT")]
    assert len(inserts) == 1
    sql = inserts[0]
    # 必须含 ON CONFLICT 保证幂等
    assert "ON CONFLICT (id) DO NOTHING" in sql
    # UUID cast
    assert "'f108b4d8-244e-4663-bcf6-2e7816ab00fe'::uuid" in sql
    # 单引号正确转义（won''t / 'break''）
    assert "won''t" in sql
    assert "''break''" in sql
    # target_platforms 是 JSONB
    assert "::jsonb" in sql


def test_apply_skips_already_existing(tmp_path, monkeypatch, mig):
    """Postgres 已有同 id 时，不发插入请求。"""
    sqlite_path = tmp_path / "creator.db"
    tid = "f108b4d8-244e-4663-bcf6-2e7816ab00fe"
    _make_sqlite(sqlite_path, [
        {"id": tid, "title": "dup", "status": "研究中",
         "created_at": "2026-04-15T14:00:00+00:00",
         "updated_at": "2026-04-15T14:30:00+00:00"},
    ])
    fake = FakePsql(existing_ids=[tid], initial_count=1)
    monkeypatch.setattr(mig, "run_psql", fake)

    buf = StringIO()
    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=False,
        backup_dir=tmp_path / "backups",
        out=buf,
    )
    assert rc == 0
    inserts = [c for c in fake.calls if c.strip().upper().startswith("INSERT")]
    assert inserts == [], f"重复行不应插入，但收到 {len(inserts)} 条 INSERT"
    assert "跳过 1 行" in buf.getvalue()


def test_backup_first_creates_file(tmp_path, patch_psql, mig):
    """--apply --backup-first 会创建 backups/creator.db.bak-<ts>。"""
    sqlite_path = tmp_path / "creator.db"
    _make_sqlite(sqlite_path, [
        {"id": "f108b4d8-244e-4663-bcf6-2e7816ab00fe",
         "title": "x", "status": "研究中",
         "created_at": "2026-04-15T14:00:00+00:00",
         "updated_at": "2026-04-15T14:30:00+00:00"},
    ])
    backup_dir = tmp_path / "backups"

    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=True,
        backup_dir=backup_dir,
        out=StringIO(),
    )
    assert rc == 0
    assert backup_dir.exists()
    files = list(backup_dir.iterdir())
    assert any(f.name.startswith("creator.db.bak-") for f in files), (
        f"备份文件未生成，目录内容: {[f.name for f in files]}"
    )
    # 备份文件大小应 > 0 且等于源文件
    [bak] = [f for f in files if f.name.startswith("creator.db.bak-")
             and not f.name.endswith("-wal")
             and not f.name.endswith("-shm")]
    assert bak.stat().st_size == sqlite_path.stat().st_size


def test_empty_sqlite_does_not_crash(tmp_path, patch_psql, mig):
    """SQLite 文件不存在 / topics 表缺失时 0 行迁移且 rc=0。"""
    missing = tmp_path / "nope.db"
    rc = mig.migrate(
        sqlite_path=missing,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=True,
        backup_dir=tmp_path / "backups",
        out=StringIO(),
    )
    assert rc == 0
    inserts = [c for c in patch_psql.calls if c.strip().upper().startswith("INSERT")]
    assert inserts == []


def test_empty_sqlite_schema_only(tmp_path, patch_psql, mig):
    """SQLite 文件存在但无 topics 表（已 freeze 并 drop）。"""
    sqlite_path = tmp_path / "creator.db"
    conn = sqlite3.connect(sqlite_path)
    conn.execute("CREATE TABLE other (id TEXT)")
    conn.commit()
    conn.close()

    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=False,
        backup_dir=tmp_path / "backups",
        out=StringIO(),
    )
    assert rc == 0
    inserts = [c for c in patch_psql.calls if c.strip().upper().startswith("INSERT")]
    assert inserts == []


def test_reads_frozen_archive_table(tmp_path, patch_psql, mig):
    """freeze migration 已跑过后（topics 是 view，topics_frozen_* 有数据），
    脚本仍能读出并重跑迁移（幂等防呆）。"""
    sqlite_path = tmp_path / "creator.db"
    # 建 frozen 表 + 空 view（模拟 freeze 后状态）
    conn = sqlite3.connect(sqlite_path)
    conn.execute("""
        CREATE TABLE topics_frozen_20260416 (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, angle TEXT,
            priority INTEGER, status TEXT, target_platforms TEXT,
            scheduled_date TEXT, pipeline_id TEXT,
            created_at TEXT, updated_at TEXT,
            published_at TEXT, deleted_at TEXT
        )
    """)
    conn.execute(
        "INSERT INTO topics_frozen_20260416 (id, title, priority, status, "
        "target_platforms, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        ("f108b4d8-244e-4663-bcf6-2e7816ab00fe", "龙虾", 1, "研究中",
         '["x"]', "2026-04-15T14:00:00+00:00", "2026-04-15T14:30:00+00:00"),
    )
    conn.execute(
        "CREATE VIEW topics AS SELECT * FROM topics_frozen_20260416 WHERE 1=0"
    )
    conn.commit()
    conn.close()

    rc = mig.migrate(
        sqlite_path=sqlite_path,
        pg={"host": "h", "port": "5432", "user": "u", "db": "d"},
        apply=True,
        backup_first=False,
        backup_dir=tmp_path / "backups",
        out=StringIO(),
    )
    assert rc == 0
    # 应该读到 frozen 表里的 1 条，并尝试插入
    inserts = [c for c in patch_psql.calls if c.strip().upper().startswith("INSERT")]
    assert len(inserts) == 1
    assert "f108b4d8-244e-4663-bcf6-2e7816ab00fe" in inserts[0]


# ───────────────────────────────────────────────────────── 数据转换单元测试


def test_build_topic_insert_nulls(mig):
    """angle/pipeline_id/scheduled_date/published_at/deleted_at 为 None 时输出 NULL。"""
    sql = mig.build_topic_insert({
        "id": "f108b4d8-244e-4663-bcf6-2e7816ab00fe",
        "title": "t",
        "angle": None,
        "priority": 100,
        "status": "研究中",
        "target_platforms": '["x"]',
        "scheduled_date": None,
        "pipeline_id": None,
        "created_at": "2026-04-15T14:00:00+00:00",
        "updated_at": "2026-04-15T14:30:00+00:00",
        "published_at": None,
        "deleted_at": None,
    })
    # NULL 不能被 cast
    assert "NULL::date" not in sql
    assert "NULL::timestamptz" not in sql
    assert "NULL::uuid" not in sql
    # 正常字段有 cast
    assert "::uuid" in sql
    assert "::timestamptz" in sql
    assert "::jsonb" in sql


def test_build_topic_insert_target_platforms_parsing(mig):
    """target_platforms 是 JSON 字符串 → JSONB 字面量保留数组。"""
    sql = mig.build_topic_insert({
        "id": "f108b4d8-244e-4663-bcf6-2e7816ab00fe",
        "title": "t",
        "priority": 100,
        "status": "研究中",
        "target_platforms": '["xiaohongshu","douyin"]',
        "created_at": "2026-04-15T14:00:00+00:00",
        "updated_at": "2026-04-15T14:30:00+00:00",
    })
    # 内容应被规整为 json.dumps 格式
    assert '["xiaohongshu", "douyin"]' in sql or '"xiaohongshu"' in sql
    assert "::jsonb" in sql


def test_build_topic_insert_invalid_uuid_raises(mig):
    with pytest.raises(ValueError):
        mig.build_topic_insert({
            "id": "not-a-uuid",
            "title": "t",
            "priority": 100,
            "status": "研究中",
            "target_platforms": "[]",
            "created_at": "2026-04-15T14:00:00+00:00",
            "updated_at": "2026-04-15T14:30:00+00:00",
        })
