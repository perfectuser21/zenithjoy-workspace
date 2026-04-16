"""PR-b：topics HTTP 转发层单测

验证 creator-api 的 `/api/topics` 路由是否正确把请求转发到 apps/api：

- 每个 CRUD 都命中正确的 upstream method + path + body
- Authorization: Bearer <token> 正确携带
- apps/api 不可达 → 503（UPSTREAM_UNREACHABLE）
- apps/api 401 → 503（UPSTREAM_AUTH_FAILED）
- apps/api 其他错误（404/400/500）透传
- 无 token 时不带 Authorization header（apps/api dev 友好模式）
- pacing 兼容路径转发到 `/api/pacing-config`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# 把 services/creator 加入 sys.path（这样可以 `from api import topics`）
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import topics as topics_module  # noqa: E402


# ─── helpers ──────────────────────────────────────────────────────────


class CapturedRequest:
    """记录 httpx.MockTransport 收到的请求快照。"""

    def __init__(self) -> None:
        self.method: str | None = None
        self.url: httpx.URL | None = None
        self.headers: httpx.Headers | None = None
        self.body: dict | None = None

    def capture(self, request: httpx.Request) -> None:
        self.method = request.method
        self.url = request.url
        self.headers = request.headers
        if request.content:
            try:
                self.body = json.loads(request.content)
            except ValueError:
                self.body = {"raw": request.content.decode("utf-8", "replace")}
        else:
            self.body = None


def _install_mock_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler,
) -> CapturedRequest:
    """把 httpx.AsyncClient 的 transport 替换成 MockTransport。"""
    captured = CapturedRequest()

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.capture(request)
        return handler(request)

    transport = httpx.MockTransport(_handler)
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        kwargs["transport"] = transport
        return original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)
    return captured


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(topics_module.router)
    return app


@pytest.fixture()
def client_with_token(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("APPS_API_BASE", "http://apps-api.test")
    monkeypatch.setenv("ZENITHJOY_INTERNAL_TOKEN", "test-secret-token")
    return TestClient(_build_app())


@pytest.fixture()
def client_without_token(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("APPS_API_BASE", "http://apps-api.test")
    monkeypatch.delenv("ZENITHJOY_INTERNAL_TOKEN", raising=False)
    return TestClient(_build_app())


# ─── GET /api/topics ──────────────────────────────────────────────────


def test_list_forwards_with_auth(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={
                "success": True,
                "data": {"items": [{"id": "x"}], "total": 1, "limit": 50, "offset": 0},
                "error": None,
            },
        ),
    )

    resp = client_with_token.get("/api/topics?status=待研究&limit=10&offset=5")

    assert resp.status_code == 200
    assert resp.json()["data"]["items"] == [{"id": "x"}]
    assert captured.method == "GET"
    assert captured.url is not None
    assert captured.url.path == "/api/topics"
    # query 透传
    assert captured.url.params.get("status") == "待研究"
    assert captured.url.params.get("limit") == "10"
    assert captured.url.params.get("offset") == "5"
    # auth header
    assert captured.headers is not None
    assert captured.headers.get("authorization") == "Bearer test-secret-token"


def test_list_include_deleted(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={"success": True, "data": {"items": [], "total": 0}, "error": None},
        ),
    )
    client_with_token.get("/api/topics?include_deleted=true")
    assert captured.url is not None
    assert captured.url.params.get("include_deleted") == "true"


# ─── GET /api/topics/:id ──────────────────────────────────────────────


def test_get_one_forwards(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={"success": True, "data": {"id": "topic-123"}, "error": None},
        ),
    )
    resp = client_with_token.get("/api/topics/topic-123")
    assert resp.status_code == 200
    assert captured.method == "GET"
    assert captured.url is not None
    assert captured.url.path == "/api/topics/topic-123"


# ─── POST /api/topics ─────────────────────────────────────────────────


def test_create_forwards_body_and_auth(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            201,
            json={"success": True, "data": {"id": "new-id", "title": "t"}, "error": None},
        ),
    )
    payload = {"title": "t", "priority": 10, "status": "待研究"}
    resp = client_with_token.post("/api/topics", json=payload)
    assert resp.status_code == 201
    assert captured.method == "POST"
    assert captured.url is not None
    assert captured.url.path == "/api/topics"
    assert captured.body == payload
    assert captured.headers is not None
    assert captured.headers.get("authorization") == "Bearer test-secret-token"


# ─── PATCH /api/topics/:id ────────────────────────────────────────────


def test_patch_forwards(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={"success": True, "data": {"id": "t1", "status": "已通过"}, "error": None},
        ),
    )
    resp = client_with_token.patch("/api/topics/t1", json={"status": "已通过"})
    assert resp.status_code == 200
    assert captured.method == "PATCH"
    assert captured.url is not None
    assert captured.url.path == "/api/topics/t1"
    assert captured.body == {"status": "已通过"}


# ─── DELETE /api/topics/:id ───────────────────────────────────────────


def test_delete_soft_forwards(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={
                "success": True,
                "data": {"id": "t1", "deleted": True, "hard": False},
                "error": None,
            },
        ),
    )
    resp = client_with_token.delete("/api/topics/t1")
    assert resp.status_code == 200
    assert captured.method == "DELETE"
    assert captured.url is not None
    assert captured.url.path == "/api/topics/t1"
    # 软删不带 hard 参数
    assert captured.url.params.get("hard") is None


def test_delete_hard_forwards(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200,
            json={
                "success": True,
                "data": {"id": "t1", "deleted": True, "hard": True},
                "error": None,
            },
        ),
    )
    client_with_token.delete("/api/topics/t1?hard=true")
    assert captured.url is not None
    assert captured.url.params.get("hard") == "true"


# ─── 错误处理 ─────────────────────────────────────────────────────────


def test_upstream_unreachable_returns_503(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused", request=request)

    _install_mock_transport(monkeypatch, _raise)

    resp = client_with_token.get("/api/topics")
    assert resp.status_code == 503
    body = resp.json()["detail"]
    assert body["error"]["code"] == "UPSTREAM_UNREACHABLE"
    assert "apps/api" in body["error"]["message"]


def test_upstream_401_maps_to_503_auth_failed(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            401, json={"success": False, "error": {"code": "UNAUTHORIZED"}}
        ),
    )
    resp = client_with_token.get("/api/topics")
    assert resp.status_code == 503
    body = resp.json()["detail"]
    assert body["error"]["code"] == "UPSTREAM_AUTH_FAILED"
    assert "ZENITHJOY_INTERNAL_TOKEN" in body["error"]["message"]


def test_upstream_404_passes_through(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            404,
            json={
                "success": False,
                "data": None,
                "error": {"code": "NOT_FOUND", "message": "topic not found"},
            },
        ),
    )
    resp = client_with_token.get("/api/topics/missing")
    assert resp.status_code == 404
    body = resp.json()["detail"]
    assert body["error"]["code"] == "NOT_FOUND"


def test_upstream_400_passes_through(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            400,
            json={
                "success": False,
                "error": {"code": "INVALID_STATUS", "message": "bad"},
            },
        ),
    )
    resp = client_with_token.post("/api/topics", json={"title": "x", "status": "乱"})
    assert resp.status_code == 400
    body = resp.json()["detail"]
    assert body["error"]["code"] == "INVALID_STATUS"


# ─── 无 token（dev 模式）─────────────────────────────────────────────


def test_no_token_skips_authorization_header(
    client_without_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200, json={"success": True, "data": {"items": []}, "error": None}
        ),
    )
    client_without_token.get("/api/topics")
    assert captured.headers is not None
    assert "authorization" not in {k.lower() for k in captured.headers.keys()}


# ─── pacing 兼容路径转发 ─────────────────────────────────────────────


def test_pacing_get_forwards_to_new_endpoint(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200, json={"success": True, "data": {"daily_limit": 2}, "error": None}
        ),
    )
    resp = client_with_token.get("/api/topics/pacing/config")
    assert resp.status_code == 200
    assert resp.json()["data"]["daily_limit"] == 2
    assert captured.url is not None
    # 老路径 /api/topics/pacing/config 转发到 apps/api 新端点 /api/pacing-config
    assert captured.url.path == "/api/pacing-config"
    assert captured.method == "GET"


def test_pacing_patch_forwards_body(
    client_with_token: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured = _install_mock_transport(
        monkeypatch,
        lambda req: httpx.Response(
            200, json={"success": True, "data": {"daily_limit": 5}, "error": None}
        ),
    )
    resp = client_with_token.patch(
        "/api/topics/pacing/config", json={"daily_limit": 5}
    )
    assert resp.status_code == 200
    assert captured.url is not None
    assert captured.url.path == "/api/pacing-config"
    assert captured.method == "PATCH"
    assert captured.body == {"daily_limit": 5}
