"""选题池（topics）REST API 路由

设计要点：
- 响应统一 `{success, data, error}` 格式
- DB 路径可注入（便于单测使用 in-memory 或 tmp_path）
- 软删（deleted_at），列表查询自动过滤
- 状态枚举与 migration 中 CHECK 约束保持一致

Brain Task: 4aac48fe-048a-4f82-9750-57e6614e0c62
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# 状态枚举（与 migration 中 CHECK 约束一致）
ALLOWED_STATUSES = {"待研究", "已通过", "研究中", "已发布", "已拒绝"}

DEFAULT_PLATFORMS = [
    "xiaohongshu", "douyin", "kuaishou", "shipinhao",
    "x", "toutiao", "weibo", "wechat",
]

# DB 路径（运行时注入；测试时可覆盖）
_DB_PATH: Path | None = None


def set_db_path(path: Path) -> None:
    """供测试或启动时注入 DB 路径。"""
    global _DB_PATH
    _DB_PATH = Path(path)


def get_db_path() -> Path:
    if _DB_PATH is None:
        raise RuntimeError("topics 模块未配置 DB 路径，请先 set_db_path()")
    return _DB_PATH


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema(db_path: Path) -> None:
    """确保 topics / pacing_config 表存在（测试可直接调用，无需跑 migration 脚本）。"""
    migration_sql = (
        Path(__file__).parent.parent / "migrations" / "001_create_topics.sql"
    ).read_text(encoding="utf-8")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(migration_sql)
        conn.commit()
    finally:
        conn.close()


# ─── Pydantic Models ──────────────────────────────────────────────


class TopicCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    angle: Optional[str] = None
    priority: int = 100
    status: str = "待研究"
    target_platforms: Optional[list[str]] = None
    scheduled_date: Optional[str] = None  # YYYY-MM-DD

    @field_validator("status")
    @classmethod
    def status_must_be_valid(cls, v: str) -> str:
        if v not in ALLOWED_STATUSES:
            raise ValueError(f"非法状态：{v}，允许：{sorted(ALLOWED_STATUSES)}")
        return v


class TopicUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    angle: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    target_platforms: Optional[list[str]] = None
    scheduled_date: Optional[str] = None
    pipeline_id: Optional[str] = None
    published_at: Optional[str] = None

    @field_validator("status")
    @classmethod
    def status_must_be_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ALLOWED_STATUSES:
            raise ValueError(f"非法状态：{v}，允许：{sorted(ALLOWED_STATUSES)}")
        return v


# ─── Helpers ──────────────────────────────────────────────────────


def _row_to_topic(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    if d.get("target_platforms"):
        try:
            d["target_platforms"] = json.loads(d["target_platforms"])
        except (TypeError, json.JSONDecodeError):
            d["target_platforms"] = []
    return d


def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None}


def _err(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"success": False, "data": None, "error": {"code": code, "message": message}},
    )


# ─── Router ───────────────────────────────────────────────────────

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("")
def list_topics(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_deleted: bool = Query(False),
) -> dict[str, Any]:
    where = []
    params: list[Any] = []

    if not include_deleted:
        where.append("deleted_at IS NULL")
    if status is not None:
        if status not in ALLOWED_STATUSES:
            raise _err("INVALID_STATUS", f"非法状态：{status}", 400)
        where.append("status = ?")
        params.append(status)

    where_clause = ("WHERE " + " AND ".join(where)) if where else ""
    sql = (
        f"SELECT * FROM topics {where_clause} "
        f"ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?"
    )
    params.extend([limit, offset])

    conn = get_conn()
    try:
        cur = conn.execute(sql, params)
        topics = [_row_to_topic(r) for r in cur.fetchall()]

        cur = conn.execute(
            f"SELECT COUNT(*) AS n FROM topics {where_clause}",
            params[:-2],  # 不含 limit/offset
        )
        total = cur.fetchone()["n"]
        return _ok({"items": topics, "total": total, "limit": limit, "offset": offset})
    finally:
        conn.close()


@router.get("/{topic_id}")
def get_topic(topic_id: str) -> dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.execute(
            "SELECT * FROM topics WHERE id = ? AND deleted_at IS NULL", (topic_id,)
        )
        row = cur.fetchone()
        if not row:
            raise _err("NOT_FOUND", f"topic {topic_id} 不存在", 404)
        return _ok(_row_to_topic(row))
    finally:
        conn.close()


@router.post("", status_code=201)
def create_topic(payload: TopicCreate) -> dict[str, Any]:
    now = _now_iso()
    topic_id = str(uuid.uuid4())
    platforms = payload.target_platforms or DEFAULT_PLATFORMS

    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO topics
                (id, title, angle, priority, status, target_platforms,
                 scheduled_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                topic_id,
                payload.title,
                payload.angle,
                payload.priority,
                payload.status,
                json.dumps(platforms, ensure_ascii=False),
                payload.scheduled_date,
                now,
                now,
            ),
        )
        conn.commit()
        cur = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,))
        return _ok(_row_to_topic(cur.fetchone()))
    finally:
        conn.close()


@router.patch("/{topic_id}")
def update_topic(topic_id: str, payload: TopicUpdate) -> dict[str, Any]:
    fields_to_update: list[tuple[str, Any]] = []
    data = payload.model_dump(exclude_unset=True)

    for key in (
        "title", "angle", "priority", "status",
        "scheduled_date", "pipeline_id", "published_at",
    ):
        if key in data:
            fields_to_update.append((key, data[key]))

    if "target_platforms" in data:
        fields_to_update.append((
            "target_platforms",
            json.dumps(data["target_platforms"] or [], ensure_ascii=False),
        ))

    if not fields_to_update:
        raise _err("NO_FIELDS", "没有可更新字段", 400)

    fields_to_update.append(("updated_at", _now_iso()))
    set_clause = ", ".join(f"{k} = ?" for k, _ in fields_to_update)
    values = [v for _, v in fields_to_update] + [topic_id]

    conn = get_conn()
    try:
        cur = conn.execute(
            "SELECT id FROM topics WHERE id = ? AND deleted_at IS NULL", (topic_id,)
        )
        if not cur.fetchone():
            raise _err("NOT_FOUND", f"topic {topic_id} 不存在", 404)

        conn.execute(
            f"UPDATE topics SET {set_clause} WHERE id = ?",
            values,
        )
        conn.commit()
        cur = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,))
        return _ok(_row_to_topic(cur.fetchone()))
    finally:
        conn.close()


@router.delete("/{topic_id}")
def delete_topic(topic_id: str, hard: bool = Query(False)) -> dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT id FROM topics WHERE id = ?", (topic_id,))
        if not cur.fetchone():
            raise _err("NOT_FOUND", f"topic {topic_id} 不存在", 404)

        if hard:
            conn.execute("DELETE FROM topics WHERE id = ?", (topic_id,))
        else:
            now = _now_iso()
            conn.execute(
                "UPDATE topics SET deleted_at = ?, updated_at = ? WHERE id = ?",
                (now, now, topic_id),
            )
        conn.commit()
        return _ok({"id": topic_id, "deleted": True, "hard": hard})
    finally:
        conn.close()


# ─── pacing 配置 ───────────────────────────────────────────────────


class PacingUpdate(BaseModel):
    daily_limit: Optional[int] = Field(None, ge=0, le=100)


@router.get("/pacing/config", include_in_schema=True)
def get_pacing_config() -> dict[str, Any]:
    conn = get_conn()
    try:
        cur = conn.execute("SELECT key, value FROM pacing_config")
        cfg = {row["key"]: row["value"] for row in cur.fetchall()}
        # 类型还原
        if "daily_limit" in cfg:
            try:
                cfg["daily_limit"] = int(cfg["daily_limit"])
            except (TypeError, ValueError):
                cfg["daily_limit"] = 1
        return _ok(cfg)
    finally:
        conn.close()


@router.patch("/pacing/config")
def update_pacing_config(payload: PacingUpdate) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise _err("NO_FIELDS", "没有可更新字段", 400)

    now = _now_iso()
    conn = get_conn()
    try:
        for k, v in data.items():
            conn.execute(
                """
                INSERT INTO pacing_config (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (k, str(v), now),
            )
        conn.commit()
        return get_pacing_config()
    finally:
        conn.close()
