# -*- coding: utf-8 -*-
"""_KNOWN_GROUPS 落盘持久化（2026-07-16 xian-rog 真机：升级重启后群缓存清零）。

根因：`_KNOWN_GROUPS` 是纯内存 set（listen_chat.py 顶层），进程重启（如模块 OTA 升级）
后清零，之前判过的群"前科"全部丢失。10:07 升级到 1.0.123 重启后，10:45 第一个攒出
未读角标的群（招商雍澜湾业主群）因缓存清零、且判群闸本身又 fail-open（另一 regression
test 覆盖），被自动回复。

修法：对齐既有 `_load_replied`/`_save_replied`（zj-replied.json）同款落盘机制，
新增 `_load_known_groups`/`_save_known_groups`（zj-known-groups.json），启动时加载。

本文件是该 bug 的永久 regression test，禁止删除。
"""
import json
import os
import sys
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)


def _fresh_listen_chat(state_dir):
    """在指定 ZJ_STATE_DIR 下重新导入 listen_chat（模块顶层按此计算落盘路径）。"""
    os.environ["ZJ_STATE_DIR"] = state_dir
    if "listen_chat" in sys.modules:
        del sys.modules["listen_chat"]
    import listen_chat  # noqa: E402
    return listen_chat


def test_save_then_load_known_groups_roundtrip():
    """写入 → 重新导入模块（模拟重启）→ 加载 → 内容仍在。"""
    state_dir = tempfile.mkdtemp(prefix="zj-test-knowngroups-")
    try:
        lc = _fresh_listen_chat(state_dir)
        lc._save_known_groups({"招商雍澜湾业主群", "京选优惠捡漏群JD77"})

        lc2 = _fresh_listen_chat(state_dir)
        loaded = lc2._load_known_groups()
        assert loaded == {"招商雍澜湾业主群", "京选优惠捡漏群JD77"}, (
            f"重启后应从磁盘恢复已知群集合，实际={loaded!r}"
        )
    finally:
        os.environ.pop("ZJ_STATE_DIR", None)


def test_load_known_groups_missing_file_returns_empty_set():
    """文件不存在（全新机器/首次启动）→ 返回空集合，不抛异常。"""
    state_dir = tempfile.mkdtemp(prefix="zj-test-knowngroups-empty-")
    try:
        lc = _fresh_listen_chat(state_dir)
        assert lc._load_known_groups() == set()
    finally:
        os.environ.pop("ZJ_STATE_DIR", None)


def test_load_known_groups_corrupt_file_returns_empty_set():
    """文件损坏（非法 JSON）→ fail-safe 返回空集合，不崩溃（同 _load_replied 容错约定）。"""
    state_dir = tempfile.mkdtemp(prefix="zj-test-knowngroups-corrupt-")
    try:
        lc = _fresh_listen_chat(state_dir)
        with open(lc._KNOWN_GROUPS_FILE, "w", encoding="utf-8") as f:
            f.write("{not valid json")
        assert lc._load_known_groups() == set()
    finally:
        os.environ.pop("ZJ_STATE_DIR", None)


def test_run_real_listen_loads_known_groups_at_startup():
    """★核心根治点：run_real_listen 函数体必须在启动时调用 _load_known_groups 并灌入 _KNOWN_GROUPS，
    否则重启后即使磁盘有数据也不会真正恢复（同 replied/sent_texts 启动加载同款约定）。
    """
    import ast

    src_path = os.path.join(_WECHAT, "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    calls = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run_real_listen":
            for n in ast.walk(node):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    calls.add(n.func.id)
            break
    assert "_load_known_groups" in calls, (
        f"run_real_listen 必须在启动时调用 _load_known_groups 恢复群缓存，"
        f"实际调用: {sorted(calls)}"
    )
