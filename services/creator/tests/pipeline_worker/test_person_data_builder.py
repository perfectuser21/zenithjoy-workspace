"""person_data_builder 单测

覆盖：
- LLM 成功场景：构造出合规 person-data
- LLM 返回超预算字段：防御性截断
- LLM 返回非法 JSON / markdown fence 包裹：自动剥离或 fallback
- LLM 不可达：fallback 硬截断（不能塞整段 keyword）
- _fallback_name 启发式：从 "为什么 2026 年龙虾 让一人公司..." 提取 "龙虾"/"一人公司" 之类短名
- _enforce_budget 字段预算校验（每个字段）
"""

import json
import os
import sys
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker.person_data_builder import (  # noqa: E402
    BUDGET,
    _enforce_budget,
    _fallback_name,
    _strip_json_fence,
    build_person_data,
)


# ─── Mock Cecelia Brain /api/brain/llm-service/generate ────────────


class LLMMockHandler(BaseHTTPRequestHandler):
    """可切换响应的 mock brain LLM 接口"""

    # 类属性由每个测试设置
    response_text: str = ""
    response_status: int = 200

    def do_POST(self):
        if self.path != "/api/brain/llm-service/generate":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        _body = self.rfile.read(length)

        if LLMMockHandler.response_status == 200:
            resp = {
                "success": True,
                "data": {
                    "text": LLMMockHandler.response_text,
                    "content": LLMMockHandler.response_text,
                    "model": "test-model",
                    "provider": "mock",
                },
                "error": None,
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode("utf-8"))
        else:
            self.send_response(LLMMockHandler.response_status)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # 静默


class TestPersonDataBuilderLLM(unittest.TestCase):
    """build_person_data 集成测试（mock HTTP）"""

    server = None
    thread = None
    port = 0

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), LLMMockHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        if cls.server:
            cls.server.shutdown()

    def setUp(self):
        LLMMockHandler.response_text = ""
        LLMMockHandler.response_status = 200

    # sample findings（模拟老坏图场景）
    LOBSTER_KEYWORD = "为什么 2026 年龙虾 让一人公司成为为了可能"
    LOBSTER_FINDINGS = [
        {
            "id": "f001",
            "title": "在2026年，随着智能体AI（Agentic AI）和龙虾（OpenClaw）的大爆发",
            "content": "传统商业模式受冲击，个体拥有企业级调度能力。"
        },
        {
            "id": "f002",
            "title": "具备独立开发并引爆世界级顶级软件的能力",
            "content": "AI 把产品研发的边际成本压到接近零。"
        },
        {
            "id": "f003",
            "title": "拥有调度千万级虚拟团队的企业级组织能力",
            "content": "一个人就能指挥一支虚拟 AI 团队。"
        },
    ]

    def test_llm_happy_path(self):
        """LLM 返回合规 JSON → 成功落库合规 person-data"""
        LLMMockHandler.response_text = json.dumps({
            "name": "龙虾效应",
            "handle": "@solo-lobster",
            "headline": "一人公司的终极形态",
            "key_stats": [
                {"val": "千万", "label": "虚拟团队规模", "sub": "AI 调度能力"},
                {"val": "0 元", "label": "研发边际成本", "sub": "近似免费"},
                {"val": "10x", "label": "人效跃升", "sub": "对比传统"},
            ],
            "flywheel": ["输入", "加工", "分发", "反哺"],
            "flywheel_insight": "一次投入，无限次收益",
            "quote": "系统是最好的员工，个体即企业。",
        })

        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = build_person_data(self.LOBSTER_KEYWORD, self.LOBSTER_FINDINGS)

        self.assertEqual(result["name"], "龙虾效应")
        self.assertEqual(result["handle"], "@solo-lobster")
        self.assertLessEqual(len(result["name"]), BUDGET["name"])
        self.assertLessEqual(len(result["headline"]), BUDGET["headline"])
        self.assertEqual(len(result["key_stats"]), 3)
        self.assertEqual(len(result["flywheel"]), 4)
        for fw in result["flywheel"]:
            self.assertLessEqual(len(fw), BUDGET["flywheel_item"])
        # 骨架字段齐全
        for k in ("timeline", "day_schedule", "qa", "avatar_b64_file"):
            self.assertIn(k, result)

    def test_llm_json_with_markdown_fence(self):
        """LLM 输出包裹在 ```json ... ``` 里 → 自动剥离"""
        LLMMockHandler.response_text = (
            "```json\n"
            + json.dumps({
                "name": "一人公司",
                "handle": "@solo",
                "headline": "AI 放大个体能力",
                "key_stats": [
                    {"val": "1", "label": "老板员工", "sub": "同一人"},
                    {"val": "24h", "label": "全自动运转", "sub": ""},
                    {"val": "10x", "label": "效率", "sub": ""},
                ],
                "flywheel": ["想", "做", "发", "收"],
                "flywheel_insight": "心法",
                "quote": "系统即员工。",
            })
            + "\n```"
        )

        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = build_person_data(self.LOBSTER_KEYWORD, self.LOBSTER_FINDINGS)

        self.assertEqual(result["name"], "一人公司")

    def test_llm_over_budget_defensive_truncation(self):
        """LLM 违规塞超长字段 → _enforce_budget 硬截断"""
        LLMMockHandler.response_text = json.dumps({
            "name": "这是一个绝对超过8字的违规长名字",
            "handle": "@" + "x" * 30,
            "headline": "这句话故意写得非常非常非常非常非常长超过预算",
            "key_stats": [
                {"val": "1234567890", "label": "这个标签也故意超长违反预算",
                 "sub": "sub 字段也违规超长超长超长超长"},
                {"val": "2", "label": "a", "sub": "b"},
                {"val": "3", "label": "c", "sub": "d"},
            ],
            "flywheel": ["长到爆炸的节点名", "也长", "超长", "再长"],
            "flywheel_insight": "这条飞轮心法也写得很长很长很长很长很长很长很长很长很长",
            "quote": "x" * 200,
        })

        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = build_person_data(self.LOBSTER_KEYWORD, self.LOBSTER_FINDINGS)

        self.assertLessEqual(len(result["name"]), BUDGET["name"])
        self.assertLessEqual(len(result["handle"]), BUDGET["handle"])
        self.assertLessEqual(len(result["headline"]), BUDGET["headline"])
        for s in result["key_stats"]:
            self.assertLessEqual(len(s["val"]), BUDGET["stat_val"])
            self.assertLessEqual(len(s["label"]), BUDGET["stat_label"])
            self.assertLessEqual(len(s["sub"]), BUDGET["stat_sub"])
        for fw in result["flywheel"]:
            self.assertLessEqual(len(fw), BUDGET["flywheel_item"])
        self.assertLessEqual(len(result["flywheel_insight"]), BUDGET["flywheel_insight"])
        self.assertLessEqual(len(result["quote"]), BUDGET["quote"])

    def test_llm_invalid_json_fallback(self):
        """LLM 返回非 JSON 文本 → fallback（不能塞整段 keyword）"""
        LLMMockHandler.response_text = "这不是 JSON 只是自然语言废话。"

        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = build_person_data(self.LOBSTER_KEYWORD, self.LOBSTER_FINDINGS)

        self.assertLessEqual(len(result["name"]), BUDGET["name"])
        # 关键断言：name 不是整段 keyword
        self.assertNotEqual(result["name"], self.LOBSTER_KEYWORD)
        # key_stats 也必须合规（即使 fallback）
        for s in result["key_stats"]:
            self.assertLessEqual(len(s["label"]), BUDGET["stat_label"])

    def test_llm_unreachable_fallback(self):
        """Cecelia 不可达 → fallback"""
        with patch.dict(os.environ, {"BRAIN_URL": "http://127.0.0.1:1"}):
            result = build_person_data(self.LOBSTER_KEYWORD, self.LOBSTER_FINDINGS)

        self.assertLessEqual(len(result["name"]), BUDGET["name"])
        self.assertNotEqual(result["name"], self.LOBSTER_KEYWORD)
        # 整段 keyword 不能出现在任何字段里
        for s in result["key_stats"]:
            self.assertNotIn(self.LOBSTER_KEYWORD, s["label"])

    def test_empty_findings_fallback(self):
        """findings 空 → fallback（不调 LLM）"""
        # 不设置 BRAIN_URL，也不该挂（走 fallback）
        result = build_person_data("某话题", [])
        self.assertLessEqual(len(result["name"]), BUDGET["name"])
        self.assertEqual(len(result["key_stats"]), 3)
        self.assertEqual(len(result["flywheel"]), 4)


