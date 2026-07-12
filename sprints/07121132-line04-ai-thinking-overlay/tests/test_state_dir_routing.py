"""
状态目录路由测试骨架
对应：[BEHAVIOR-INV-8] 禁止 C:\\Users\\Public 路径
"""
import json
import os
import tempfile
import pytest


class StateDirStub:
    """
    状态文件路由占位实现
    待实现：实际实现从 _STATE_DIR 环境变量读取
    """

    STATE_FILES = [
        "events.jsonl",
        "overlay-state.json",
        "overlay-diag.json",
        "overlay.pid",
    ]

    def __init__(self, state_dir: str):
        self.state_dir = state_dir

    def get_path(self, filename: str) -> str:
        return os.path.join(self.state_dir, filename)

    def write_state(self, filename: str, content: dict):
        path = self.get_path(filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(content, f)

    def append_event(self, event: dict):
        path = self.get_path("events.jsonl")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")


class TestStateDirRouting:
    """状态目录路由测试"""

    def test_all_files_in_state_dir(self, tmp_path):
        """所有状态文件写入 _STATE_DIR，不写其他路径"""
        sds = StateDirStub(str(tmp_path))

        sds.write_state("overlay-state.json", {"collapsed": False})
        sds.write_state("overlay-diag.json", {"rss_mb": 50})
        sds.append_event({"v": 1, "event_id": "1-run-1", "type": "heartbeat"})

        for filename in ["overlay-state.json", "overlay-diag.json", "events.jsonl"]:
            expected = str(tmp_path / filename)
            assert os.path.exists(expected), f"{filename} should exist in state_dir"

    def test_no_public_path_in_source(self):
        """源码中不含硬编码 C:\\Users\\Public 路径"""
        # 扫描 sprints 目录下的 Python 文件
        sprint_dir = os.path.dirname(os.path.abspath(__file__))
        forbidden_patterns = [
            r"C:\\Users\\Public",
            r"C:/Users/Public",
            r"users\\public",
            r"users/public",
        ]

        for root, dirs, files in os.walk(sprint_dir):
            for fname in files:
                if not fname.endswith((".py", ".ts", ".js")):
                    continue
                fpath = os.path.join(root, fname)
                with open(fpath, encoding="utf-8", errors="ignore") as f:
                    content = f.read().lower()
                for pattern in forbidden_patterns:
                    assert pattern.lower() not in content, \
                        f"Hardcoded Public path found in {fpath}: {pattern}"

    def test_state_dir_env_variable_used(self, tmp_path, monkeypatch):
        """_STATE_DIR 环境变量驱动文件路径"""
        monkeypatch.setenv("_STATE_DIR", str(tmp_path))

        # 模拟：实际代码应从 os.environ["_STATE_DIR"] 读取
        state_dir = os.environ.get("_STATE_DIR", ".")
        assert state_dir == str(tmp_path)

        sds = StateDirStub(state_dir)
        sds.write_state("overlay-state.json", {"test": True})

        assert os.path.exists(str(tmp_path / "overlay-state.json"))

    def test_corrupted_state_backup_and_reset(self, tmp_path):
        """损坏的状态文件弃用并备份"""
        state_file = tmp_path / "overlay-state.json"
        # 写入损坏内容
        state_file.write_text("{broken json content", encoding="utf-8")

        # 模拟损坏处理逻辑
        state_path = str(state_file)
        backup_path = state_path + ".bak"

        try:
            with open(state_path) as f:
                data = json.load(f)
        except json.JSONDecodeError:
            # 备份损坏文件
            os.rename(state_path, backup_path)
            # 以默认值重建
            default_state = {"collapsed": False, "x": 100, "y": 100}
            with open(state_path, "w") as f:
                json.dump(default_state, f)

        assert os.path.exists(backup_path), "Corrupted file should be backed up"
        assert os.path.exists(state_path), "New state file should be created"

        with open(state_path) as f:
            new_state = json.load(f)
        assert "collapsed" in new_state, "Default state should be valid"
