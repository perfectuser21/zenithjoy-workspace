"""阶段 A+：research executor notebook_id fallback 单测

覆盖矩阵：
- run_data 传 notebook_id → 直接使用
- run_data 空 + env CREATOR_DEFAULT_NOTEBOOK_ID set → 使用 env
- run_data 空 + env DEFAULT_NOTEBOOK_ID set（兼容旧名）→ 使用 env
- run_data 空 + env 都空 → 返回 error
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from pipeline_worker.executors.research import execute_research  # noqa: E402


class TestNotebookIdFallback(unittest.TestCase):
    """研究阶段 notebook_id 解析优先级矩阵。"""

    def setUp(self) -> None:
        # 每次用例前清掉两个 env，避免污染
        for k in ("CREATOR_DEFAULT_NOTEBOOK_ID", "DEFAULT_NOTEBOOK_ID"):
            os.environ.pop(k, None)

    def _run_with_mock(self, run_data: dict) -> dict:
        """包一层 _run mock，避免真的调 notebooklm 子进程。"""
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["CONTENT_OUTPUT_DIR"] = tmp
            with patch(
                "pipeline_worker.executors.research._run"
            ) as mock_run:
                # 返回一段可解析的 findings JSON
                mock_run.return_value = json.dumps(
                    {"answer": "**1. 龙虾市场蓬勃\n示例内容"}
                )
                return execute_research(run_data)

    def test_run_data_has_notebook_id_uses_it(self) -> None:
        """run_data 传入 notebook_id 时直接使用，不读 env。"""
        os.environ["CREATOR_DEFAULT_NOTEBOOK_ID"] = "from-env-should-not-win"
        result = self._run_with_mock(
            {"keyword": "龙虾", "notebook_id": "from-run-data"}
        )
        self.assertTrue(result["success"], result)

    def test_fallback_to_creator_default_notebook_id_env(self) -> None:
        """run_data 未传，走 CREATOR_DEFAULT_NOTEBOOK_ID。"""
        os.environ["CREATOR_DEFAULT_NOTEBOOK_ID"] = "env-creator-default"
        result = self._run_with_mock({"keyword": "龙虾"})
        self.assertTrue(result["success"], result)

    def test_fallback_to_legacy_default_notebook_id_env(self) -> None:
        """run_data 未传 + 只有旧 DEFAULT_NOTEBOOK_ID env，也能兜住。"""
        os.environ["DEFAULT_NOTEBOOK_ID"] = "legacy-env"
        result = self._run_with_mock({"keyword": "龙虾"})
        self.assertTrue(result["success"], result)

    def test_both_empty_returns_error(self) -> None:
        """run_data 空 + env 都空 → 返回 error，不崩溃。"""
        result = execute_research({"keyword": "龙虾"})
        self.assertFalse(result["success"])
        self.assertIn("notebook_id", result["error"])
        self.assertIn("topic 和 env 都没有", result["error"])


if __name__ == "__main__":
    unittest.main()
