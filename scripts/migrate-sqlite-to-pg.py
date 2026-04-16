#!/usr/bin/env python3
"""SQLite → Postgres 一次性迁移脚本（PR-d/5 彻底重构）。

将 services/creator/data/creator.db 中的 topics 搬到 Postgres zenithjoy.topics。

特性：
- 幂等：ON CONFLICT (id) DO NOTHING，重跑只会跳过已迁入的行
- 默认 dry-run：不写任何东西，只打印要迁移的清单
- --apply 真跑；--backup-first 会在迁移前先把 SQLite 文件复制到 backups/creator.db.bak-...
- 零第三方 Python 依赖：只用标准库 sqlite3 + subprocess 调 psql
- 运行前 / 后都打印 Postgres count，便于审计

用法：
    # 只打印将迁移的内容
    python3 scripts/migrate-sqlite-to-pg.py
    python3 scripts/migrate-sqlite-to-pg.py --dry-run

    # 真执行（推荐 + 备份）
    python3 scripts/migrate-sqlite-to-pg.py --apply --backup-first

    # 自定义路径 / 连接参数
    python3 scripts/migrate-sqlite-to-pg.py \\
        --sqlite services/creator/data/creator.db \\
        --pg-host localhost --pg-port 5432 \\
        --pg-user cecelia --pg-db cecelia \\
        --apply

部署步骤见 scripts/MIGRATION_CUTOVER.md。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# 仓库根 = 当前文件的上一级
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE = REPO_ROOT / "services" / "creator" / "data" / "creator.db"
DEFAULT_BACKUP_DIR = REPO_ROOT / "services" / "creator" / "data" / "backups"
DEFAULT_ENV_FILE = REPO_ROOT / "apps" / "api" / ".env"


# ────────────────────────────────────────────────────────── 工具函数


def load_env_file(path: Path) -> dict[str, str]:
    """简单解析 .env（KEY=VALUE，# 开头忽略，支持两侧空白）。"""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def resolve_pg_args(
    args: argparse.Namespace,
    env_file_values: dict[str, str],
) -> dict[str, str]:
    """命令行 > 环境变量 > .env 文件 > 默认值。"""

    def pick(cli_val: Optional[str], env_keys: list[str], default: str) -> str:
        if cli_val:
            return cli_val
        for k in env_keys:
            if os.environ.get(k):
                return os.environ[k]
            if env_file_values.get(k):
                return env_file_values[k]
        return default

    return {
        "host": pick(args.pg_host, ["DATABASE_HOST", "PGHOST"], "localhost"),
        "port": pick(args.pg_port, ["DATABASE_PORT", "PGPORT"], "5432"),
        "user": pick(args.pg_user, ["DATABASE_USER", "PGUSER"], "cecelia"),
        "db":   pick(args.pg_db,   ["DATABASE_NAME", "PGDATABASE"], "cecelia"),
    }


def run_psql(
    pg: dict[str, str],
    sql: str,
    *,
    check: bool = True,
    psql_bin: str = "psql",
) -> subprocess.CompletedProcess:
    """用 psql 执行单条 SQL，返回 CompletedProcess。

    - -v ON_ERROR_STOP=1 让 psql 遇错立即退出
    - -t -A 让输出是裸值（便于 count 抽取）
    """
    cmd = [
        psql_bin,
        "-h", pg["host"],
        "-p", pg["port"],
        "-U", pg["user"],
        "-d", pg["db"],
        "-v", "ON_ERROR_STOP=1",
        "-t", "-A",
        "-F", "|",
        "-c", sql,
    ]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=check,
    )


def pg_count(pg: dict[str, str], table: str) -> int:
    res = run_psql(pg, f"SELECT COUNT(*) FROM {table};")
    return int(res.stdout.strip() or "0")


def pg_existing_topic_ids(pg: dict[str, str]) -> set[str]:
    res = run_psql(pg, "SELECT id FROM zenithjoy.topics;")
    return {line.strip() for line in res.stdout.splitlines() if line.strip()}


# ────────────────────────────────────────────────────────── 数据转换


def _quote_literal(val: Optional[str]) -> str:
    """psql SQL 字符串字面量，转义单引号。None / 空字符串 → NULL。"""
    if val is None or val == "":
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"


def _quote_int(val: Optional[int]) -> str:
    return "NULL" if val is None else str(int(val))


def _quote_uuid(val: Optional[str]) -> str:
    if val is None or val == "":
        return "NULL"
    uuid.UUID(str(val))  # 校验 UUID 合法
    return f"'{val}'::uuid"


