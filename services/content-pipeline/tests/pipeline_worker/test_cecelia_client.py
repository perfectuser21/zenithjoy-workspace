"""cecelia_client.can_run 单测"""

import json
import os
import sys
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from unittest.mock import patch

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pipeline_worker.cecelia_client import can_run


class MockHandler(BaseHTTPRequestHandler):
    """模拟 Cecelia Brain /api/brain/can-run 接口"""
    response_body = None

    def do_POST(self):
        if self.path == "/api/brain/can-run":
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            data = json.loads(body)

            if MockHandler.response_body is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(MockHandler.response_body).encode())
            elif data.get("resource_type") not in ("notebooklm", "llm", "image-gen"):
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"approved": False, "reason": "unknown"}).encode())
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"approved": True, "reason": "v1 always approved"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # 静默


class TestCeceliaClient(unittest.TestCase):
    server = None
    thread = None

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), MockHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        if cls.server:
            cls.server.shutdown()

    def setUp(self):
        MockHandler.response_body = None

    def test_can_run_approved(self):
        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = can_run("notebooklm")
        self.assertTrue(result["approved"])
        self.assertIn("v1", result["reason"])

    def test_can_run_llm(self):
        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = can_run("llm", size=2)
        self.assertTrue(result["approved"])

    def test_can_run_unreachable_fallback(self):
        """Cecelia 不可达时 fallback approved"""
        with patch.dict(os.environ, {"BRAIN_URL": "http://127.0.0.1:1"}):
            result = can_run("notebooklm")
        self.assertTrue(result["approved"])
        self.assertIn("fallback", result["reason"])

    def test_can_run_with_retry_after(self):
        MockHandler.response_body = {"approved": False, "reason": "throttled", "retry_after": 30}
        with patch.dict(os.environ, {"BRAIN_URL": f"http://127.0.0.1:{self.port}"}):
            result = can_run("llm")
        self.assertFalse(result["approved"])
        self.assertEqual(result["retry_after"], 30)


if __name__ == "__main__":
    unittest.main()
