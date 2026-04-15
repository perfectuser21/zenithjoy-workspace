"""topics API 单测

覆盖：
- GET 列表：空、按 status 过滤、分页、非法 status
- GET 单条：存在/不存在
- POST：成功、缺字段（422）、非法 status
- PATCH：更新单字段、target_platforms、不存在、空 body
- DELETE：软删（默认从列表消失）、硬删（hard=true）
- pacing 配置：默认 daily_limit=1、可更新
- 软删 topic 不出现在列表
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# 把 services/creator 加入 sys.path（这样可以 `from api import topics`）
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import topics as topics_module  # noqa: E402


@pytest.fixture()
def client(tmp_path) -> TestClient:
    db_path = tmp_path / "creator-test.db"
    topics_module.ensure_schema(db_path)
    topics_module.set_db_path(db_path)

    app = FastAPI()
    app.include_router(topics_module.router)
    return TestClient(app)


# ─── GET 列表 ──────────────────────────────────────────────────────


def test_list_empty(client):
    resp = client.get("/api/topics")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["data"]["items"] == []
    assert body["data"]["total"] == 0


def test_list_invalid_status(client):
    resp = client.get("/api/topics?status=不存在的状态")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "INVALID_STATUS"


def test_list_pagination_and_priority_order(client):
    # 创建 3 条不同优先级
    for title, prio in [("A", 30), ("B", 10), ("C", 20)]:
        r = client.post("/api/topics", json={"title": title, "priority": prio})
        assert r.status_code == 201, r.text

    resp = client.get("/api/topics?limit=2&offset=0")
    items = resp.json()["data"]["items"]
    assert len(items) == 2
    assert [i["title"] for i in items] == ["B", "C"]  # 按 priority ASC

    resp = client.get("/api/topics?limit=2&offset=2")
    items = resp.json()["data"]["items"]
    assert [i["title"] for i in items] == ["A"]
    assert resp.json()["data"]["total"] == 3


def test_list_filter_by_status(client):
    client.post("/api/topics", json={"title": "x", "status": "待研究"})
    client.post("/api/topics", json={"title": "y", "status": "已通过"})
    resp = client.get("/api/topics?status=已通过")
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["title"] == "y"


# ─── GET 单条 ──────────────────────────────────────────────────────


def test_get_one_not_found(client):
    resp = client.get("/api/topics/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"


def test_get_one_returns_parsed_platforms(client):
    r = client.post(
        "/api/topics",
        json={"title": "T", "target_platforms": ["xiaohongshu", "weibo"]},
    )
    tid = r.json()["data"]["id"]
    detail = client.get(f"/api/topics/{tid}").json()["data"]
    assert detail["target_platforms"] == ["xiaohongshu", "weibo"]


# ─── POST ──────────────────────────────────────────────────────────


def test_create_minimal(client):
    resp = client.post("/api/topics", json={"title": "新选题"})
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["title"] == "新选题"
    assert data["status"] == "待研究"
    assert data["priority"] == 100
    assert len(data["target_platforms"]) == 8  # 默认 8 平台


def test_create_missing_title(client):
    resp = client.post("/api/topics", json={"angle": "侧写"})
    assert resp.status_code == 422  # pydantic 校验


def test_create_invalid_status(client):
    resp = client.post("/api/topics", json={"title": "X", "status": "未知态"})
    assert resp.status_code == 422


def test_create_empty_title(client):
    resp = client.post("/api/topics", json={"title": ""})
    assert resp.status_code == 422


# ─── PATCH ─────────────────────────────────────────────────────────


def test_patch_status_and_priority(client):
    tid = client.post("/api/topics", json={"title": "原"}).json()["data"]["id"]
    resp = client.patch(
        f"/api/topics/{tid}",
        json={"status": "已通过", "priority": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "已通过"
    assert resp.json()["data"]["priority"] == 1


def test_patch_target_platforms(client):
    tid = client.post("/api/topics", json={"title": "X"}).json()["data"]["id"]
    resp = client.patch(
        f"/api/topics/{tid}", json={"target_platforms": ["wechat"]}
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["target_platforms"] == ["wechat"]


def test_patch_empty_body(client):
    tid = client.post("/api/topics", json={"title": "X"}).json()["data"]["id"]
    resp = client.patch(f"/api/topics/{tid}", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "NO_FIELDS"


def test_patch_invalid_status(client):
    tid = client.post("/api/topics", json={"title": "X"}).json()["data"]["id"]
    resp = client.patch(f"/api/topics/{tid}", json={"status": "胡乱"})
    assert resp.status_code == 422


def test_patch_not_found(client):
    resp = client.patch("/api/topics/nonexistent", json={"status": "已通过"})
    assert resp.status_code == 404


# ─── DELETE ───────────────────────────────────────────────────────


def test_soft_delete_hides_from_list(client):
    tid = client.post("/api/topics", json={"title": "待删"}).json()["data"]["id"]
    resp = client.delete(f"/api/topics/{tid}")
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True

    items = client.get("/api/topics").json()["data"]["items"]
    assert all(i["id"] != tid for i in items)

    items = client.get("/api/topics?include_deleted=true").json()["data"]["items"]
    assert any(i["id"] == tid for i in items)


def test_hard_delete(client):
    tid = client.post("/api/topics", json={"title": "硬删"}).json()["data"]["id"]
    resp = client.delete(f"/api/topics/{tid}?hard=true")
    assert resp.status_code == 200
    assert resp.json()["data"]["hard"] is True

    items = (
        client.get("/api/topics?include_deleted=true").json()["data"]["items"]
    )
    assert all(i["id"] != tid for i in items)


def test_delete_not_found(client):
    resp = client.delete("/api/topics/missing")
    assert resp.status_code == 404


def test_get_soft_deleted_returns_404(client):
    tid = client.post("/api/topics", json={"title": "X"}).json()["data"]["id"]
    client.delete(f"/api/topics/{tid}")
    assert client.get(f"/api/topics/{tid}").status_code == 404


# ─── pacing 配置 ───────────────────────────────────────────────────


def test_pacing_default(client):
    resp = client.get("/api/topics/pacing/config")
    assert resp.status_code == 200
    assert resp.json()["data"]["daily_limit"] == 1


def test_pacing_update(client):
    resp = client.patch("/api/topics/pacing/config", json={"daily_limit": 5})
    assert resp.status_code == 200
    assert resp.json()["data"]["daily_limit"] == 5

    # 持久化
    resp = client.get("/api/topics/pacing/config")
    assert resp.json()["data"]["daily_limit"] == 5


def test_pacing_invalid_value(client):
    resp = client.patch(
        "/api/topics/pacing/config", json={"daily_limit": -1}
    )
    assert resp.status_code == 422


def test_pacing_empty_update(client):
    resp = client.patch("/api/topics/pacing/config", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "NO_FIELDS"
