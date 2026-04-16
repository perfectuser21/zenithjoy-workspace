"""PR-e/5：端到端 CI 冒烟 fake mode 共享工具。

通过环境变量 ``E2E_FAKE_EXECUTORS=true`` 开启。
每个 executor 在顶部调用 ``is_fake_mode()``，True 时直接返回成功 stub，
不再调用 NotebookLM / LLM / rsync 等外部服务。
"""

from __future__ import annotations

import os
from pathlib import Path


def is_fake_mode() -> bool:
    """检查是否处于 e2e fake 模式。"""
    return os.environ.get("E2E_FAKE_EXECUTORS", "").lower() in ("1", "true", "yes")


def fake_output_dir(run_data: dict, stage: str) -> str:
    """fake 模式下的统一产出目录：不做真文件写入，只返回一个可预测的路径。"""
    base = os.environ.get("CONTENT_OUTPUT_DIR", "/tmp/ci-content-output")
    keyword_raw = run_data.get("keyword") or "fake"
    keyword = str(keyword_raw).replace("/", "-")[:40]
    path = Path(base) / "e2e-fake" / f"{stage}-{keyword}"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)