class TestFallbackName(unittest.TestCase):
    """_fallback_name 启发式测试"""

    def test_strip_year_and_modifier(self):
        """"为什么 2026 年龙虾 让一人公司成为为了可能" → 提取合理短名"""
        result = _fallback_name("为什么 2026 年龙虾 让一人公司成为为了可能")
        self.assertNotEqual(result, "为什么 2026 年龙虾 让一人公司成为为了可能")
        self.assertLessEqual(len(result), BUDGET["name"])
        # 不应包含"为什么"
        self.assertNotIn("为什么", result)

    def test_short_keyword_passthrough(self):
        result = _fallback_name("一人公司")
        self.assertEqual(result, "一人公司")

    def test_very_long_keyword_truncate(self):
        result = _fallback_name("a" * 30)
        self.assertLessEqual(len(result), BUDGET["name"])


class TestEnforceBudget(unittest.TestCase):
    """_enforce_budget 单元测试（不走 HTTP）"""

    def test_fills_missing_fields(self):
        result = _enforce_budget({}, "测试")
        self.assertEqual(len(result["key_stats"]), 3)
        self.assertEqual(len(result["flywheel"]), 4)
        self.assertIn("timeline", result)
        self.assertIn("avatar_b64_file", result)

    def test_handle_without_at_prefix(self):
        result = _enforce_budget({"handle": "noprefix"}, "test")
        self.assertTrue(result["handle"].startswith("@"))

    def test_key_stats_padding(self):
        result = _enforce_budget({"key_stats": [{"val": "1", "label": "x"}]}, "test")
        self.assertEqual(len(result["key_stats"]), 3)
        self.assertEqual(result["key_stats"][1]["label"], "待补充")


class TestStripJsonFence(unittest.TestCase):
    def test_strip_json_fence(self):
        self.assertEqual(_strip_json_fence('```json\n{"a":1}\n```'), '{"a":1}')

    def test_strip_plain_fence(self):
        self.assertEqual(_strip_json_fence('```\n{"a":1}\n```'), '{"a":1}')

    def test_no_fence(self):
        self.assertEqual(_strip_json_fence('{"a":1}'), '{"a":1}')


if __name__ == "__main__":
    unittest.main()
