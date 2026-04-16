"""选题池（topics）REST API 路由 — HTTP 转发层

从 PR-b 开始，creator-api 不再直接读写 SQLite，而是把 /api/topics
和 /api/topics/pacing/config 请求转发到 apps/api（默认 localhost:5200）。
apps/api 是 Postgres zenithjoy.topics / zenithjoy.pacing_config 的唯一写入方。

设计要点：
- 响应统一 `{success, data, error}` 格式（apps/api 已保证）
- 使用 httpx.AsyncClient 做异步转发
- 每个请求带 Authorization: Bearer ${ZENITHJOY_INTERNAL_TOKEN}
- 错误映射：
  - apps/api 不可达 → 503
  - 401/403 → 503（提示鉴权失败）
  - 其他状态码透传

Refactor PR-b/5: creator-api 彻底不碰 creator.db
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)


# ─── 配置 ────────────────────────────────────────────────────────────


def _apps_api_base() -> str:
    """apps/api 基础 URL（从 env 读，每次调用取最新值便于测试覆盖）。"""
    return os.environ.get("APPS_API_BASE", "http://localhost:5200").rstrip("/")


def _internal_token() -> Optional[str]:
    """zenithjoy 内部 API token（可为空 — apps/api 会以 dev 友好模式放行）。"""
    token = os.environ.get("ZENITHJOY_INTERNAL_TOKEN", "").strip()
    return token or None


# 启动时提示（不中断）
if not _internal_token():
    logger.warning(
        "ZENITHJOY_INTERNAL_TOKEN 未设置，apps/api 转发将不带 Authorization header。"
        "若 apps/api 要求 token，将收到 401。"
    )


# ─── HTTP 转发核心 ────────────────────────────────────────────────────


def _auth_headers() -> dict[str, str]:
    token = _internal_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


async def _forward(
    method: str,
    path: str,
    *,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """把请求转发到 apps/api，返回解析后的 JSON dict。

    出错时抛 fastapi.HTTPException（供 FastAPI 自动转 HTTP 响应）。
    """
    url = f"{_apps_api_base()}{path}"
    headers = {"Content-Type": "application/json", **_auth_headers()}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(
                method.upper(),
                url,
                params=params,
                json=json_body,
                headers=headers,
            )
    except httpx.ConnectError as e:
        logger.error("apps/api 不可达：%s %s — %s", method, url, e)
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "data": None,
                "error": {"code": "UPSTREAM_UNREACHABLE", "message": "apps/api 不可达"},
            },
        ) from e
    except httpx.RequestError as e:
        logger.error("apps/api 请求失败：%s %s — %s", method, url, e)
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "data": None,
                "error": {"code": "UPSTREAM_ERROR", "message": str(e)},
            },
        ) from e

    # 鉴权错误单独处理
    if resp.status_code in (401, 403):
        logger.error(
            "apps/api 鉴权失败 %s：%s %s — 响应 %s",
            resp.status_code,
            method,
            url,
            resp.text[:200],
        )
        raise HTTPException(
            status_code=503,
            detail={
                "success": False,
                "data": None,
                "error": {
                    "code": "UPSTREAM_AUTH_FAILED",
                    "message": "鉴权失败 (请检查 ZENITHJOY_INTERNAL_TOKEN)",
                },
            },
        )

    # 其他非 2xx 透传
    try:
        body = resp.json()
    except ValueError:
        body = {"raw": resp.text}

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=body)

    return body


# ─── 兼容 shim（PR-b 留空，避免 server.py import 报错） ─────────────────
# 历史上 server.py 会调 set_db_path / ensure_schema。
# 迁到 HTTP 转发后，这两个函数不再有语义，保留空壳兼容老调用。


def set_db_path(_path: Any) -> None:  # pragma: no cover - 历史兼容
    logger.debug("set_db_path 调用被忽略（PR-b 起 topics 走 HTTP 转发）")


def ensure_schema(_path: Any) -> None:  # pragma: no cover - 历史兼容
    logger.debug("ensure_schema 调用被忽略（PR-b 起 topics 走 HTTP 转发）")


# ─── Router ───────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("")
async def list_topics(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_deleted: bool = Query(False),
) -> dict[str, Any]:
    """列出选题。参数透传到 apps/api `GET /api/topics`。"""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if status is not None:
        params["status"] = status
    if include_deleted:
        params["include_deleted"] = "true"
    return await _forward("GET", "/api/topics", params=params)


@router.get("/pacing/config")
async def get_pacing_config() -> dict[str, Any]:
    """pacing 配置 GET。兼容路径 `/api/topics/pacing/config`，转发到 apps/api
    `GET /api/pacing-config`（PR-a 新端点）。"""
    return await _forward("GET", "/api/pacing-config")


@router.patch("/pacing/config")
async def update_pacing_config(request: Request) -> dict[str, Any]:
    """pacing 配置 PATCH（兼容路径，转发到 apps/api `PATCH /api/pacing-config`）。"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    return await _forward("PATCH", "/api/pacing-config", json_body=body)


@router.get("/{topic_id}")
async def get_topic(topic_id: str) -> dict[str, Any]:
    """读取单条选题。"""
    return await _forward("GET", f"/api/topics/{topic_id}")


@router.post("", status_code=201)
async def create_topic(request: Request) -> dict[str, Any]:
    """创建选题。body 原样透传（apps/api 侧做字段校验）。"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    return await _forward("POST", "/api/topics", json_body=body)


@router.patch("/{topic_id}")
async def update_topic(topic_id: str, request: Request) -> dict[str, Any]:
    """部分更新选题。"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    return await _forward("PATCH", f"/api/topics/{topic_id}", json_body=body)


@router.delete("/{topic_id}")
async def delete_topic(topic_id: str, hard: bool = Query(False)) -> dict[str, Any]:
    """删除选题（默认软删）。"""
    params = {"hard": "true"} if hard else None
    return await _forward("DELETE", f"/api/topics/{topic_id}", params=params)
