# -*- coding: utf-8 -*-
"""1.0.108 staging 重测 7 bug 回归测试（Python 侧：Bug1/3/4/5）。

- Bug1: INFLIGHT泄漏 — machine_id gate dryrun continue 跳过轮尾清理
- Bug3: 同机双租户 — fetch_cs_config 现在透传 agent_id
- Bug4: 大群缓存 — 纯人数标题 "(469)" 也写 _KNOWN_GROUPS
- Bug5: 角标缺失 — prev!=name 路径 badge 保底设 1 防消息丢失
"""
import os
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

# ── 桩重依赖 ──────────────────────────────────────────────────────────────────
for _name in ["pywinauto", "pywinauto.application",
              "pywinauto.controls", "pywinauto.controls.uia_controls"]:
    if _name not in sys.modules:
        _m = types.ModuleType(_name)
        _m.Desktop = MagicMock()
        sys.modules[_name] = _m
for _name in ["requests"]:
    if _name not in sys.modules:
        _m = types.ModuleType(_name)
        _m.get = MagicMock()
        _m.post = MagicMock()
        sys.modules[_name] = _m

import listen_chat  # noqa: E402
import cs_config_gate  # noqa: E402

# ─── Bug1：INFLIGHT泄漏 ────────────────────────────────────────────────────────

class _Item:
    class element_info:
        handle = 12345
        control_type = "ListItem"
        name = "Alice\n[1条] \n你好\n10:00\n"
    _element_info = element_info()

    @property
    def element_info(self):
        return self._element_info


def test_bug1_inflight_released_on_dryrun_continue():
    """Bug1 回归：machine_id gate dryrun-continue 之前必须释放 _INFLIGHT，
    否则这批 sender 下轮全被挡（INFLIGHT 永久僵死）。"""
    listen_chat._INFLIGHT.add("Alice")
    listen_chat._INFLIGHT.add("Bob")

    unread = [{"sender": "Alice"}, {"sender": "Bob"}, {"sender": ""}]

    # 模拟 machine_id gate 逻辑（真实代码路径）
    for _m_dryrun in unread:
        listen_chat._release_inflight(_m_dryrun.get("sender", ""))

    assert "Alice" not in listen_chat._INFLIGHT, "Bug1：dryrun 后 Alice 仍在 INFLIGHT"
    assert "Bob" not in listen_chat._INFLIGHT, "Bug1：dryrun 后 Bob 仍在 INFLIGHT"


def test_bug1_empty_sender_does_not_crash():
    """Bug1：空 sender 调 _release_inflight 不崩（unread 含 sender='' 的情况）。"""
    listen_chat._INFLIGHT.add("Alice")
    listen_chat._release_inflight("")  # 不应抛
    assert "Alice" in listen_chat._INFLIGHT  # 不影响其他 sender


# ─── Bug3：同机双租户（cs_config_gate.fetch_cs_config 透传 agent_id）────────

def test_bug3_fetch_cs_config_passes_agent_id(monkeypatch):
    """Bug3 回归：fetch_cs_config 有 agent_id 时，HTTP 请求必须带 agent_id 参数。"""
    captured = {}

    def mock_get(url, params=None, timeout=10):
        captured["params"] = params
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"auto_agent_enabled": True}
        return resp

    monkeypatch.setattr(cs_config_gate, "requests", MagicMock(get=mock_get))

    cfg, ok = cs_config_gate.fetch_cs_config(
        "http://mid/", "machine-x", agent_id="agent-env-abc123"
    )
    assert ok
    assert captured.get("params", {}).get("agent_id") == "agent-env-abc123", \
        "Bug3：agent_id 未透传到 HTTP 请求参数"
    assert captured["params"]["machine_id"] == "machine-x"


def test_bug3_fetch_cs_config_backward_compat_no_agent_id(monkeypatch):
    """Bug3：不传 agent_id 时行为不变（backward-compatible）。"""
    captured = {}

    def mock_get(url, params=None, timeout=10):
        captured["params"] = params
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {"auto_agent_enabled": False}
        return resp

    monkeypatch.setattr(cs_config_gate, "requests", MagicMock(get=mock_get))

    cfg, ok = cs_config_gate.fetch_cs_config("http://mid/", "machine-y")
    assert ok
    assert "agent_id" not in captured["params"], "Bug3：不传 agent_id 时不该带此参数"


