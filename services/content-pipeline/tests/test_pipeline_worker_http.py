"""pipeline-worker HTTP 化单测（PR-c）。

覆盖：
- process_pipeline dry-run 不调 apps/api
- 所有 6 阶段成功 → stage-complete 6 次，最后一次 is_final=true
- 某阶段 executor 返回 success=false → fail_pipeline，后续阶段不执行
- review_passed=false → fail_pipeline，带 stage
- can_run 拒绝 → fail_pipeline
- stage-complete 上报 401 → 冒泡退出（main 层转成 exit 3）
- apps/api 不可达（list_running_pipelines 500）→ main 返回 0（下轮再试），不崩

所有 HTTP 通过 httpx.MockTransport 拦截。
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable
from unittest.mock import patch

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.http_client import ZenithJoyAPIError, ZenithJoyClient  # noqa: E402
from pipeline_worker import worker as worker_module  # noqa: E402


def _ok(data):
    return {"success": True, "data": data, "error": None, "timestamp": "x"}


def _err(code, message, status=400):
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


# ──────────────────────────────────────────────────────────────────── process_pipeline


def test_process_pipeline_dry_run_no_http_calls():
    called: list[str] = []

    def handler(req):  # pragma: no cover - 不应被调
        called.append(req.url.path)
        return httpx.Response(500)

    client = make_client(handler)
    try:
        ok = worker_module.process_pipeline(
            client,
            {"id": "p1", "topic_id": "t1", "keyword": "X"},
            dry_run=True,
        )
    finally:
        client.close()
    assert ok is True
    assert called == []


def test_process_pipeline_all_stages_succeed(monkeypatch):
    """6 阶段全成功：期望 stage-complete 调 6 次，最后一次 is_final=true。"""
    calls: list[dict] = []

    def handler(req):
        body = req.read()
        import json as _json
        payload = _json.loads(body) if body else None
        calls.append({
            "method": req.method,
            "path": req.url.path,
            "body": payload,
        })
        if "/stage-complete" in req.url.path:
            return httpx.Response(200, json=_ok({"id": "p1", "status": "running"}))
        return httpx.Response(404)

    client = make_client(handler)

    mock_stages = []
    for name, resource_type, _orig in worker_module.STAGES:
        def make_exec(stage_name):
            def executor(run_data):
                out = {"success": True}
                # generate 阶段假装有 output_dir
                if stage_name == "copywriting":
                    out["output_dir"] = "/tmp/fake-out"
                # 给 review 阶段 review_passed
                if "review" in stage_name:
                    out["review_passed"] = True
                return out
            return executor
        mock_stages.append((name, resource_type, make_exec(name)))

    with patch.object(worker_module, "STAGES", mock_stages), \
         patch.object(worker_module, "can_run", return_value={"approved": True}):
        ok = worker_module.process_pipeline(
            client,
            {"id": "p1", "topic_id": "t1", "keyword": "AI"},
            dry_run=False,
        )
    client.close()

    assert ok is True
    stage_calls = [c for c in calls if "/stage-complete" in c["path"]]
    assert len(stage_calls) == 6, f"期望 6 次 stage-complete，实际 {len(stage_calls)}"
    # 最后一次为 export + is_final
    last = stage_calls[-1]
    assert last["body"]["stage"] == "export"
    assert last["body"].get("is_final") is True

    # 没有 /fail
    assert not any("/fail" in c["path"] for c in calls)


def test_process_pipeline_executor_failure_triggers_fail():
    calls: list[dict] = []

    def handler(req):
        import json as _json
        body = _json.loads(req.read()) if req.content else None
        calls.append({"path": req.url.path, "body": body})
        return httpx.Response(200, json=_ok({"id": "p1", "status": "running"}))

    client = make_client(handler)

    mock_stages = []
    for name, resource_type, _orig in worker_module.STAGES:
        def make_exec(stage_name):
            if stage_name == "copywriting":
                return lambda run_data: {"success": False, "error": "LLM quota 用完"}
            return lambda run_data, _s=stage_name: {
                "success": True,
                "review_passed": True,
            }
        mock_stages.append((name, resource_type, make_exec(name)))

    with patch.object(worker_module, "STAGES", mock_stages), \
         patch.object(worker_module, "can_run", return_value={"approved": True}):
        ok = worker_module.process_pipeline(
            client,
            {"id": "p1", "topic_id": "t1", "keyword": "AI"},
            dry_run=False,
        )
    client.close()

    assert ok is False
    fail_calls = [c for c in calls if "/fail" in c["path"]]
    assert len(fail_calls) == 1
    assert fail_calls[0]["body"]["error"] == "LLM quota 用完"
    assert fail_calls[0]["body"]["stage"] == "copywriting"

    # 后续阶段（generate 等）不应有 stage-complete
    stages_completed = [c["body"]["stage"] for c in calls if "/stage-complete" in c["path"]]
    assert "generate" not in stages_completed


def test_process_pipeline_review_failure_triggers_fail():
    calls: list[dict] = []

    def handler(req):
        import json as _json
        body = _json.loads(req.read()) if req.content else None
        calls.append({"path": req.url.path, "body": body})
        return httpx.Response(200, json=_ok({"id": "p1", "status": "running"}))

    client = make_client(handler)

    mock_stages = []
    for name, resource_type, _orig in worker_module.STAGES:
        if name == "copy_review":
            exec_fn = lambda run_data: {
                "success": True,
                "review_passed": False,
                "issues": ["包含禁用词『最牛』"],
            }
        else:
            exec_fn = lambda run_data, _s=name: {"success": True, "review_passed": True}
        mock_stages.append((name, None, exec_fn))

    with patch.object(worker_module, "STAGES", mock_stages), \
         patch.object(worker_module, "can_run", return_value={"approved": True}):
        ok = worker_module.process_pipeline(
            client,
            {"id": "p1", "topic_id": "t1", "keyword": "AI"},
            dry_run=False,
        )
    client.close()

    assert ok is False
    fail_calls = [c for c in calls if "/fail" in c["path"]]
    assert len(fail_calls) == 1
    assert "审查未通过" in fail_calls[0]["body"]["error"]
    assert "禁用词" in fail_calls[0]["body"]["error"]
    assert fail_calls[0]["body"]["stage"] == "copy_review"


def test_process_pipeline_can_run_denied_triggers_fail():
    calls: list[dict] = []

    def handler(req):
        import json as _json
        body = _json.loads(req.read()) if req.content else None
        calls.append({"path": req.url.path, "body": body})
        return httpx.Response(200, json=_ok({}))

    client = make_client(handler)

    def deny(resource_type):
        return {"approved": False, "reason": "quota", "retry_after": 300}

    # 不改 STAGES，直接让第一个 executor（research）走 can_run
    with patch.object(worker_module, "can_run", side_effect=deny):
        ok = worker_module.process_pipeline(
            client,
            {"id": "p1", "topic_id": "t1", "keyword": "AI"},
            dry_run=False,
        )
    client.close()

    assert ok is False
    fail_calls = [c for c in calls if "/fail" in c["path"]]
    assert len(fail_calls) == 1
    assert "Cecelia 拒绝" in fail_calls[0]["body"]["error"]
    assert fail_calls[0]["body"]["stage"] == "research"


def test_process_pipeline_auth_failure_bubbles():
    """stage-complete 401 → 直接抛 ZenithJoyAPIError 给上层处理。"""

    def handler(req):
        if "/stage-complete" in req.url.path:
            return httpx.Response(401, json=_err("UNAUTHORIZED", "bad token", 401)[1])
        return httpx.Response(200, json=_ok({}))

    client = make_client(handler)

    mock_stages = [
        (name, None, lambda run_data: {"success": True, "review_passed": True})
        for name, _, _ in worker_module.STAGES
    ]

    with patch.object(worker_module, "STAGES", mock_stages), \
         patch.object(worker_module, "can_run", return_value={"approved": True}):
        with pytest.raises(ZenithJoyAPIError) as exc:
            worker_module.process_pipeline(
                client,
                {"id": "p1", "topic_id": "t1", "keyword": "AI"},
                dry_run=False,
            )
    client.close()
    assert exc.value.status_code == 401


# ──────────────────────────────────────────────────────────────────── main()


def test_main_no_pipelines_returns_zero(monkeypatch):
    def handler(req):
        if req.url.path == "/api/pipelines/running":
            return httpx.Response(200, json=_ok({"items": [], "total": 0}))
        return httpx.Response(404)

    monkeypatch.setenv("APPS_API_BASE", "http://stub")
    monkeypatch.setenv("ZENITHJOY_INTERNAL_TOKEN", "T")

    def fake_from_env(*args, **kwargs):
        return make_client(handler)

    with patch.object(ZenithJoyClient, "from_env", staticmethod(fake_from_env)):
        with patch.object(sys, "argv", ["worker.py"]):
            rc = worker_module.main()
    assert rc == 0


def test_main_auth_failure_returns_3(monkeypatch):
    def handler(req):
        return httpx.Response(401, json=_err("UNAUTHORIZED", "no", 401)[1])

    monkeypatch.setenv("APPS_API_BASE", "http://stub")

    def fake_from_env(*args, **kwargs):
        return make_client(handler)

    with patch.object(ZenithJoyClient, "from_env", staticmethod(fake_from_env)):
        with patch.object(sys, "argv", ["worker.py"]):
            rc = worker_module.main()
    assert rc == 3


def test_main_api_down_returns_0(monkeypatch):
    """apps/api 500 → main 不 crash，返回 0 等下轮。"""

    def handler(req):
        return httpx.Response(503, json=_err("INTERNAL_ERROR", "down", 503)[1])

    def fake_from_env(*args, **kwargs):
        return make_client(handler)

    with patch.object(ZenithJoyClient, "from_env", staticmethod(fake_from_env)):
        with patch.object(sys, "argv", ["worker.py"]):
            rc = worker_module.main()
    assert rc == 0
