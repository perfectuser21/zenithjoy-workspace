# -*- coding: utf-8 -*-
"""Bug 7 — 记忆污染：同机多账号共享状态文件（staging 7bugs / 1.0.108）

根因：_STATE_DIR 默认为 C:/Users/Public，所有账号共享同一个
zj-sent-texts.json 和 zj-reply-anchor.json。
同机两个微信账号（两个 listen_chat 进程）互相覆写状态文件，
导致发送历史和回复锚点混乱。

修法：提供 get_state_file_path(base_dir, kind, wechat_id) 纯函数。
wechat_id 非空时返回带后缀的隔离路径 zj-{kind}-{wechat_id}.json；
wechat_id 为空时回退到默认路径（向后兼容）。
本文件是永久 regression test。
"""
import os
import sys
import json
import tempfile

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_get_state_file_path_function_exists():
    """get_state_file_path 纯函数必须存在于 listen_chat 模块。"""
    assert hasattr(listen_chat, "get_state_file_path"), \
        "模块必须提供 get_state_file_path(base_dir, kind, wechat_id) 纯函数"


def test_state_files_include_wechat_id_suffix_when_set(tmp_path):
    """wechat_id 已知时，状态文件名必须包含 wechat_id 后缀。

    Bug 场景：wxid_alice 和 wxid_bob 同机运行，两个进程都读写
    zj-sent-texts.json → 互相覆盖状态 → 方向判定失灵/锚点混乱。

    修法：wechat_id 非空时返回 zj-{kind}-{wechat_id}.json。
    """
    base_dir = str(tmp_path)
    path_alice = listen_chat.get_state_file_path(base_dir, "sent-texts", "wxid_alice")
    path_bob = listen_chat.get_state_file_path(base_dir, "sent-texts", "wxid_bob")

    # 两个账号的路径必须不同
    assert path_alice != path_bob, \
        "不同 wechat_id 的状态文件路径必须不同（隔离防污染）"

    # 路径必须包含 wechat_id
    assert "wxid_alice" in path_alice, f"alice 的文件路径应含 wechat_id，实际: {path_alice}"
    assert "wxid_bob" in path_bob, f"bob 的文件路径应含 wechat_id，实际: {path_bob}"


def test_state_files_fallback_to_default_when_no_wechat_id(tmp_path):
    """wechat_id 为 None/空时，回退到不带后缀的默认文件名（向后兼容）。"""
    base_dir = str(tmp_path)
    path_none = listen_chat.get_state_file_path(base_dir, "sent-texts", None)
    path_empty = listen_chat.get_state_file_path(base_dir, "sent-texts", "")

    # 无 wechat_id 时不应该崩溃，返回合理的默认路径
    assert path_none is not None
    assert path_empty is not None

    # 默认路径应包含 "zj-sent-texts"（含基础文件名）
    assert "zj-sent-texts" in path_none or "sent-texts" in path_none, \
        f"默认路径应包含 sent-texts，实际: {path_none}"


def test_two_accounts_do_not_share_state_files(tmp_path):
    """两个不同 wechat_id 的进程写入状态文件时不互相干扰。

    验证文件隔离的物理效果：alice 写的内容 bob 读不到，反之亦然。
    """
    base_dir = str(tmp_path)

    # alice 的 sent-texts 文件
    alice_file = listen_chat.get_state_file_path(base_dir, "sent-texts", "wxid_alice")
    bob_file = listen_chat.get_state_file_path(base_dir, "sent-texts", "wxid_bob")

    # 写入不同内容
    os.makedirs(os.path.dirname(alice_file), exist_ok=True)
    os.makedirs(os.path.dirname(bob_file), exist_ok=True)

    with open(alice_file, "w", encoding="utf-8") as f:
        json.dump(["alice 的回复"], f)
    with open(bob_file, "w", encoding="utf-8") as f:
        json.dump(["bob 的回复"], f)

    # 文件内容相互独立
    with open(alice_file, "r", encoding="utf-8") as f:
        alice_data = json.load(f)
    with open(bob_file, "r", encoding="utf-8") as f:
        bob_data = json.load(f)

    assert alice_data == ["alice 的回复"]
    assert bob_data == ["bob 的回复"]
    assert alice_data != bob_data, "两个账号的状态文件内容完全隔离"


def test_state_file_path_contains_correct_filename(tmp_path):
    """状态文件路径格式正确：zj-{kind}-{wechat_id}.json。"""
    base_dir = str(tmp_path)

    sent_path = listen_chat.get_state_file_path(base_dir, "sent-texts", "wxid_test")
    anchor_path = listen_chat.get_state_file_path(base_dir, "reply-anchor", "wxid_test")

    # 验证文件名格式
    assert os.path.basename(sent_path) == "zj-sent-texts-wxid_test.json", \
        f"sent-texts 文件名应为 zj-sent-texts-wxid_test.json，实际: {os.path.basename(sent_path)}"
    assert os.path.basename(anchor_path) == "zj-reply-anchor-wxid_test.json", \
        f"reply-anchor 文件名应为 zj-reply-anchor-wxid_test.json，实际: {os.path.basename(anchor_path)}"
