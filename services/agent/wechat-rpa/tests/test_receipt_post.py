"""
TDD — listen_chat.post_message_receipt：模块侧送达回执上报（bug2 下半）。

背景：中台 PR#1105 已上线 —— draft-generate 响应带 message_id（number|null）；
POST /api/wechat/messages/:id/receipt body {ok, agent_id}，返回 {ok:true,updated} / 400 / 403，
旧 API 404 需容忍。

要求：
  - post_message_receipt 正常 → POST 到 /api/wechat/messages/{id}/receipt，body.ok / body.agent_id。
  - message_id 为 None/空 → 静默跳过，不发任何请求。
  - http 抛异常 / 非 2xx → 只打日志，绝不抛、绝不阻塞发送主流程。

RED：post_message_receipt 不存在 → AttributeError。
CI 安全：顶层零 pywinauto；用 fake requests 注入 sys.modules，跨平台可跑。
"""
from __future__ import annotations

import ast
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)
LISTEN_CHAT = os.path.abspath(os.path.join(HERE, "..", "listen_chat.py"))

import listen_chat  # noqa: E402


def _make_fake_requests(calls, status=200, raise_exc=None):
    m = types.ModuleType("requests")

    def post(url, json=None, timeout=None):  # noqa: A002 - 模拟 requests.post 签名
        calls.append({"url": url, "json": json})
        if raise_exc:
            raise raise_exc
        return types.SimpleNamespace(
            status_code=status, text="ok", json=lambda: {"ok": True, "updated": True}
        )

    m.post = post  # type: ignore[attr-defined]
    return m


def test_receipt_posts_to_message_endpoint(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")
    assert len(calls) == 1
    assert calls[0]["url"].endswith("/api/wechat/messages/42/receipt")
    assert calls[0]["json"]["ok"] is True
    assert calls[0]["json"]["agent_id"] == "agent-1"


def test_receipt_function_retains_ok_false_capability(monkeypatch):
    # 函数本身保留 ok=False 能力（将来真正「终态放弃」路径可用）；但主循环冷却重试分支
    # 不得调用它（见下方 AST 守卫）——中台 markMessageReceipt 只翻 status='draft' 的行，
    # 一旦记 failed 就是终态，冷却重试后真送达也永久钉死 failed。
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", 7, False, "agent-1")
    assert len(calls) == 1
    assert calls[0]["json"]["ok"] is False


def test_receipt_skips_when_message_id_none(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", None, True, "agent-1")
    assert calls == []  # message_id 缺失 → 静默跳过，不发任何请求


def test_receipt_skips_when_message_id_empty_string(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls))
    listen_chat.post_message_receipt("http://mw:3000", "", True, "agent-1")
    assert calls == []


def test_receipt_swallows_network_exception(monkeypatch):
    monkeypatch.setattr(listen_chat.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setitem(
        sys.modules, "requests", _make_fake_requests([], raise_exc=RuntimeError("net down"))
    )
    # 不抛异常即通过（发送主流程绝不被回执上报拖垮）
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")


def test_receipt_tolerates_404_old_api(monkeypatch):
    calls: list = []
    monkeypatch.setitem(sys.modules, "requests", _make_fake_requests(calls, status=404))
    # 旧 API 返回 404 → 不抛、只打日志
    listen_chat.post_message_receipt("http://mw:3000", 42, True, "agent-1")
    assert len(calls) == 1  # 4xx 不重试，只发一次


# ── AST 守卫：主循环绝不用 ok=False 上报回执（中台 receipt 单向幂等，failed 是终态）─────
# 根因（team-lead 裁决）：markMessageReceipt 只翻 status='draft' 的行；一旦 failed 即终态，
# 冷却重试后真送达也永久钉死 failed。所以发送失败/冷却重试分支只能保持 draft（打日志），
# 绝不调 post_message_receipt(ok=False)。proven-to-fire：谁把 ok=False 塞回失败分支立即红。


def _receipt_calls():
    with open(LISTEN_CHAT, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "post_message_receipt":
            calls.append(node)
    return calls


def test_mainloop_never_posts_ok_false():
    """listen_chat.py 里 post_message_receipt 的所有调用点，ok 位（第3个位置参数）不得为 False。"""
    for call in _receipt_calls():
        assert len(call.args) >= 3, "post_message_receipt 应以位置参数传 ok"
        ok_arg = call.args[2]
        is_false = isinstance(ok_arg, ast.Constant) and ok_arg.value is False
        assert not is_false, (
            f"listen_chat.py:{call.lineno} 在主循环用 ok=False 上报回执——中台 failed 是终态，"
            f"冷却重试后真送达会被永久钉死 failed。失败/冷却分支只保持 draft 打日志。"
        )


def test_mainloop_posts_ok_true_on_success():
    """成功路径仍接线 ok=True（至少一个调用点传 True，防止改错把回执整段删掉）。"""
    has_true = any(
        len(c.args) >= 3 and isinstance(c.args[2], ast.Constant) and c.args[2].value is True
        for c in _receipt_calls()
    )
    assert has_true, "主循环成功路径应调 post_message_receipt(..., True, ...) 上报送达"
