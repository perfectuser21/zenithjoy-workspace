"""
test_outbound_keycontact.py — listen_chat 关键人出站任务接线（拉取→真机发送→回执）单测。

C1 尾巴接线：中台把「主动发给关键人」的出站任务入库，listen_chat.process_outbound_once
每轮拉取 → 调 send_chat.send_chat_message 真机发送 → 回写回执。真机 UIA 发送是接缝
（xian-rog 真验），这里用 monkeypatch 替掉 fetch / send / receipt，验证「链路接通 + 回执回写」
逻辑无 orphan：拉到任务就发、发成功回 ok=True、发失败回 ok=False。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import listen_chat  # noqa: E402


def test_process_outbound_sends_each_task_and_posts_receipt(monkeypatch):
    tasks = [
        {"task_id": "t1", "target": "关键人A", "message": "🟢 上线"},
        {"task_id": "t2", "target": "关键人A", "message": "⚠️ 告警"},
    ]
    monkeypatch.setattr(listen_chat, "fetch_outbound_tasks", lambda *a, **k: tasks)

    sent_calls = []

    def fake_send(target, wechat_id, message, real_publish):
        sent_calls.append((target, message))
        return {"ok": True, "dryRun": not real_publish}

    # send_chat 在函数体内 import；用 sys.modules 注入假模块
    import types
    fake_mod = types.ModuleType("send_chat")
    fake_mod.send_chat_message = fake_send
    monkeypatch.setitem(sys.modules, "send_chat", fake_mod)

    receipts = []
    monkeypatch.setattr(
        listen_chat, "post_outbound_receipt",
        lambda url, tid, ok, **k: receipts.append((tid, ok)),
    )

    n = listen_chat.process_outbound_once("http://mw", "agent-1", real_publish=False)

    assert n == 2  # 两条都发出
    assert sent_calls == [("关键人A", "🟢 上线"), ("关键人A", "⚠️ 告警")]
    assert receipts == [("t1", True), ("t2", True)]  # 回执都回 ok=True


def test_process_outbound_send_failure_posts_failed_receipt_and_alert(monkeypatch):
    monkeypatch.setattr(
        listen_chat, "fetch_outbound_tasks",
        lambda *a, **k: [{"task_id": "t9", "target": "关键人B", "message": "🔴 下线"}],
    )

    import types
    fake_mod = types.ModuleType("send_chat")
    fake_mod.send_chat_message = lambda *a, **k: {"ok": False, "reason": "session_not_found"}
    monkeypatch.setitem(sys.modules, "send_chat", fake_mod)

    receipts = []
    monkeypatch.setattr(
        listen_chat, "post_outbound_receipt",
        lambda url, tid, ok, **k: receipts.append((tid, ok)),
    )
    alerts = []
    monkeypatch.setattr(
        listen_chat, "post_failure_alert",
        lambda url, aid, kc, reason, **k: alerts.append((kc, reason)),
    )

    n = listen_chat.process_outbound_once("http://mw", "agent-1", real_publish=True)

    assert n == 0  # 没发成功
    assert receipts == [("t9", False)]  # 回执回 send_failed
    assert alerts == [("关键人B", "key_contact_send_failed")]  # 自身失败再报一条告警


def test_process_outbound_empty_when_no_tasks(monkeypatch):
    monkeypatch.setattr(listen_chat, "fetch_outbound_tasks", lambda *a, **k: [])
    n = listen_chat.process_outbound_once("http://mw", "agent-1", real_publish=False)
    assert n == 0


def test_fetch_outbound_no_agent_id_returns_empty():
    assert listen_chat.fetch_outbound_tasks("http://mw", None) == []
    assert listen_chat.fetch_outbound_tasks("http://mw", "") == []
