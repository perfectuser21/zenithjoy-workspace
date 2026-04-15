"""server.py 中 POST /api/pipelines 入口校验单测（选题池 v1）。

验证：
- 无 topic_id → 400 TOPIC_ID_REQUIRED
- 缺 content_type → 400 CONTENT_TYPE_REQUIRED
- 带 X-Manual-Override: true → 放行（即使无 topic_id）
- 带合法 topic_id → 转发到 apps/api（mock 上游）
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """加载 server.py 的 app；DB 路径指向临时文件。"""
    db_path = tmp_path / "creator-test.db"
    monkeypatch.setenv("CREATOR_PIPELINE_API", "http://upstream-stub")

    # 先确保 topics 模块用临时 DB
    from api import topics as topics_module
    topics_module.ensure_schema(db_path)

    # 让 server.init_db 用 tmp DB（DB_PATH 在模块顶层定义，这里 monkeypatch）
    import importlib
    if "api.server" in sys.modules:
        del sys.modules["api.server"]
    server = importlib.import_module("api.server")
    monkeypatch.setattr(server, "DB_PATH", db_path, raising=True)
    # 重新初始化（works 表）
    server.init_db()
    server.topics_module.set_db_path(db_path)

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
