"""LangGraph pipeline 编排器单测（替代原 STAGES for-loop）。

覆盖：
  1. happy path  — 6 stage 全 PASS → final 含全部 completed_stages，无 error
  2. exception   — research 抛异常 → final 有 error / failed_stage='research'
  3. review fail — copy_review review_passed=False → fail with stage='copy_review'
  4. resume      — completed_stages=['research','copywriting'] → 跳过这两个 node，从 copy_review 起
  5. can_run 拒绝 — research 资源被拒 → fail with reason 含 "Cecelia 拒绝"

Mock 策略：
  - 把 ``pipeline_worker.graph._STAGE_DEFS`` 临时换成 fake executors
  - client mock：记录 stage_complete 调用次数、参数
  - can_run_fn 用 lambda 注入
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline_worker import graph as graph_module  # noqa: E402


# ─── 共用 fixtures ─────────────────────────────────────────────────────


def _all_pass(stage_name: str):
    """构造一个永远成功的 fake executor（review 阶段附带 review_passed=True）。"""

    def _fn(run_data: dict) -> dict:
        out: dict = {"success": True}
        if "review" in stage_name:
            out["review_passed"] = True
        if stage_name == "research":
            out["findings_path"] = "/tmp/findings.json"
        if stage_name == "copywriting":
            out["output_dir"] = "/tmp/copy-out"
        if stage_name == "export":
            out["export_path"] = "/tmp/nas/export"
        return _fn._track(stage_name) or out

    _fn._track = lambda s: None  # placeholder for tests that want to spy
    return _fn


def _patched_stage_defs(overrides: dict[str, callable]):
    """复制原 _STAGE_DEFS，但用 overrides 中的 executor 替换。"""
    new_defs = []
    for name, rtype, _orig in graph_module._STAGE_DEFS:
        ex = overrides.get(name) or _all_pass(name)
        new_defs.append((name, rtype, ex))
    return new_defs


def _make_client_mock():
    client = MagicMock()
    client.stage_complete = MagicMock(return_value={})
    return client


def _approve(_resource_type: str) -> dict:
    return {"approved": True, "reason": "ok", "retry_after": None}


def _initial_state(**overrides) -> dict:
    base = {
        "pipeline_id": "p-test-001",
        "keyword": "AI 自动化",
        "topic_id": "t-001",
        "content_type": "solo-company-case",
        "notebook_id": "nb-1",
        "completed_stages": [],
    }
    base.update(overrides)
    return base


# ─── 测试 1: happy path ────────────────────────────────────────────────


def test_graph_happy_path_all_six_stages():
    client = _make_client_mock()
    fake_defs = _patched_stage_defs({})  # 全 _all_pass

    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=False, can_run_fn=_approve)
        final = app.invoke(
            _initial_state(),
            config={"configurable": {"thread_id": "p-test-001"}},
        )

    assert final.get("error") is None, f"不应有 error: {final.get('error')}"
    completed = final.get("completed_stages") or []
    assert completed == [
        "research", "copywriting", "copy_review",
        "generate", "image_review", "export",
    ], f"completed_stages 应该全 6 个，实际 {completed}"

    # stage_complete 应被调 6 次
    assert client.stage_complete.call_count == 6
    # 最后一次（export）必须 is_final=True
    last_call = client.stage_complete.call_args_list[-1]
    assert last_call.args[1] == "export" or last_call.kwargs.get("stage") == "export" \
        or "export" in str(last_call), f"最后一次应 export: {last_call}"
    assert last_call.kwargs.get("is_final") is True


# ─── 测试 2: research 异常 ─────────────────────────────────────────────


def test_graph_research_exception_routes_to_fail():
    client = _make_client_mock()

    def boom(run_data):
        raise RuntimeError("notebook 502")

    fake_defs = _patched_stage_defs({"research": boom})

    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=False, can_run_fn=_approve)
        final = app.invoke(_initial_state())

    assert final.get("error") is not None
    assert "research" in final["error"] or "notebook" in final["error"]
    assert final.get("failed_stage") == "research"
    # 后续阶段不应有 stage_complete 调用
    completed_stages_called = [
        call.args[1] if len(call.args) > 1 else call.kwargs.get("stage")
        for call in client.stage_complete.call_args_list
    ]
    assert "copywriting" not in completed_stages_called
    assert "export" not in completed_stages_called


# ─── 测试 3: copy_review 不通过 ─────────────────────────────────────────


def test_graph_copy_review_failed_routes_to_fail():
    client = _make_client_mock()

    def reject(run_data):
        return {
            "success": True,
            "review_passed": False,
            "issues": ["包含禁用词『最牛』", "字数超限"],
        }

    fake_defs = _patched_stage_defs({"copy_review": reject})

    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=False, can_run_fn=_approve)
        final = app.invoke(_initial_state())

    assert final.get("error") is not None
    assert "审查未通过" in final["error"]
    assert "禁用词" in final["error"]
    assert final.get("failed_stage") == "copy_review"
    # research + copywriting 应已上报，copy_review 之后的不应上报
    stage_args = [
        call.args[1] if len(call.args) > 1 else call.kwargs.get("stage")
        for call in client.stage_complete.call_args_list
    ]
    assert "research" in stage_args
    assert "copywriting" in stage_args
    assert "copy_review" not in stage_args
    assert "generate" not in stage_args


# ─── 测试 4: resume 跳过已完成 ──────────────────────────────────────────


def test_graph_resume_skips_completed_stages():
    """模拟 worker resume：completed_stages 预填后，已完成 node 不再调 executor。"""
    client = _make_client_mock()

    call_log: list[str] = []

    def make_tracker(name):
        def _fn(run_data):
            call_log.append(name)
            out = {"success": True}
            if "review" in name:
                out["review_passed"] = True
            return out
        return _fn

    fake_defs = [
        (name, rtype, make_tracker(name))
        for name, rtype, _ in graph_module._STAGE_DEFS
    ]

    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=False, can_run_fn=_approve)
        final = app.invoke(_initial_state(
            completed_stages=["research", "copywriting"],
        ))

    assert final.get("error") is None
    # research / copywriting 不应再调 executor
    assert "research" not in call_log, f"research 应跳过，实际 call_log={call_log}"
    assert "copywriting" not in call_log
    # 后续 4 个应全跑
    assert call_log == ["copy_review", "generate", "image_review", "export"]
    # stage_complete 只对真跑的 4 个调
    assert client.stage_complete.call_count == 4


# ─── 测试 5: can_run 拒绝 ──────────────────────────────────────────────


def test_graph_can_run_denied_fails_pipeline():
    client = _make_client_mock()
    fake_defs = _patched_stage_defs({})

    def deny(resource_type):
        return {
            "approved": False,
            "reason": f"quota for {resource_type}",
            "retry_after": 300,
        }

    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=False, can_run_fn=deny)
        final = app.invoke(_initial_state())

    assert final.get("error") is not None
    assert "Cecelia 拒绝" in final["error"]
    # 第一个有 resource_type 的是 research(notebooklm)
    assert final.get("failed_stage") == "research"
    # 没有任何 stage 真跑过
    assert client.stage_complete.call_count == 0


# ─── 额外保障：build_graph 可重入、节点元数据完整 ──────────────────────


def test_stage_names_match_spec():
    assert graph_module.STAGE_NAMES == [
        "research", "copywriting", "copy_review",
        "generate", "image_review", "export",
    ]


def test_build_graph_returns_compiled_app():
    client = _make_client_mock()
    app = graph_module.build_graph(client, dry_run=True, can_run_fn=_approve)
    # 编译后的对象具有 invoke 方法
    assert hasattr(app, "invoke")


def test_dry_run_skips_executors_and_stage_complete():
    """build_graph(dry_run=True) 时不调 executor 也不调 client.stage_complete。"""
    client = _make_client_mock()

    def explode(run_data):  # 任何调用都会炸
        raise AssertionError("dry-run 模式不应调 executor")

    fake_defs = [
        (name, rtype, explode) for name, rtype, _ in graph_module._STAGE_DEFS
    ]
    with patch.object(graph_module, "_STAGE_DEFS", fake_defs):
        app = graph_module.build_graph(client, dry_run=True, can_run_fn=_approve)
        final = app.invoke(_initial_state())

    assert final.get("error") is None
    assert client.stage_complete.call_count == 0
    # dry_run 仍应把 6 个 stage 标完
    assert (final.get("completed_stages") or []) == [
        "research", "copywriting", "copy_review",
        "generate", "image_review", "export",
    ]
