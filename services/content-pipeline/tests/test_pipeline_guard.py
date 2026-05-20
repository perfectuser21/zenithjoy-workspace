"""server.py 中 POST /api/pipelines 入口校验单测（选题池 v1 + PR-e/5）。

验证：
- 无 topic_id → 400 TOPIC_ID_REQUIRED
- 缺 content_type → 400 CONTENT_TYPE_REQUIRED
- 带 X-Manual-Override: true → 放行（即使无 topic_id）
- 带合法 topic_id → 转发到 apps/api（mock 上游）

PR-e 改造：server.py 不再持有 SQLite DB_PATH / init_db()，
本测试直接加载 FastAPI app，不再做 DB 初始化。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(monkeypatch):
    """加载 server.py 的 app（无 SQLite 依赖）。"""
    monkeypatch.setenv("CREATOR_PIPELINE_API", "http://upstream-stub")

    # 清掉缓存，确保 env 生效
    import importlib
    if "api.server" in sys.modules:
        del sys.modules["api.server"]
    server = importlib.import_module("api.server")

    from fastapi.testclient import TestClient
    return TestClient(server.app)


def test_missing_content_type_returns_400(client):
    resp = client.post("/api/pipelines", json={"topic_id": "abc"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "CONTENT_TYPE_REQUIRED"


def test_missing_topic_id_returns_400(client):
    resp = client.post("/api/pipelines", json={"content_type": "post"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "TOPIC_ID_REQUIRED"


def test_manual_override_allows_missing_topic_id(client, monkeypatch):
    # mock httpx 上游
    import httpx

    class _MockResp:
        status_code = 201
        text = "{}"

        def json(self):
            return {"id": "fake-pipeline-x"}

    class _MockClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            return _MockResp()

    monkeypatch.setattr(httpx, "AsyncClient", _MockClient)
    resp = client.post(
        "/api/pipelines",
        json={"content_type": "post"},
        headers={"X-Manual-Override": "true"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    # PR-e 统一响应契约：data 是 apps/api 返回的 payload（这里 mock 返回 {id,...}）
    assert body["data"]["id"] == "fake-pipeline-x"


def test_topic_id_provided_forwards_upstream(client, monkeypatch):
    import httpx

    class _MockResp:
        status_code = 201
        text = "{}"

        def json(self):
            return {"id": "real-pipeline-y", "status": "running"}

    captured = {}

    class _MockClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None, timeout=None):
            captured["url"] = url
            captured["json"] = json
            return _MockResp()

    monkeypatch.setattr(httpx, "AsyncClient", _MockClient)

    resp = client.post(
        "/api/pipelines",
        json={"content_type": "post", "topic_id": "topic-zzz", "topic": "示例"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["id"] == "real-pipeline-y"
    assert captured["url"].endswith("/api/pipeline/trigger")
    assert captured["json"]["topic_id"] == "topic-zzz"