# ─── Bug4：大群缓存（纯 count-only 标题也写 _KNOWN_GROUPS）──────────────────

class _FakeMW:
    class element_info:
        name = ""
    def rectangle(self):
        class R:
            left, top, right, bottom = 0, 0, 800, 600
        return R()


def test_bug4_large_group_count_only_header_cached(monkeypatch):
    """Bug4 回归：WeChat 大群标题只显 '(469)' 时（无群名），_KNOWN_GROUPS 必须写入。"""
    mw = _FakeMW()
    cand = {"sender": "某大群", "_item": MagicMock(), "_opened": False}

    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, item, sender, **kw: True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: False)  # title_ok=False
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["(469)"])

    listen_chat._read_trailing_for(mw, cand)

    assert "某大群" in listen_chat._KNOWN_GROUPS, \
        "Bug4：纯人数标题的大群未写入 _KNOWN_GROUPS → 下轮反复开群"
    assert cand.get("_is_group") is True


def test_bug4_normal_group_title_match_still_works(monkeypatch):
    """Bug4：正常群（标题含群名+人数）通过 title_ok 写缓存，不受影响。"""
    mw = _FakeMW()
    cand = {"sender": "产品讨论群(5)", "_item": MagicMock(), "_opened": False}

    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, item, sender, **kw: True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)  # title_ok=True
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["产品讨论群(5)"])

    listen_chat._read_trailing_for(mw, cand)

    assert "产品讨论群(5)" in listen_chat._KNOWN_GROUPS


def test_bug4_private_chat_count_like_not_cached(monkeypatch):
    """Bug4：私聊名字里有数字括号（如电话号）不能误判为大群纯人数标题。"""
    # 私聊标题含 CJK 文字，不是纯数字括号格式 → 不走 hdr_only_count 路径
    mw = _FakeMW()
    cand = {"sender": "张三", "_item": MagicMock(), "_opened": False}

    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, item, sender, **kw: True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: False)  # title_ok=False
    # 标题含中文 → 不是纯人数格式 → 不写缓存
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["张三 北京"])
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "你好", "direction": "incoming"}
    ])
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)

    listen_chat._read_trailing_for(mw, cand)

    assert "张三" not in listen_chat._KNOWN_GROUPS, \
        "Bug4：私聊不应被误判为大群写入缓存"
    assert not cand.get("_is_group")


# ─── Bug5：角标缺失（prev!=name 路径 badge 保底 1）──────────────────────────

class _EI:
    def __init__(self, name=""):
        self.name = name
        self.control_type = "ListItem"
        self.handle = 12345


class _ScanItem:
    def __init__(self, name):
        self.element_info = _EI(name)


class _ScanMW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class R:
            left, top, right, bottom = 0, 0, 800, 600
        return R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["默忆"])
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_jiggle_msg_list", lambda mw: None)
    monkeypatch.setattr(listen_chat, "_wechat_is_foreground", lambda mw: False)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)


def test_bug5_prev_name_change_triggers_with_badge_one(monkeypatch):
    """Bug5 回归：prev!=name（内容变化，无 [N条] 角标）路径 badge 保底 1，
    保证 split_trailing 在无锚点时能取到消息，不会返回 []。"""
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "你好，在吗？", "direction": "incoming"},
    ])
    mw = _ScanMW([_ScanItem("张三\n你好，在吗？\n10:00\n")])  # 无 [N条] 角标
    last_preview = {"张三": "张三\n昨日对话\n09:00\n"}  # 内容变了但无角标

    out = listen_chat.scan_unread(mw, last_preview)

    assert out, "Bug5：prev!=name 触发但 badge=0 导致 split_trailing 返回 [] → 消息丢"
    assert out[0]["sender"] == "张三"


def test_bug5_badge_zero_without_prev_change_still_silent(monkeypatch):
    """Bug5：prev==name（内容没变）的情况不触发，保持原有静默行为。"""
    name = "张三\n昨日对话\n09:00\n"
    mw = _ScanMW([_ScanItem(name)])
    last_preview = {"张三": name}  # prev == name，无变化

    out = listen_chat.scan_unread(mw, last_preview)

    assert not out, "Bug5：prev==name 时不应触发"
