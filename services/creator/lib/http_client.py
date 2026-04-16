"""ZenithJoyClient — workers 与 apps/api 之间的 HTTP 客户端。

封装 PR-a 暴露的 9 个端点：
- GET  /api/pacing-config
- GET  /api/topics?status=&limit=
- PATCH /api/topics/{id}
- POST /api/pipeline/trigger            (保留老入口)
- GET  /api/pipelines/running
- POST /api/pipelines/{id}/stage-complete
- POST /api/pipelines/{id}/fail

约定：
- 所有端点响应形如 `{success, data, error, timestamp}`（见 apps/api/docs/topics-api.md）
- 鉴权走 `Authorization: Bearer <token>`，token 来自 env `ZENITHJOY_INTERNAL_TOKEN`
- base_url 来自 env `APPS_API_BASE`（默认 http://localhost:5200），兼容旧 env `CREATOR_PIPELINE_API`

错误处理：抛出 `ZenithJoyAPIError`（带 HTTP status、错误码、原始响应），由上层 worker 决定是否告警/退出。
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_API_BASE = "http://localhost:5200"
DEFAULT_TIMEOUT = 30.0


class ZenithJoyAPIError(Exception):
    """apps/api 返回非 2xx 或响应格式异常时抛出。"""

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        code: Optional[str] = None,
        response_json: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.response_json = response_json or {}

    def __str__(self) -> str:  # pragma: no cover - 纯展示
        parts = [super().__str__()]
        if self.status_code is not None:
            parts.append(f"status={self.status_code}")
        if self.code:
            parts.append(f"code={self.code}")
        return " ".join(parts)


class ZenithJoyClient:
    """轻量 HTTP 客户端，串起 apps/api 的内部端点。

    用法：
        client = ZenithJoyClient.from_env()
        pacing = client.get_pacing_config()
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.base_url = (base_url or DEFAULT_API_BASE).rstrip("/")
        self.token = token
        self.timeout = timeout
        self._owns_client = client is None
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = client or httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=timeout,
        )

    # ------------------------------------------------------------------ 工厂

    @classmethod
    def from_env(cls, *, timeout: float = DEFAULT_TIMEOUT) -> "ZenithJoyClient":
        """从环境变量构造 client。

        env 优先级：
          APPS_API_BASE > CREATOR_PIPELINE_API > CREATOR_API_BASE > DEFAULT
        """
        base = (
            os.environ.get("APPS_API_BASE")
            or os.environ.get("CREATOR_PIPELINE_API")
            or os.environ.get("CREATOR_API_BASE")
            or DEFAULT_API_BASE
        )
        token = os.environ.get("ZENITHJOY_INTERNAL_TOKEN")
        return cls(base_url=base, token=token, timeout=timeout)

    # ------------------------------------------------------------------ 资源管理

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "ZenithJoyClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    # ------------------------------------------------------------------ 内部工具

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        try:
            resp = self._client.request(method, path, params=params, json=json_body)
        except httpx.HTTPError as e:
            raise ZenithJoyAPIError(
                f"{method} {path} 请求失败：{e}",
                status_code=None,
            ) from e

        status = resp.status_code
        try:
            payload = resp.json()
        except Exception:  # pragma: no cover - 防御
            payload = {}

        if status >= 400:
            code = None
            message = f"{method} {path} 返回 {status}"
            if isinstance(payload, dict):
                err = payload.get("error") or {}
                if isinstance(err, dict):
                    code = err.get("code")
                    message = err.get("message") or message
            raise ZenithJoyAPIError(
                message,
                status_code=status,
                code=code,
                response_json=payload if isinstance(payload, dict) else None,
            )

        if not isinstance(payload, dict) or not payload.get("success", False):
            raise ZenithJoyAPIError(
                f"{method} {path} 响应未标记成功：{payload}",
                status_code=status,
                response_json=payload if isinstance(payload, dict) else None,
            )

        return payload

    @staticmethod
    def _data(payload: dict[str, Any]) -> Any:
        return payload.get("data")

    # ------------------------------------------------------------------ pacing

    def get_pacing_config(self) -> dict[str, Any]:
        payload = self._request("GET", "/api/pacing-config")
        data = self._data(payload) or {}
        return data

    # ------------------------------------------------------------------ topics

    def list_topics(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        payload = self._request("GET", "/api/topics", params=params)
        data = self._data(payload) or {}
        items = data.get("items")
        if not isinstance(items, list):
            if isinstance(data, list):
                return data
            return []
        return items

    def patch_topic(self, topic_id: str, body: dict[str, Any]) -> dict[str, Any]:
        payload = self._request("PATCH", f"/api/topics/{topic_id}", json_body=body)
        data = self._data(payload) or {}
        return data

    # ------------------------------------------------------------------ pipeline 入口

    def trigger_pipeline(self, body: dict[str, Any]) -> dict[str, Any]:
        """POST /api/pipeline/trigger — 返回 apps/api 原始响应 JSON（保留外层 success/data）。"""
        payload = self._request("POST", "/api/pipeline/trigger", json_body=body)
        return payload

    # ------------------------------------------------------------------ worker 专用

    def list_running_pipelines(self, limit: int = 50) -> list[dict[str, Any]]:
        params = {"limit": limit}
        payload = self._request("GET", "/api/pipelines/running", params=params)
        data = self._data(payload) or {}
        items = data.get("items")
        if not isinstance(items, list):
            return []
        return items

    def stage_complete(
        self,
        pipeline_id: str,
        stage: str,
        *,
        output: Optional[dict[str, Any]] = None,
        is_final: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"stage": stage}
        if output:
            body["output"] = output
        if is_final:
            body["is_final"] = True
        payload = self._request(
            "POST",
            f"/api/pipelines/{pipeline_id}/stage-complete",
            json_body=body,
        )
        return self._data(payload) or {}

    def fail_pipeline(
        self,
        pipeline_id: str,
        error: str,
        *,
        stage: Optional[str] = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"error": error}
        if stage:
            body["stage"] = stage
        payload = self._request(
            "POST",
            f"/api/pipelines/{pipeline_id}/fail",
            json_body=body,
        )
        return self._data(payload) or {}


__all__ = ["ZenithJoyClient", "ZenithJoyAPIError", "DEFAULT_API_BASE"]
