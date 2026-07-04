# -*- coding: utf-8 -*-
"""INFLIGHT 泄漏根治（Task 10，真机复现 2 次的 🔴 bug）：

发送链路中途失败后 _INFLIGHT 集合不释放 → 该联系人被 scan 永久静默跳过
（不打日志不计数），只有重启监听才恢复。根治两刀：
  1. _INFLIGHT 改 dict[sender→加入时间戳] + INFLIGHT_TTL 兜底——卡死超时强制释放。
  2. 主循环 scan 之后到轮尾 sweep 整段包 try/finally——异常/任何 continue 路径都释放。
本文件是该泄漏的永久 regression test。
"""
import os
import re
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


@pytest.fixture(autouse=True)
def _clean():
    listen_chat._INFLIGHT.clear()
    listen_chat._LAST_EMIT.clear()
    yield
    listen_chat._INFLIGHT.clear()
    listen_chat._LAST_EMIT.clear()


@pytest.fixture
def _cap_log(monkeypatch):
    """捕获 _log 输出（_log 真身打印 + 写文件，测试只需断言调用内容）。"""
    logs = []
    monkeypatch.setattr(listen_chat, "_log", lambda msg: logs.append(str(msg)))
    return logs


def test_ttl_expired_entry_is_released_and_logged(_cap_log):
    """卡死超过 INFLIGHT_TTL 的处理中条目 → should_skip 返回 False（放行）、
    条目被强制释放、且打了 inflight-ttl-recover 日志（绝不永久静默）。"""
    listen_chat._INFLIGHT["卡死客户"] = listen_chat.time.time() - (listen_chat.INFLIGHT_TTL + 20)
    assert listen_chat._inflight_should_skip("卡死客户") is False, "TTL 过期必须放行"
    assert "卡死客户" not in listen_chat._INFLIGHT, "TTL 过期条目必须被强制释放"
    assert any("inflight-ttl-recover" in m for m in _cap_log), \
        f"必须打 inflight-ttl-recover 日志，实际 {_cap_log!r}"


def test_fresh_entry_should_skip(_cap_log):
    """新鲜处理中条目（未超时）→ should_skip 返回 True（本轮跳过，防复读）。"""
    listen_chat._INFLIGHT["处理中客户"] = listen_chat.time.time()
    assert listen_chat._inflight_should_skip("处理中客户") is True
    assert "处理中客户" in listen_chat._INFLIGHT, "未超时不得释放"


def test_unknown_sender_not_skipped():
    """从未进处理中的 sender → should_skip 返回 False（正常进入候选）。"""
    assert listen_chat._inflight_should_skip("陌生人") is False


def test_release_inflight_leaves_no_residue():
    """_release_inflight 后 _INFLIGHT / _LAST_EMIT 均无残留。"""
    listen_chat._INFLIGHT["某人"] = listen_chat.time.time()
    listen_chat._LAST_EMIT["某人"] = ("hi", listen_chat.time.time())
    listen_chat._release_inflight("某人")
    assert "某人" not in listen_chat._INFLIGHT
    assert "某人" not in listen_chat._LAST_EMIT


def test_inflight_is_dict_with_timestamp():
    """_INFLIGHT 语义是 dict[sender→float 时间戳]，不是 set（TTL 兜底的前提）。"""
    assert isinstance(listen_chat._INFLIGHT, dict)
    listen_chat._INFLIGHT["x"] = listen_chat.time.time()
    assert isinstance(listen_chat._INFLIGHT["x"], float)


def test_sweep_inflight_releases_all_in_unread():
    """_sweep_inflight(unread)：本轮 unread 里仍在处理中的人全部释放（宁可迟到不可丢）。"""
    listen_chat._INFLIGHT["甲"] = listen_chat.time.time()
    listen_chat._INFLIGHT["乙"] = listen_chat.time.time()
    listen_chat._sweep_inflight([{"sender": "甲"}, {"sender": "乙"}])
    assert "甲" not in listen_chat._INFLIGHT
    assert "乙" not in listen_chat._INFLIGHT


def test_sweep_inflight_noop_on_already_released():
    """DELIVERED 已 pop 的人再 sweep = no-op 不抛；缺/空 sender 也不抛。"""
    listen_chat._INFLIGHT["乙"] = listen_chat.time.time()
    listen_chat._sweep_inflight([{"sender": "甲"}, {"sender": "乙"}])  # 甲 不在册
    assert "乙" not in listen_chat._INFLIGHT
    listen_chat._sweep_inflight([{}, {"sender": ""}])  # 缺键/空 sender 不抛


def test_main_loop_sweep_in_try_finally():
    """结构守卫（防将来退化）：主循环轮尾 sweep 必须走 finally 块调用 _sweep_inflight，
    否则异常/continue 路径又会泄漏处理中标记。锁函数名而非内部变量名，降脆性。"""
    src = open(os.path.join(_WECHAT, "listen_chat.py"), encoding="utf-8").read()
    # finally: 之后（隔注释/空白）调用 _sweep_inflight(unread)
    pat = re.compile(
        r"\n\s*finally:\s*\n"
        r"(?:\s*#.*\n|\s*\n)*"
        r"\s*_sweep_inflight\(unread\)",
    )
    assert pat.search(src), "主循环轮尾 sweep 必须在 finally 块内调用 _sweep_inflight(unread)"
