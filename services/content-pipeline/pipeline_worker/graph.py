"""Pipeline 6 阶段 LangGraph 编排器

把原 worker.py 里的 for-loop 顺序调度抽出，改成 LangGraph DAG：

    START → research → copywriting → copy_review → generate → image_review → export → END
              │            │             │             │            │           │
              └────────────┴─────────────┴─────────────┴────────────┴───────────┘
                                       (任一 stage error → fail → END)

设计要点：
- executors 不改，仍为 ``dict → dict``。Node 只做包装：can_run 检查 → 调 executor → 解析结果
- client 通过闭包注入（``build_graph(client)``），便于测试 mock
- stage_complete 在 node 内调用；fail_pipeline 仅由 worker.py 在拿到 final state 后调
- 失败语义在 state 中传递（``error`` / ``failed_stage``），由 conditional edge 路由到 fail terminal node
- 幂等/Resume：worker 把已完成 stage 写入 ``completed_stages``，每个 node 进入时判断跳过
"""

from __future__ import annotations

import logging
import traceback
from typing import Any, Callable, Optional

from typing_extensions import TypedDict

from langgraph.graph import END, START, StateGraph

from .cecelia_client import can_run as default_can_run
from .executors.copy_review import execute_copy_review
from .executors.copywriting import execute_copywriting
from .executors.export import execute_export
from .executors.generate import execute_generate
from .executors.image_review import execute_image_review
from .executors.research import execute_research

logger = logging.getLogger("pipeline-worker.graph")


class PipelineState(TypedDict, total=False):
    # 必备 input
    pipeline_id: str
    keyword: str
    content_type: str
    notebook_id: Optional[str]
    topic_id: Optional[str]

    # stage 间累积的 artifact 路径（dict-in/dict-out 透传）
    output_dir: Optional[str]
    findings_path: Optional[str]
    export_path: Optional[str]

    # 控制位
    completed_stages: list[str]  # resume / 幂等
    error: Optional[str]
    failed_stage: Optional[str]


# (stage_name, can_run resource_type, executor) — 与 worker.py 原 STAGES 对齐
_STAGE_DEFS: list[tuple[str, Optional[str], Callable[[dict], dict]]] = [
    ("research", "notebooklm", execute_research),
    ("copywriting", "llm", execute_copywriting),
    ("copy_review", None, execute_copy_review),
    ("generate", "image-gen", execute_generate),
    ("image_review", None, execute_image_review),
    ("export", None, execute_export),
]

# 仅作为元数据公开（便于外部对齐测试）
STAGE_NAMES: list[str] = [s[0] for s in _STAGE_DEFS]


def _state_to_run_data(state: PipelineState) -> dict:
    """把 graph state 投影成 executor 期望的 run_data dict。"""
    rd: dict[str, Any] = {
        "keyword": state.get("keyword"),
        "pipeline_id": state.get("pipeline_id"),
        "topic_id": state.get("topic_id"),
        "content_type": state.get("content_type") or "solo-company-case",
        "notebook_id": state.get("notebook_id"),
    }
    for k in ("output_dir", "findings_path", "export_path"):
        v = state.get(k)
        if v:
            rd[k] = v
    return rd


