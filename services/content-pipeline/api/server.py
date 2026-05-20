#!/usr/bin/env python3
"""Creator API 服务

PR-e/5（彻底重构）起：creator-api 不再读写 SQLite creator.db。
- topics 相关路由：全部转发到 apps/api（见 api/topics.py）
- pipeline 入口：本地做 topic_id 强校验 + 转发 apps/api
- 静态文件：保留前端资源服务
- 启动时：ping apps/api /health（失败仅打 warning，不 block 启动）

历史（已删除）：
- works / publications / properties / settings / stats / notion 透传端点
  （实际 dashboard 通过 apps/api `/api/works` 消费，creator-api 侧是死代码）
- init_db()：不再在 SQLite creator.db 中建表（PR-d 已 cutover，SQLite 仅留观察）
- DB_PATH / get_db()：彻底删除

端口：8899（unchanged — 供 HK nginx `/api/topics` 入口 + pipeline 入口保留）。
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# topics 模块（同包下，运行时和包内 import 都兼容）
try:
    from api import topics as topics_module  # 当 PYTHONPATH 含 services/creator
except ImportError:  # pragma: no cover
    import topics as topics_module  # type: ignore  # fallback：直接在 api/ 下运行

logger = logging.getLogger("creator-api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时 ping apps/api /health；不可达仅 warning。"""
    url = f"{APPS_API_BASE}/health"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
        if resp.status_code == 200:
            logger.info("apps/api 可达：%s", url)
        else:
            logger.warning(
                "apps/api /health 返回 %s（期望 200），topics 转发可能受影响",
                resp.status_code,
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("apps/api 不可达（%s），topics 转发将在请求时报 503：%s", url, e)
    yield


app = FastAPI(title="ZenithJoy Creator API", version="2.0.0-pr-e", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── 配置 ────────────────────────────────────────────────────────────
APPS_API_BASE = os.environ.get(
    "CREATOR_PIPELINE_API",
    os.environ.get("APPS_API_BASE", "http://localhost:5200"),
).rstrip("/")


# ─── 健康检查 ────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    """本服务 liveness。独立于 apps/api。"""
    return {"status": "ok", "service": "creator-api", "version": app.version}


# ─── topics 路由（HTTP 转发到 apps/api） ─────────────────────────────
app.include_router(topics_module.router)


# ─── pipeline 入口强校验（选题池 v1 + PR-e） ────────────────────────
# server.py 不直接创建 pipeline（实际 pipeline 在 apps/api 维护），
# 但提供一个本地代理入口供脚本/n8n 复用，统一做 topic_id 校验，
# 防止任何"扩词机器"绕过主理人清单。
#
# 真正派发：转发到 apps/api 的 POST /api/pipeline/trigger。
# 头 X-Manual-Override: true 可豁免（主理人手动场景）。


@app.post("/api/pipelines")
async def create_pipeline(
    request: Request,
    x_manual_override: Optional[str] = Header(default=None),
):
    """选题池 v1：拒绝无 topic_id 的 pipeline 创建请求（除非主理人手动 override）。"""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    if not body.get("content_type"):
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "data": None,
                "error": {
                    "code": "CONTENT_TYPE_REQUIRED",
                    "message": "content_type 为必填字段",
                },
            },
        )

    manual_override = (x_manual_override or "").lower() == "true"
    if not body.get("topic_id") and not manual_override:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "data": None,
                "error": {
                    "code": "TOPIC_ID_REQUIRED",
                    "message": "topic_id 为必填（选题池 v1 强校验）。如需手动创建，请加 header X-Manual-Override: true",
                },
            },
        )

    # 真正派发交给 apps/api（由它和 cecelia Brain 通信）
    async with httpx.AsyncClient() as client:
        headers = {"Content-Type": "application/json"}
        if manual_override:
            headers["X-Manual-Override"] = "true"
        try:
            resp = await client.post(
                f"{APPS_API_BASE}/api/pipeline/trigger",
                json=body,
                headers=headers,
                timeout=30.0,
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail={
                    "success": False,
                    "data": None,
                    "error": {"code": "UPSTREAM_UNREACHABLE", "message": str(e)},
                },
            ) from e

    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        data = {"raw": resp.text}

    if resp.status_code >= 400:
        raise HTTPException(
            status_code=resp.status_code,
            detail={
                "success": False,
                "data": None,
                "error": {"code": "UPSTREAM_ERROR", "message": data},
            },
        )
    return {"success": True, "data": data, "error": None}


# ─── 静态文件（保留前端资源服务） ────────────────────────────────────
parent_dir = Path(__file__).parent.parent
app.mount("/", StaticFiles(directory=str(parent_dir), html=True), name="static")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8899)
