"""
TDD Red 测试 — Line 07 video-remake thin 骨架
服务未实现时全部 FAIL，实现后全部通过。
运行方式: cd /workspace && python -m pytest sprints/06090814-video-remake/tests/ -v
"""
import pytest
import requests

BASE_URL = "http://localhost:8899"


@pytest.fixture(scope="module", autouse=True)
def require_server():
    """确认服务运行中，否则 skip（Red 阶段服务不存在，直接 ConnectionRefusedError = FAIL）"""
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=3)
        assert r.status_code == 200
    except Exception as e:
        pytest.fail(f"服务未启动 ({e}) — 请先运行 python services/video-remake/server.py")


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        """[BEHAVIOR] /health 返回 {"status": "ok"} — Golden Path Step 1"""
        r = requests.get(f"{BASE_URL}/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok", f"status 期望 'ok'，实际: {data.get('status')}"

    def test_health_schema_completeness(self):
        """禁用字段反向检查: 响应不含 state/healthy 等非法字段"""
        r = requests.get(f"{BASE_URL}/health")
        data = r.json()
        assert "state" not in data, "FAIL: 含禁用字段 state（应用 status）"
        assert "healthy" not in data, "FAIL: 含禁用字段 healthy（应用 status）"


class TestFrontendServed:
    def test_root_returns_200(self):
        """[BEHAVIOR] GET / 返回 200（React Flow 画布 HTML）— Golden Path Step 2"""
        r = requests.get(f"{BASE_URL}/")
        assert r.status_code == 200, f"/ 返回 {r.status_code}，期望 200"


class TestNodesEndpoint:
    def test_nodes_returns_9(self):
        """[BEHAVIOR] /api/nodes 返回 9 个节点 — PRD smoke: assert len(d)==9"""
        r = requests.get(f"{BASE_URL}/api/nodes")
        assert r.status_code == 200
        nodes = r.json()
        assert isinstance(nodes, list), f"期望数组，实际: {type(nodes)}"
        assert len(nodes) == 9, f"期望 9 个节点，实际: {len(nodes)}"

    def test_nodes_schema_fields(self):
        """[BEHAVIOR] 每个节点含 id/label/status/order 四个必填字段"""
        r = requests.get(f"{BASE_URL}/api/nodes")
        nodes = r.json()
        required_fields = ["id", "label", "status", "order"]
        for node in nodes:
            for field in required_fields:
                assert field in node, f"节点 {node} 缺字段 {field}"

    def test_nodes_ids_are_01_to_09(self):
        """节点 id 为 '01'–'09'，顺序覆盖全部 9 个"""
        r = requests.get(f"{BASE_URL}/api/nodes")
        nodes = r.json()
        ids = {n["id"] for n in nodes}
        expected_ids = {f"{i:02d}" for i in range(1, 10)}
        assert ids == expected_ids, f"节点 id 集合不匹配: {ids}"

    def test_nodes_forbidden_fields_absent(self):
        """禁用字段反向检查: 节点对象不含 node_id/state/name"""
        r = requests.get(f"{BASE_URL}/api/nodes")
        nodes = r.json()
        for node in nodes:
            assert "node_id" not in node, "FAIL: 含禁用字段 node_id（应用 id）"
            assert "state" not in node, "FAIL: 含禁用字段 state（应用 status）"
            assert "name" not in node, "FAIL: 含禁用字段 name（应用 label）"


class TestNodeConfirmEndpoint:
    def test_node_01_confirm_returns_ok(self):
        """[BEHAVIOR] POST /api/nodes/01/confirm → {"ok":true, "node_id":"01", "status":"completed"}"""
        payload = {
            "video_path": "/tmp/test-video.mp4",
            "model_ref": "/tmp/model.jpg",
            "product_ref": "/tmp/product.jpg",
            "goal": "单元测试翻拍目标",
        }
        r = requests.post(f"{BASE_URL}/api/nodes/01/confirm", json=payload)
        assert r.status_code == 200, f"返回 {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("ok") is True, f"ok 期望 true，实际: {data.get('ok')}"
        assert data.get("node_id") == "01", f"node_id 期望 '01'，实际: {data.get('node_id')}"
        assert data.get("status") == "completed", f"status 期望 'completed'，实际: {data.get('status')}"

    def test_node_confirm_schema_completeness(self):
        """confirm 响应 keys 完整性检查: keys 集合 ⊆ {ok, node_id, status}"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/01/confirm",
            json={"video_path": "/tmp/v.mp4", "model_ref": "/tmp/m.jpg",
                  "product_ref": "/tmp/p.jpg", "goal": "test"},
        )
        data = r.json()
        assert "success" not in data, "FAIL: 含禁用字段 success（应用 ok）"
        assert "state" not in data, "FAIL: 含禁用字段 state（应用 status）"

    def test_nonexistent_node_returns_404(self):
        """[BEHAVIOR] error path — node_id=99（不存在）→ HTTP 404"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/99/confirm",
            json={"video_path": "/tmp/v.mp4"},
        )
        assert r.status_code == 404, f"期望 404，实际: {r.status_code}"
