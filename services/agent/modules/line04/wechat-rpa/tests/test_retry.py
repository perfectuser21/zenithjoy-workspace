"""
TDD — listen_chat._post_with_retry：中台 HTTP 调用指数退避重试（跨境抖动护栏）。

要求：
  - 网络异常 / 连接超时 / 5xx / 429 → 重试（指数退避）。
  - 4xx（非 429）客户端错误 → 不重试。
  - 最终失败返回 (None, error)，绝不抛。
  - draft-generate / heartbeat 复用它，对外返回结构不变（{ok:...} 风格）。

CI 安全：顶层零 pywinauto；用 fake requests 注入 sys.modules，跨平台可跑；
monkeypatch time.sleep 让退避不真等。
"""
from __future__ import annotations

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


class _FakeConnError(Exception):
    """模拟 requests.exceptions.ConnectionError。"""


class _FakeTimeout(Exception):
    """模拟 requests.exceptions.Timeout。"""


def _make_fake_requests(behaviors):
    """
    behaviors：每次调用要执行的动作列表，元素为：
      - Exception 实例 → 抛出（模拟网络异常 / 超时）
      - int 状态码 → 返回该 status 的 fake response
    超出列表长度后重复最后一个动作。
    返回 (fake_module, calls) ，calls 记录调用次数（list 便于闭包计数）。
    """
    m = types.ModuleType("requests")
    calls = {"n": 0}

    def post(url, json=None, timeout=None):  # noqa: A002
        idx = min(calls["n"], len(behaviors) - 1)
        calls["n"] += 1
        action = behaviors[idx]
        if isinstance(action, Exception):
            raise action
        return types.SimpleNamespace(
            status_code=action,
            text="body",
            json=lambda: {"ok": True, "echo": json},
        )

    m.post = post  # type: ignore[attr-defined]
    return m, calls


def _no_sleep(monkeypatch):
    """monkeypatch listen_chat.time.sleep 让测试不真等。"""
    slept = []
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: slept.append(s))
    return slept


# ─── _post_with_retry 直接单测 ───────────────────────────────────────────────


def test_retry_succeeds_after_transient_failures(monkeypatch):
    """前 N 次抛 ConnectionError/Timeout，第 N+1 次 200 → 最终成功且调用 N+1 次。"""
    slept = _no_sleep(monkeypatch)
    behaviors = [_FakeConnError("reset"), _FakeTimeout("timed out"), 200]
    fake, calls = _make_fake_requests(behaviors)
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {"a": 1}, timeout=5, retries=3, backoff_base=1.0
    )
    assert error is None
    assert resp.status_code == 200
    assert calls["n"] == 3  # 2 次失败 + 1 次成功
    assert slept == [1.0, 2.0]  # 指数退避


def test_retry_exhausts_and_returns_error_not_raise(monkeypatch):
    """持续失败 → 返回 (None, error) 不抛，调用次数 = retries 上限。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([_FakeConnError("down")])
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {}, timeout=5, retries=3, backoff_base=1.0
    )
    assert resp is None
    assert error is not None and "_FakeConnError" in error
    assert calls["n"] == 3  # 用满 retries，不多不少


def test_4xx_not_retried(monkeypatch):
    """4xx（非 429）客户端错误 → 只调 1 次，不重试。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([400])
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {}, timeout=5, retries=3, backoff_base=1.0
    )
    assert resp is None
    assert error is not None and "400" in error
    assert calls["n"] == 1  # 客户端错误不重试


def test_429_is_retried(monkeypatch):
    """429 限流 → 重试，最后一次 200 成功。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([429, 429, 200])
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {}, timeout=5, retries=3, backoff_base=1.0
    )
    assert error is None
    assert resp.status_code == 200
    assert calls["n"] == 3


def test_503_is_retried(monkeypatch):
    """503 服务端错误 → 重试到上限后返回 error。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([503])
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {}, timeout=5, retries=3, backoff_base=1.0
    )
    assert resp is None
    assert error is not None and "503" in error
    assert calls["n"] == 3


def test_max_total_caps_backoff(monkeypatch):
    """max_total 限制总退避时长：heartbeat 风格（retries=2,backoff=0.5）→ 最多 sleep 一次且总 <10s。"""
    slept = _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([_FakeConnError("x")])
    monkeypatch.setitem(sys.modules, "requests", fake)

    resp, error = listen_chat._post_with_retry(
        "http://mw/x", {}, timeout=5, retries=2, backoff_base=0.5, max_total=10
    )
    assert resp is None
    assert calls["n"] == 2  # retries=2
    assert sum(slept) < 10  # 不拖垮监听主循环


# ─── 调用方复用：返回结构不变 ─────────────────────────────────────────────────


def test_post_draft_generate_retries_then_success(monkeypatch):
    """post_draft_generate 透明重试，成功后返回中台 JSON（结构不变）。"""
    _no_sleep(monkeypatch)
    monkeypatch.delenv("WECHAT_DRAFT_API_DRYRUN", raising=False)
    fake, calls = _make_fake_requests([_FakeConnError("net"), 200])
    monkeypatch.setitem(sys.modules, "requests", fake)

    r = listen_chat.post_draft_generate("http://mw:3000", "张三", "wx1", "在吗", mode="auto")
    assert r["ok"] is True
    assert calls["n"] == 2


def test_post_draft_generate_4xx_no_retry(monkeypatch):
    """draft-generate 遇 4xx 不重试，返回 {ok:False}。"""
    _no_sleep(monkeypatch)
    monkeypatch.delenv("WECHAT_DRAFT_API_DRYRUN", raising=False)
    fake, calls = _make_fake_requests([404])
    monkeypatch.setitem(sys.modules, "requests", fake)

    r = listen_chat.post_draft_generate("http://mw:3000", "张三", "wx1", "在吗")
    assert r["ok"] is False
    assert calls["n"] == 1


def test_post_draft_generate_dryrun_unchanged(monkeypatch):
    """WECHAT_DRAFT_API_DRYRUN=1 mock 路径不变（不走 HTTP / 重试）。"""
    monkeypatch.setenv("WECHAT_DRAFT_API_DRYRUN", "1")
    r = listen_chat.post_draft_generate("http://mw:3000", "张三", "wx1", "在吗", mode="auto")
    assert r["ok"] is True
    assert r["_mock"] is True
    assert r["reply"] == "mock_reply"


def test_post_heartbeat_retries_then_success(monkeypatch):
    """post_heartbeat 透明重试，成功返回 {ok:True}。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([_FakeTimeout("slow"), 200])
    monkeypatch.setitem(sys.modules, "requests", fake)

    r = listen_chat.post_heartbeat("http://mw:3000", agent_id="a1")
    assert r["ok"] is True
    assert calls["n"] == 2


def test_post_heartbeat_exhausts_returns_false(monkeypatch):
    """heartbeat 持续失败 → {ok:False} 不抛，重试 2 次上限。"""
    _no_sleep(monkeypatch)
    fake, calls = _make_fake_requests([503])
    monkeypatch.setitem(sys.modules, "requests", fake)

    r = listen_chat.post_heartbeat("http://mw:3000", agent_id="a1")
    assert r["ok"] is False
    assert calls["n"] == 2  # heartbeat retries=2