def _make_node(
    *,
    stage_name: str,
    resource_type: Optional[str],
    executor: Callable[[dict], dict],
    is_final: bool,
    client: Any,
    dry_run: bool,
    can_run_fn: Callable[[str], dict],
):
    """工厂：根据 stage 元信息构造一个 graph node。

    每个 node 行为：
    1. 已完成（resume）→ 直接返回空 update
    2. dry_run → 仅记录，不执行
    3. resource_type 存在 → 询问 can_run，被拒 → 写 error
    4. 调 executor，捕获异常 → 写 error
    5. 检查 success / review_passed → 不通过 → 写 error
    6. 把 artifact 路径合并回 state、上报 stage_complete
    """

    def node(state: PipelineState) -> dict:
        completed = list(state.get("completed_stages") or [])
        if stage_name in completed:
            logger.info("[graph] %s 已完成（resume），跳过", stage_name)
            return {}

        if dry_run:
            logger.info("[graph][dry-run] %s 跳过执行", stage_name)
            return {"completed_stages": completed + [stage_name]}

        # ── can_run 守卫
        if resource_type:
            cr = can_run_fn(resource_type)
            if not cr.get("approved", True):
                retry_after = cr.get("retry_after")
                msg = f"Cecelia 拒绝 {resource_type}: {cr.get('reason')}"
                if retry_after:
                    msg += f"（建议 {retry_after}s 后重试）"
                logger.warning("[graph] %s can_run 拒绝: %s", stage_name, msg)
                return {"error": msg, "failed_stage": stage_name}

        # ── 执行 executor
        run_data = _state_to_run_data(state)
        try:
            result = executor(run_data)
        except Exception as e:  # noqa: BLE001 - 等价 worker.py 原行为
            tb = traceback.format_exc()
            logger.error("[graph] %s 异常: %s\n%s", stage_name, e, tb)
            return {
                "error": f"阶段 {stage_name} 异常: {e}",
                "failed_stage": stage_name,
            }

        if not result.get("success", False):
            err = result.get("error", f"阶段 {stage_name} 失败")
            return {"error": err, "failed_stage": stage_name}

        # review_passed=False（copy_review/image_review）→ 整 pipeline fail
        if "review_passed" in result and not result["review_passed"]:
            issues = result.get("issues") or []
            err = f"审查未通过: {'; '.join(issues)}"
            return {"error": err, "failed_stage": stage_name}

        # 收集要透传的 artifact
        update: dict[str, Any] = {}
        stage_output: dict[str, Any] = {}
        for k in ("output_dir", "findings_path", "export_path"):
            if result.get(k):
                update[k] = result[k]
                stage_output[k] = result[k]

        # 终态：合并 manifest.json
        stage_output_for_api: Optional[dict[str, Any]] = stage_output or None
        if is_final:
            from .worker import _read_manifest  # 局部 import 避循环

            manifest = _read_manifest(update.get("output_dir") or state.get("output_dir"))
            if manifest:
                stage_output_for_api = {**(stage_output or {}), **manifest}

        # 上报 stage_complete（失败按原 worker 语义处理）
        if client is not None:
            from lib.http_client import ZenithJoyAPIError

            pid = state.get("pipeline_id")
            try:
                client.stage_complete(
                    pid,
                    stage_name,
                    output=stage_output_for_api,
                    is_final=is_final,
                )
            except ZenithJoyAPIError as e:
                logger.error(
                    "[graph] stage-complete 上报失败 stage=%s pid=%s: %s",
                    stage_name, str(pid)[:8], e,
                )
                if e.status_code in (401, 403):
                    raise
                # 其他错误：与 worker.py 原行为一致，整体 fail
                return {
                    "error": f"stage_complete 上报失败: {e}",
                    "failed_stage": stage_name,
                }

        update["completed_stages"] = completed + [stage_name]
        logger.info("[graph] %s 完成", stage_name)
        return update

    node.__name__ = f"node_{stage_name}"
    return node


def _route_after(stage_name: str, next_stage: Optional[str]) -> Callable[[PipelineState], str]:
    """构造 conditional edge 路由：state.error → 'fail'，否则 → 下一节点（或 END）。"""

    def router(state: PipelineState) -> str:
        if state.get("error"):
            return "fail"
        return next_stage if next_stage else END

    router.__name__ = f"route_after_{stage_name}"
    return router


def _fail_node(state: PipelineState) -> dict:
    """Terminal fail node：不调 fail_pipeline（让 worker.py 拿到 final state 后调）。"""
    logger.warning(
        "[graph] pipeline 进入失败终态: stage=%s, error=%s",
        state.get("failed_stage"), state.get("error"),
    )
    return {}


def build_graph(
    client: Any,
    *,
    dry_run: bool = False,
    can_run_fn: Optional[Callable[[str], dict]] = None,
    stage_defs: Optional[list[tuple[str, Optional[str], Callable[[dict], dict]]]] = None,
):
    """构建并编译 LangGraph app。

    Args:
        client: ZenithJoyClient 实例（或 None：纯本地 dry-run 时可传 None）
        dry_run: True 时所有 node 跳过 executor 与 stage_complete 调用
        can_run_fn: 注入用，默认走 ``cecelia_client.can_run``
        stage_defs: 6 阶段定义 [(name, can_run_resource, executor), ...]；
                    默认走 module 级 ``_STAGE_DEFS``。worker 调用时通常传入
                    ``worker.STAGES`` 以便老测试 ``patch(worker.STAGES, ...)`` 仍生效。

    Returns:
        compiled graph（``invoke(state, config)`` 即可跑）
    """
    if can_run_fn is None:
        can_run_fn = default_can_run

    defs = stage_defs if stage_defs is not None else _STAGE_DEFS

    g = StateGraph(PipelineState)

    # 添加 stage node
    for i, (name, rtype, executor) in enumerate(defs):
        is_final = (i == len(defs) - 1)
        g.add_node(
            name,
            _make_node(
                stage_name=name,
                resource_type=rtype,
                executor=executor,
                is_final=is_final,
                client=client,
                dry_run=dry_run,
                can_run_fn=can_run_fn,
            ),
        )

    # 添加 fail terminal node
    g.add_node("fail", _fail_node)

    # 串边：START → 第一个 stage → ... → 最后 stage → END
    g.add_edge(START, defs[0][0])

    for i, (name, _rt, _ex) in enumerate(defs):
        next_name = defs[i + 1][0] if i + 1 < len(defs) else None
        g.add_conditional_edges(
            name,
            _route_after(name, next_name),
            {
                "fail": "fail",
                **({next_name: next_name} if next_name else {}),
                END: END,
            },
        )

    g.add_edge("fail", END)

    return g.compile()


__all__ = ["PipelineState", "STAGE_NAMES", "build_graph"]
