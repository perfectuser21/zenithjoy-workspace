"""services/creator 基本可加载性测试（PR-e/5 更新）。

不再检查 SQLite zenithjoy.db 文件（已废弃），仅验证核心模块能被 import。
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_server_module_imports():
    """creator-api server 模块应可导入（不触发数据库连接）。"""
    from api import server  # noqa: F401
    assert hasattr(server, "app")


def test_topics_module_imports():
    """topics 转发路由应可导入。"""
    from api import topics  # noqa: F401
    assert hasattr(topics, "router")


def test_content_directory_optional():
    """content 目录可选存在（不强制，仅 sanity）。"""
    # 不 assert — 这里只要不抛就 OK
    os.path.exists("content")