def _quote_jsonb(val: Any) -> str:
    """把 target_platforms 文本或 list 转成 JSONB 字面量。"""
    if val is None:
        return "'[]'::jsonb"
    if isinstance(val, (list, dict)):
        return _quote_literal(json.dumps(val, ensure_ascii=False)) + "::jsonb"
    # SQLite 里是 TEXT：尝试解析成 JSON，失败则原样
    try:
        parsed = json.loads(val)
        return _quote_literal(json.dumps(parsed, ensure_ascii=False)) + "::jsonb"
    except (TypeError, ValueError):
        return _quote_literal(val) + "::jsonb"


def build_topic_insert(row: dict[str, Any]) -> str:
    """根据 SQLite 行构建 Postgres INSERT 语句（含 ON CONFLICT）。"""
    topic_id = _quote_uuid(row["id"])
    title = _quote_literal(row["title"])
    angle = _quote_literal(row.get("angle"))
    priority_val = row.get("priority")
    priority = _quote_int(priority_val if priority_val is not None else 100)
    status = _quote_literal(row.get("status") or "待研究")
    target_platforms = _quote_jsonb(row.get("target_platforms"))
    scheduled_date = _quote_literal(row.get("scheduled_date"))
    pipeline_id = _quote_uuid(row.get("pipeline_id"))
    created_at = _quote_literal(row.get("created_at"))
    updated_at = _quote_literal(row.get("updated_at"))
    published_at = _quote_literal(row.get("published_at"))
    deleted_at = _quote_literal(row.get("deleted_at"))

    # scheduled_date / *_at 的 NULL 不需要 cast
    def cast_or_null(lit: str, cast: str) -> str:
        return lit if lit == "NULL" else f"{lit}::{cast}"

    sched = cast_or_null(scheduled_date, "date")
    cat = cast_or_null(created_at, "timestamptz")
    uat = cast_or_null(updated_at, "timestamptz")
    pat = cast_or_null(published_at, "timestamptz")
    dat = cast_or_null(deleted_at, "timestamptz")

    return (
        "INSERT INTO zenithjoy.topics "
        "(id, title, angle, priority, status, target_platforms, "
        "scheduled_date, pipeline_id, created_at, updated_at, "
        "published_at, deleted_at) VALUES ("
        f"{topic_id}, {title}, {angle}, {priority}, {status}, {target_platforms}, "
        f"{sched}, {pipeline_id}, {cat}, {uat}, {pat}, {dat}) "
        "ON CONFLICT (id) DO NOTHING;"
    )


# ────────────────────────────────────────────────────────── 备份


def backup_sqlite(sqlite_path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dst = backup_dir / f"creator.db.bak-{ts}"
    shutil.copy2(sqlite_path, dst)
    # 同时把 -wal / -shm 一并复制（SQLite WAL 模式下这俩可能有尾数据）
    for suffix in ("-wal", "-shm"):
        side = sqlite_path.with_name(sqlite_path.name + suffix)
        if side.exists():
            shutil.copy2(side, backup_dir / (dst.name + suffix))
    return dst


# ────────────────────────────────────────────────────────── 迁移主流程


def read_sqlite_topics(sqlite_path: Path) -> list[dict[str, Any]]:
    """读 SQLite topics；若 topics 已 freeze（view/不存在），尝试读 topics_frozen_*。"""
    if not sqlite_path.exists():
        return []
    conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        # 先找 live topics 表（不是 view）
        cur = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name='topics';"
        )
        table = "topics" if cur.fetchone() else None

        if table is None:
            # live 表不存在，尝试读 frozen 归档表
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name LIKE 'topics_frozen_%' ORDER BY name DESC LIMIT 1;"
            )
            found = cur.fetchone()
            table = found[0] if found else None
        if table is None:
            return []
        rows = conn.execute(f"SELECT * FROM {table};").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def summarize_row(row: dict[str, Any]) -> str:
    title = str(row.get("title", ""))
    if len(title) > 40:
        title = title[:40] + "…"
    return (
        f"  - id={row.get('id')} | status={row.get('status')} | title={title}"
    )


