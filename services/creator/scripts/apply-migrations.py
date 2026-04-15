#!/usr/bin/env python3
"""应用 SQL migrations 到 creator.db

用法：
  python scripts/apply-migrations.py
  python scripts/apply-migrations.py --db /custom/path/creator.db

幂等：每个 migration 文件只执行一次（通过 schema_migrations 表追踪）。
"""

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DB = Path(__file__).parent.parent / "data" / "creator.db"
MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


def ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def applied_versions(conn: sqlite3.Connection) -> set[str]:
    cur = conn.execute("SELECT version FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def apply_migration(conn: sqlite3.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (path.name, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--migrations-dir", type=Path, default=MIGRATIONS_DIR)
    args = parser.parse_args()

    args.db.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(args.db)
    try:
        ensure_migrations_table(conn)
        already = applied_versions(conn)

        files = sorted(args.migrations_dir.glob("*.sql"))
        if not files:
            print(f"未发现 migration 文件 in {args.migrations_dir}")
            return 0

        applied_count = 0
        for path in files:
            if path.name in already:
                print(f"[跳过] {path.name} 已应用")
                continue
            print(f"[应用] {path.name}")
            apply_migration(conn, path)
            applied_count += 1

        print(f"完成：本次应用 {applied_count} 个 migration，DB={args.db}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
