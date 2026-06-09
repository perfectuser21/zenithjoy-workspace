"""
TDD Red 测试 — Line 07 video-remake thin 骨架（Round 2）
服务未实现时全部 FAIL，实现后全部通过。
运行方式: cd /workspace && python -m pytest sprints/06090814-video-remake/tests/ -v
"""
import os
import socket
import subprocess
import time

import pytest
import requests

BASE_URL = "http://localhost:8899"


def _is_running():
    try:
        s = socket.create_connection(("localhost", 8899), timeout=1)
        s.close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def server():
    """Session 级服务自启动：若端口未占用则启动 server.py，测试结束后停止。"""
    if _is_running():
        yield
        return

    proc = subprocess.Popen(
        ["python", "server.py"],
        cwd="/workspace/services/video-remake",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(15):
        if _is_running():
            break
        time.sleep(1)
    else:
        proc.terminate()
        pytest.fail("services/video-remake/server.py 15s 内未就绪，请检查实现")

    yield

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        """[BEHAVIOR] /health 返回 {"status":"ok"} — Golden Path Step 1"""
        r = requests.get(f"{BASE_URL}/health")
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "ok", f"status 期望 'ok'，实际: {data.get('status')}"

    def test_health_forbidden_fields_absent(self):
        """禁用字段反向检查: 响应不含 state/healthy"""
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
        for node in nodes:
            for field in ["id", "label", "status", "order"]:
                assert field in node, f"节点 {node.get('id')} 缺字段 {field}"

    def test_nodes_ids_are_01_to_09(self):
        """节点 id 集合 = {'01', '02', ..., '09'}，覆盖全部 9 个"""
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

    def test_node_confirm_keys_completeness(self):
        """confirm 响应 keys 完整性: 集合 ⊆ {ok, node_id, status}，无多余字段"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/01/confirm",
            json={"video_path": "/tmp/v.mp4", "model_ref": "/tmp/m.jpg",
                  "product_ref": "/tmp/p.jpg", "goal": "keys-completeness-test"},
        )
        data = r.json()
        allowed = {"ok", "node_id", "status"}
        extra = set(data.keys()) - allowed
        assert not extra, f"FAIL: 多余字段 {extra}（仅允许 {allowed}）"

    def test_node_confirm_forbidden_fields_absent(self):
        """禁用字段反向检查: 响应不含 success/state"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/01/confirm",
            json={"video_path": "/tmp/v.mp4", "model_ref": "/tmp/m.jpg",
                  "product_ref": "/tmp/p.jpg", "goal": "forbidden-test"},
        )
        data = r.json()
        assert "success" not in data, "FAIL: 含禁用字段 success（应用 ok）"
        assert "state" not in data, "FAIL: 含禁用字段 state（应用 status）"

    def test_node_01_creates_project_dir(self):
        """[BEHAVIOR] node 01 confirm 后项目目录已创建 — PRD Golden Path Step 2"""
        task_name = f"e2e-dir-test-{int(time.time())}"
        r = requests.post(
            f"{BASE_URL}/api/nodes/01/confirm",
            json={"video_path": "/tmp/v.mp4", "model_ref": "/tmp/m.jpg",
                  "product_ref": "/tmp/p.jpg", "goal": task_name},
        )
        assert r.status_code == 200
        project_dir = os.path.expanduser(f"~/video-remake-projects/{task_name}")
        assert os.path.isdir(project_dir), f"FAIL: 项目目录未创建 {project_dir}"

    def test_nonexistent_node_returns_404(self):
        """[BEHAVIOR] error path — node_id=99（不存在）→ HTTP 404"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/99/confirm",
            json={"video_path": "/tmp/v.mp4"},
        )
        assert r.status_code == 404, f"期望 404，实际: {r.status_code}"


class TestNodeClickThrough:
    """[BEHAVIOR] 节点 02-09 全流程可点通 — PRD Golden Path "全流程可点通"（thin：ok:true 即通过）"""

    @pytest.mark.parametrize("node_id", [f"{i:02d}" for i in range(2, 10)])
    def test_node_confirm_returns_ok(self, node_id):
        """每个节点 confirm 均返回 HTTP 200 + ok==true + status==completed"""
        r = requests.post(
            f"{BASE_URL}/api/nodes/{node_id}/confirm",
            json={"goal": "click-through-test"},
        )
        assert r.status_code == 200, f"node {node_id} 返回 {r.status_code}，期望 200"
        data = r.json()
        assert data.get("ok") is True, f"node {node_id} ok={data.get('ok')}"
        assert data.get("node_id") == node_id, f"node {node_id} node_id={data.get('node_id')}"
        assert data.get("status") == "completed", f"node {node_id} status={data.get('status')}"
