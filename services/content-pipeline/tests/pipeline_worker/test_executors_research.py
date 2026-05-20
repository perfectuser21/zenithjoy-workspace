"""research executor 单测"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker.executors.research import execute_research, _parse_findings, _slug


class TestSlug(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(_slug("AI 一人公司"), "AI-一人公司")

    def test_special_chars(self):
        result = _slug("hello@world!")
        self.assertNotIn("@", result)
        self.assertNotIn("!", result)

    def test_max_length(self):
        result = _slug("a" * 100)
        self.assertLessEqual(len(result), 40)


class TestParseFindings(unittest.TestCase):
    def test_empty_input(self):
        self.assertEqual(_parse_findings(None, "test"), [])
        self.assertEqual(_parse_findings("", "test"), [])

    def test_valid_json(self):
        raw = json.dumps({"answer": "**1. 发现一\n详细内容\n**2. 发现二\n更多内容"})
        findings = _parse_findings(raw, "test")
        self.assertGreater(len(findings), 0)

    def test_invalid_json_fallback(self):
        findings = _parse_findings("这是纯文本内容，不是 JSON", "测试关键词")
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["id"], "f001")

    def test_empty_answer(self):
        raw = json.dumps({"answer": ""})
        findings = _parse_findings(raw, "test")
        self.assertEqual(findings, [])


class TestExecuteResearch(unittest.TestCase):
    def test_no_notebook_id(self):
        result = execute_research({"keyword": "test"})
        self.assertFalse(result["success"])
        self.assertIn("notebook_id", result["error"])

    @patch.dict(os.environ, {"CONTENT_OUTPUT_DIR": ""})
    def test_with_mock_notebook(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["CONTENT_OUTPUT_DIR"] = tmp
            # 不真正调用 notebooklm，只验证流程
            with patch("pipeline_worker.executors.research._run") as mock_run:
                mock_run.return_value = json.dumps({
                    "answer": "**1. AI 让个人拥有企业级能力\n具体数据..."
                })
                result = execute_research({
                    "keyword": "AI 一人公司",
                    "notebook_id": "test-nb-id",
                    "content_type": "solo-company-case",
                })
                self.assertTrue(result["success"])
                self.assertGreater(result["findings_count"], 0)
                self.assertTrue(Path(result["findings_path"]).exists())


if __name__ == "__main__":
    unittest.main()
