"""topic-worker HTTP 化单测（PR-c）。

覆盖：
- daily_limit 解析：env > pacing-config > 默认 1
- list_topics 被调用：status=已通过，limit 合理
- scheduled_date 本地过滤
- dry-run 不发起 PATCH / trigger
- apply 成功：trigger_pipeline + patch_topic 被调用，status='研究中' + pipeline_id
- apply 失败：topic 保持'已通过'，结果标 error
- 401/403：抛 ZenithJoyAPIError，run 层不吞

所有 HTTP 调用通过 httpx.MockTransport 拦截，不走网络。
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Callable

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.http_client import ZenithJoyAPIError, ZenithJoyClient  # noqa: E402

# 加载 topic-worker（带连字符）
WORKER_PATH = ROOT / "scripts" / "topic-worker.py"
spec = importlib.util.spec_from_file_location("topic_worker", WORKER_PATH)
assert spec and spec.loader
topic_worker = importlib.util.module_from_spec(spec)
sys.modules["topic_worker"] = topic_worker
spec.loader.exec_module(topic_worker)


# ──────────────────────────────────────────────────────────────────── helpers

def _ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data, "error": None, "timestamp": "x"}


def _err(code: str, message: str, status: int = 400) -> tuple[int, dict[str, Any]]:
    return status, {
        "success": False,
        "data": None,
        "error": {"code": code, "message": message, "details": {}},
        "timestamp": "x",
    }


def make_client(handler: Callable[[httpx.Request], httpx.Response]) -> ZenithJoyClient:
    transport = httpx.MockTransport(handler)
    http = httpx.Client(
        base_url="http://stub",
        headers={"Content-Type": "application/json", "Authorization": "Bearer T"},
        transport=transport,
    )
    return ZenithJoyClient(base_url="http://stub", token="T", client=http)


# ──────────────────────────────────────────────────────────────────── 测试


def test_daily_limit_env_wins(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "7")
    calls: list[str] = []

    def handler(req):  # pragma: no cover - 不应被调
        calls.append(req.url.path)
        return httpx.Response(200, json=_ok({"daily_limit": 99}))

    client = make_client(handler)
    try:
        assert topic_worker._resolve_daily_limit(client) == 7
        assert calls == []  # env 命中 → 完全不调 apps/api
    finally:
        client.close()


def test_daily_limit_falls_back_to_pacing_config(monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)
    paths: list[str] = []

    def handler(req):
        paths.append(req.url.path)
        assert req.url.path == "/api/pacing-config"
        return httpx.Response(200, json=_ok({"daily_limit": 3}))

    client = make_client(handler)
    try:
        assert topic_worker._resolve_daily_limit(client) == 3
        assert paths == ["/api/pacing-config"]
    finally:
        client.close()


def test_daily_limit_default_on_api_failure(monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)

    def handler(req):
        return httpx.Response(500, json=_err("INTERNAL_ERROR", "boom", 500)[1])

    client = make_client(handler)
    try:
        assert topic_worker._resolve_daily_limit(client) == 1
    finally:
        client.close()


def test_daily_limit_401_bubbles(monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)

    def handler(req):
        return httpx.Response(401, json=_err("UNAUTHORIZED", "token 缺失", 401)[1])

    client = make_client(handler)
    try:
        with pytest.raises(ZenithJoyAPIError) as exc:
            topic_worker._resolve_daily_limit(client)
        assert exc.value.status_code == 401
    finally:
        client.close()


def test_dry_run_lists_topics_no_mutation(monkeypatch):
    monkeypatch.delenv("TOPIC_DAILY_LIMIT", raising=False)
    seen: list[tuple[str, str]] = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.url.path == "/api/pacing-config":
            return httpx.Response(200, json=_ok({"daily_limit": 2}))
        if req.url.path == "/api/topics" and req.method == "GET":
            params = dict(req.url.params)
            assert params["status"] == "已通过"
            return httpx.Response(
                200,
                json=_ok({
                    "items": [
                        {"id": "t1", "title": "A", "scheduled_date": None, "priority": 10},
                        {"id": "t2", "title": "B", "scheduled_date": None, "priority": 20},
                    ],
                    "total": 2,
                }),
            )
        raise AssertionError(f"未预期的请求：{req.method} {req.url}")

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=False, client=client, today="2026-04-16")
    finally:
        client.close()

    assert summary["apply"] is False
    assert summary["selected"] == 2
    assert all(r["dry_run"] for r in summary["results"])
    # dry-run 只调了 pacing-config + list topics，没有 PATCH / POST
    methods = {m for m, _ in seen}
    assert methods <= {"GET"}


def test_scheduled_date_local_filter(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "10")

    def handler(req):
        if req.url.path == "/api/topics":
            return httpx.Response(
                200,
                json=_ok({
                    "items": [
                        {"id": "p", "title": "过去", "scheduled_date": "2020-01-01"},
                        {"id": "n", "title": "无日期", "scheduled_date": None},
                        {"id": "t", "title": "今日", "scheduled_date": "2026-04-16"},
                        {"id": "f", "title": "未来", "scheduled_date": "2099-01-01"},
                    ],
                    "total": 4,
                }),
            )
        return httpx.Response(404)

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=False, client=client, today="2026-04-16")
    finally:
        client.close()

    titles = [r["title"] for r in summary["results"]]
    assert titles == ["过去", "无日期", "今日"]


def test_apply_dispatches_and_marks_in_progress(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "1")
    events: list[dict[str, Any]] = []

    def handler(req):
        path, method = req.url.path, req.method
        events.append({"method": method, "path": path,
                       "body": json.loads(req.content) if req.content else None})
        if path == "/api/topics" and method == "GET":
            return httpx.Response(200, json=_ok({
                "items": [{"id": "t1", "title": "AI 一人公司", "scheduled_date": None}],
                "total": 1,
            }))
        if path == "/api/pipeline/trigger":
            return httpx.Response(200, json={
                "success": True,
                "data": {"id": "pipe-001"},
                "error": None,
                "timestamp": "x",
            })
        if path == "/api/topics/t1" and method == "PATCH":
            return httpx.Response(200, json=_ok({"id": "t1", "status": "研究中"}))
        raise AssertionError(f"未预期的请求：{method} {path}")

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=True, client=client, today="2026-04-16")
    finally:
        client.close()

    assert summary["selected"] == 1
    res = summary["results"][0]
    assert res["dispatched"] is True
    assert res["pipeline_id"] == "pipe-001"

    # trigger 收到了 topic_id
    trigger_event = next(e for e in events if e["path"] == "/api/pipeline/trigger")
    assert trigger_event["body"]["topic_id"] == "t1"
    assert trigger_event["body"]["triggered_by"] == "topic-worker"

    # patch 收到 status + pipeline_id
    patch_event = next(
        e for e in events if e["method"] == "PATCH" and e["path"] == "/api/topics/t1"
    )
    assert patch_event["body"] == {"status": "研究中", "pipeline_id": "pipe-001"}


def test_apply_dispatch_failure_does_not_patch(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "1")
    seen_methods: list[str] = []

    def handler(req):
        seen_methods.append(f"{req.method} {req.url.path}")
        if req.url.path == "/api/topics" and req.method == "GET":
            return httpx.Response(200, json=_ok({
                "items": [{"id": "t1", "title": "X", "scheduled_date": None}],
                "total": 1,
            }))
        if req.url.path == "/api/pipeline/trigger":
            return httpx.Response(500, json=_err("INTERNAL_ERROR", "boom", 500)[1])
        raise AssertionError(f"未预期的请求：{req.method} {req.url}")

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=True, client=client, today="2026-04-16")
    finally:
        client.close()

    res = summary["results"][0]
    assert res["dispatched"] is False
    assert "error" in res

    # 没调 PATCH
    assert not any(m.startswith("PATCH ") for m in seen_methods)


def test_apply_auth_failure_propagates(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "1")

    def handler(req):
        if req.url.path == "/api/topics":
            return httpx.Response(200, json=_ok({
                "items": [{"id": "t1", "title": "X", "scheduled_date": None}],
                "total": 1,
            }))
        if req.url.path == "/api/pipeline/trigger":
            return httpx.Response(401, json=_err("UNAUTHORIZED", "nope", 401)[1])
        raise AssertionError

    client = make_client(handler)
    try:
        with pytest.raises(ZenithJoyAPIError) as exc:
            topic_worker.run(apply=True, client=client, today="2026-04-16")
        assert exc.value.status_code == 401
    finally:
        client.close()


def test_list_topics_unreachable_returns_empty(monkeypatch):
    """apps/api 不可达（所有端点 500）时，run 不 crash，只记录 error。"""
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "1")

    def handler(req):
        return httpx.Response(503, json=_err("INTERNAL_ERROR", "down", 503)[1])

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=False, client=client, today="2026-04-16")
    finally:
        client.close()

    assert summary["selected"] == 0
    assert summary["results"] == []
    assert "error" in summary


def test_limit_zero_short_circuits(monkeypatch):
    monkeypatch.setenv("TOPIC_DAILY_LIMIT", "0")
    touched: list[str] = []

    def handler(req):
        touched.append(req.url.path)
        return httpx.Response(404)

    client = make_client(handler)
    try:
        summary = topic_worker.run(apply=False, client=client, today="2026-04-16")
    finally:
        client.close()

    assert summary["limit"] == 0
    assert summary["selected"] == 0
    # 0 limit 不该发 topics 请求
    assert all("/api/topics" not in p for p in touched)