def migrate(
    *,
    sqlite_path: Path,
    pg: dict[str, str],
    apply: bool,
    backup_first: bool,
    backup_dir: Path,
    out=sys.stdout,
) -> int:
    def echo(msg: str = "") -> None:
        print(msg, file=out)

    echo("=" * 60)
    echo("SQLite → Postgres 迁移（PR-d/5）")
    echo("=" * 60)
    echo(f"SQLite  : {sqlite_path}")
    echo(f"Postgres: {pg['user']}@{pg['host']}:{pg['port']}/{pg['db']}")
    echo(f"模式     : {'APPLY (真执行)' if apply else 'DRY-RUN (预览)'}")
    echo()

    # 1) 读 SQLite
    topics = read_sqlite_topics(sqlite_path)
    echo(f"[SQLite] topics 总数: {len(topics)}")

    # 2) 读 Postgres 现状
    pg_before = pg_count(pg, "zenithjoy.topics")
    existing_ids = pg_existing_topic_ids(pg)
    echo(f"[Postgres] zenithjoy.topics 现有: {pg_before}")
    if existing_ids:
        for tid in sorted(existing_ids):
            echo(f"  已存在 id: {tid}")
    echo()

    # 3) 分类
    to_insert: list[dict[str, Any]] = []
    to_skip: list[dict[str, Any]] = []
    for row in topics:
        if row.get("id") in existing_ids:
            to_skip.append(row)
        else:
            to_insert.append(row)

    echo(f"[PLAN] 将插入 {len(to_insert)} 行，跳过 {len(to_skip)} 行（已存在）")
    if to_insert:
        echo("将插入：")
        for r in to_insert:
            echo(summarize_row(r))
    if to_skip:
        echo("将跳过：")
        for r in to_skip:
            echo(summarize_row(r))
    echo()

    if not apply:
        echo("DRY-RUN 结束。添加 --apply 真执行。")
        return 0

    # 4) 备份
    if backup_first:
        if sqlite_path.exists():
            dst = backup_sqlite(sqlite_path, backup_dir)
            echo(f"[BACKUP] SQLite 已备份到: {dst}")
        else:
            echo(f"[BACKUP] SQLite 文件不存在，跳过备份: {sqlite_path}")
    echo()

    # 5) 真插入
    inserted = 0
    failed: list[tuple[str, str]] = []
    for row in to_insert:
        try:
            sql = build_topic_insert(row)
            run_psql(pg, sql)
            inserted += 1
            echo(f"[OK] 已插入: {row.get('id')}")
        except subprocess.CalledProcessError as e:
            failed.append((str(row.get("id")), (e.stderr or str(e))[:200]))
            echo(f"[FAIL] {row.get('id')}: "
                 f"{(e.stderr or '').strip() or e}")
        except Exception as e:  # noqa: BLE001
            failed.append((str(row.get("id")), str(e)[:200]))
            echo(f"[FAIL] {row.get('id')}: {e}")

    # 6) 验证
    pg_after = pg_count(pg, "zenithjoy.topics")
    echo()
    echo("=" * 60)
    echo("[VERIFY]")
    echo(f"  Postgres topics 迁移前: {pg_before}")
    echo(f"  Postgres topics 迁移后: {pg_after}")
    echo(f"  本次插入:              {inserted}")
    echo(f"  失败:                  {len(failed)}")
    if failed:
        for tid, msg in failed:
            echo(f"    - {tid}: {msg}")

    # 专项校验龙虾
    res = run_psql(
        pg,
        "SELECT COUNT(*) FROM zenithjoy.topics "
        "WHERE id = 'f108b4d8-244e-4663-bcf6-2e7816ab00fe';",
    )
    lobster = int(res.stdout.strip() or "0")
    echo(f"  龙虾 id=f108b4d8…00fe 在 Postgres: {lobster} 行")
    echo("=" * 60)

    return 0 if not failed else 1


# ────────────────────────────────────────────────────────── CLI


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="SQLite → Postgres 一次性迁移（PR-d/5）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE,
                   help=f"SQLite creator.db 路径（默认 {DEFAULT_SQLITE}）")
    p.add_argument("--pg-host", default=None)
    p.add_argument("--pg-port", default=None)
    p.add_argument("--pg-user", default=None)
    p.add_argument("--pg-db", default=None)
    p.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE,
                   help=f"读取连接参数的 .env（默认 {DEFAULT_ENV_FILE}）")
    p.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR,
                   help=f"备份目录（默认 {DEFAULT_BACKUP_DIR}）")

    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="只打印，不写（默认行为）")
    mode.add_argument("--apply", action="store_true",
                      help="真执行（覆盖 dry-run）")

    p.add_argument("--backup-first", action="store_true",
                   help="配合 --apply：先把 SQLite 文件复制到 --backup-dir")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    env_vals = load_env_file(args.env_file)
    pg = resolve_pg_args(args, env_vals)

    apply = bool(args.apply)
    return migrate(
        sqlite_path=args.sqlite,
        pg=pg,
        apply=apply,
        backup_first=args.backup_first and apply,
        backup_dir=args.backup_dir,
    )


if __name__ == "__main__":
    sys.exit(main())
