# -*- coding: utf-8 -*-
"""
Bug 3 (同机双租户) regression — 1.0.107 staging 重测发现：

_STATE_DIR 默认为 C:\\Users\\Public，同机多进程（多租户 machine_id 不同）
全写同一份 zj-sent-texts.json / zj-reply-anchor.json → 状态污染，判向混乱。

修法：当 machine_id 已知时，state 文件必须隔离到 machine_id 专属子目录，
如 C:\\Users\\Public\\zj-tenant-{machine_id}\\。

测试用 _init_state_paths(machine_id) 函数（由修复实现）验证路径隔离。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_init_state_paths_without_machine_id_uses_base():
    """machine_id=None → state 文件用基础 _STATE_DIR，不加子目录。"""
    listen_chat._init_state_paths(None)
    base = listen_chat._STATE_DIR
    assert listen_chat._SENT_TEXTS_FILE == os.path.join(base, "zj-sent-texts.json")
    assert listen_chat._REPLY_ANCHOR_FILE == os.path.join(base, "zj-reply-anchor.json")


def test_init_state_paths_with_machine_id_uses_subdirectory():
    """machine_id=X → state 文件必须在 _STATE_DIR/zj-tenant-X/ 子目录下。

    这是 Bug 3 的核心断言：同机两个租户（machine_id 不同）→ 路径互不重叠。
    """
    listen_chat._init_state_paths("machine-abc")
    base = listen_chat._STATE_DIR
    expected_dir = os.path.join(base, "zj-tenant-machine-abc")
    assert listen_chat._SENT_TEXTS_FILE == os.path.join(
        expected_dir, "zj-sent-texts.json"
    ), "machine_id 在册时 sent_texts 必须隔离到租户子目录"
    assert listen_chat._REPLY_ANCHOR_FILE == os.path.join(
        expected_dir, "zj-reply-anchor.json"
    ), "machine_id 在册时 reply_anchor 必须隔离到租户子目录"


def test_two_tenants_have_distinct_paths():
    """两个不同 machine_id → 两套文件路径绝不重叠。

    同机双租户场景：machine_id_A ≠ machine_id_B → 路径不同。
    """
    listen_chat._init_state_paths("tenant-001")
    path_a_sent = listen_chat._SENT_TEXTS_FILE
    path_a_anchor = listen_chat._REPLY_ANCHOR_FILE

    listen_chat._init_state_paths("tenant-002")
    path_b_sent = listen_chat._SENT_TEXTS_FILE
    path_b_anchor = listen_chat._REPLY_ANCHOR_FILE

    assert path_a_sent != path_b_sent, "两个租户的 sent_texts 文件路径必须不同"
    assert path_a_anchor != path_b_anchor, "两个租户的 reply_anchor 文件路径必须不同"
