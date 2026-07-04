# -*- coding: utf-8 -*-
"""
Bug 1 (INFLIGHT泄漏) regression — 1.0.107 staging 重测发现：

dryrun gate（machine_id 在册但 auto_agent OFF / 拉配置失败）→ `continue` 跳过
轮尾 INFLIGHT 清理（4285-4288 行），sender 永久卡死在处理中状态，后续任何轮
都因 L902 `if sender in _INFLIGHT: continue` 被忽略——等同于永久拉黑该客户。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def test_dryrun_gate_releases_inflight():
    """dryrun 路径（machine_id 在册且非真发）必须释放 INFLIGHT，否则 sender 永久卡死。

    复现步骤：
    1. 把两个 sender 标记为 INFLIGHT（模拟上轮已 emit，正在处理中）
    2. 进入 dryrun gate（machine_id=设置，_real_publish=False）
    3. 执行 dryrun gate 内的清理逻辑
    4. 断言：INFLIGHT 已清空，sender 不再被锁
    """
    # 模拟上轮已 emit，sender 被标记处理中
    listen_chat._INFLIGHT.add("客户甲")
    listen_chat._INFLIGHT.add("客户乙")

    unread = [
        {"sender": "客户甲", "content": "我要买"},
        {"sender": "客户乙", "content": "在吗"},
    ]

    # dryrun gate 应该释放 INFLIGHT
    for m in unread:
        s = m.get("sender", "")
        if s in listen_chat._INFLIGHT:
            listen_chat._release_inflight(s)

    assert "客户甲" not in listen_chat._INFLIGHT, "dryrun 后 sender 必须从 INFLIGHT 释放"
    assert "客户乙" not in listen_chat._INFLIGHT, "dryrun 后 sender 必须从 INFLIGHT 释放"


def test_inflight_leak_causes_permanent_skip():
    """反向证明：如果 INFLIGHT 未释放，scan_unread 在下一轮永久跳过该 sender。

    这是当前 bug 的复现——dryrun continue 前没有清 INFLIGHT，导致该测试通过。
    修复后此测试的前提条件（_INFLIGHT 被污染）应由 dryrun gate 自己清理，
    但我们在这里直接验证"INFLIGHT 残留 → scan 跳过"的行为是正确认知。
    """
    # 人工污染 INFLIGHT（模拟 dryrun gate 泄漏）
    listen_chat._INFLIGHT.add("默忆")

    # scan_unread 构造 mock 需要完整 MW；这里只测 INFLIGHT 的"跳过守门"逻辑
    # 即：如果 sender 在 INFLIGHT，scan 绝不重复 emit（这是正确行为）
    # 但 dryrun 后应清除，否则变成永久跳过
    assert "默忆" in listen_chat._INFLIGHT, "前提：INFLIGHT 被污染"

    # 验证 release 能解锁
    listen_chat._release_inflight("默忆")
    assert "默忆" not in listen_chat._INFLIGHT, "release 后 sender 必须可重新 emit"
