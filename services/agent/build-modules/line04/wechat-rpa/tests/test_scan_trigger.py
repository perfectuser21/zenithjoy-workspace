# -*- coding: utf-8 -*-
"""锚点气泡扫描 scan_unread 重构守卫（替代 test_scan_unread_path2_content_change.py）。

守卫契约（proven-to-fire）：
- case trigger_by_preview_change：把预览变化触发删掉（回到只认角标）→ 必红（复现
  "会话打开后角标被清、消息永久漏读"——2026-07-02 连发5条漏3条主 bug 的发现层）。
- case open_fail_keeps_trigger：触发态在失败路径被消费 → 必红（新机制的事务性）。
顶层零 pywinauto，monkeypatch 打开/读气泡。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name)


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class _R:  # 可见态正常几何
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


@pytest.fixture(autouse=True)
def _no_window_ops(monkeypatch):
    """扫描的窗口显隐/群判定/sleep 全部中和（纯逻辑测试）。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户"])
    # F3 归属闸默认放行（面板标题=目标 sender）；误判场景由具体 case 覆盖为 False
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: True)
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._ANCHOR_STALL.clear()


def _mk(name):
    return _Item(name)


def test_badge_session_reads_bubbles_and_merges(monkeypatch):
    """角标会话：开窗读气泡，取锚点后 trailing 合并（不再只信预览单条）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "什么价格", "direction": "incoming"},
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "发下资料", "direction": "incoming"},
        {"text": "你们公司信息", "direction": "incoming"},
    ])
    mw = _MW([_mk("默忆\n[1条] \n你们公司信息\n14:43\n")])
    out = listen_chat.scan_unread(mw, {})
    assert len(out) == 1
    assert out[0]["sender"] == "默忆"
    assert out[0]["content"] == "发下资料\n\n你们公司信息"
    assert out[0]["_preview_name"].startswith("默忆")


def test_trigger_by_preview_change(monkeypatch):
    """无角标但 item name 变了（会话开着被自动已读）→ 触发开窗读气泡 → 取出漏读消息。
    这是主 bug 的发现层守卫：删掉预览变化触发必红。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "我想买好产品", "direction": "incoming"},
    ])
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n我想买好产品\n14:43\n")])
    out = listen_chat.scan_unread(mw, last_preview)
    assert [m["content"] for m in out] == ["我想买好产品"]
    # 触发未消费（等 DELIVERED 才提交）：last_preview 保持旧值
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_first_seen_records_only(monkeypatch):
    """首见只记录不触发（防陈年消息/重启风暴）。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": pytest.fail("不该开窗"))
    last_preview = {}
    mw = _MW([_mk("默忆\n在吗\n14:40\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_no_new_trailing_commits_preview(monkeypatch):
    """开窗后发现无新 incoming（最后一条是我方）→ 提交 last_preview（白开只此一次）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
        {"text": "您好99元", "direction": "outgoing"},
    ])
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n您好99元\n14:44\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n您好99元\n14:44\n"


def test_open_fail_keeps_trigger(monkeypatch):
    """开窗失败：预览触发态保留（不更新 last_preview）→ 下轮重试，绝不静默消费。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": False)
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n发下资料\n14:43\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_open_fail_with_badge_falls_back_to_preview(monkeypatch):
    """开窗失败但有角标：回退旧单条路径（保底不漏，兼容 CI 假环境）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": False)
    mw = _MW([_mk("默忆\n[2条] \n发下资料\n14:43\n")])
    out = listen_chat.scan_unread(mw, {})
    assert [m["content"] for m in out] == ["发下资料"]


def test_bubble_empty_with_badge_falls_back(monkeypatch):
    """开窗成功但气泡读空（轮询后仍空）：有角标 → 回退预览单条 + bubble_read_empty 计数。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [])
    recorded = []
    mw = _MW([_mk("默忆\n[1条] \n在吗\n14:40\n")])
    out = listen_chat.scan_unread(mw, {}, record_skip=recorded.append)
    assert [m["content"] for m in out] == ["在吗"]
    assert "bubble_read_empty" in recorded


def test_group_cached_and_skipped(monkeypatch):
    """开窗判出群（标题带人数）→ 记 _KNOWN_GROUPS 不回；下轮发现层直接跳过不开窗。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["某客户群(3)"])
    last_preview = {"某客户群": "某客户群\n在吗\n14:40\n"}
    mw = _MW([_mk("某客户群\n[2条] \n在吗\n14:43\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert "某客户群" in listen_chat._KNOWN_GROUPS
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": pytest.fail("群不该再开窗"))
    assert listen_chat.scan_unread(mw, last_preview) == []


def test_open_budget_caps_per_round(monkeypatch):
    """每轮开窗预算 cap=3：4 个预览触发只开 3 个，第 4 个触发态保留下轮再处理。"""
    opened = []

    def _fake_open(mw, it, s, expect_content=""):
        opened.append(s)
        return True

    monkeypatch.setattr(listen_chat, "_open_chat", _fake_open)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧", "direction": "outgoing"}, {"text": "新", "direction": "incoming"}])
    last_preview = {f"客户{i}": f"客户{i}\n旧\n14:0{i}\n" for i in range(4)}
    mw = _MW([_mk(f"客户{i}\n新\n14:1{i}\n") for i in range(4)])
    out = listen_chat.scan_unread(mw, last_preview)
    assert len(opened) == 3 and len(out) == 3
    leftover = set(last_preview) - {m["sender"] for m in out}
    assert len(leftover) == 1  # 第4个未消费，保留触发态


def test_two_contacts_isolated(monkeypatch):
    """铁律：≥2 联系人互不串——各自锚点各自 trailing。"""
    calls = {}

    def _fake_open(mw, it, s, expect_content=""):
        calls["current"] = s
        return True

    def _fake_bubbles(mw):
        if calls["current"] == "客户A":
            return [{"text": "回A", "direction": "outgoing"},
                    {"text": "A的新消息", "direction": "incoming"}]
        return [{"text": "回B", "direction": "outgoing"},
                {"text": "B的新消息", "direction": "incoming"}]

    monkeypatch.setattr(listen_chat, "_open_chat", _fake_open)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", _fake_bubbles)
    mw = _MW([_mk("客户A\n[1条] \nA的新消息\n14:40\n"),
              _mk("客户B\n[1条] \nB的新消息\n14:41\n")])
    out = {m["sender"]: m["content"] for m in listen_chat.scan_unread(mw, {})}
    assert out == {"客户A": "A的新消息", "客户B": "B的新消息"}


# ── F1: 陈旧角标提交闸 _stale_badge_confirmed（纯函数）─────────────────────────

def test_stale_badge_confirmed_matches_last_outgoing():
    """预览显示的最新消息 == 我方最后一条 outgoing → 真陈旧角标，允许提交。"""
    bubbles = [{"text": "在吗", "direction": "incoming"},
               {"text": "您好99元", "direction": "outgoing"}]
    assert listen_chat._stale_badge_confirmed("您好99元", bubbles)


def test_stale_badge_confirmed_rejects_placeholder_and_no_outgoing():
    """预览是 [图片]/[语音]/空 或无 outgoing 气泡 → 不命中（绝不允许静默提交）。"""
    bubbles = [{"text": "您好99元", "direction": "outgoing"}]
    assert not listen_chat._stale_badge_confirmed("[图片]", bubbles)
    assert not listen_chat._stale_badge_confirmed("[语音]", bubbles)
    assert not listen_chat._stale_badge_confirmed("", bubbles)
    assert not listen_chat._stale_badge_confirmed(
        "在吗", [{"text": "在吗", "direction": "incoming"}])


def test_stale_badge_confirmed_truncated_preview():
    """会话列表预览截断长回复：_delivery_confirmed 同款 16 字前缀匹配也算命中。"""
    long_reply = "您好，这款产品的价格是99元，现在下单还有优惠活动哦"
    preview = long_reply[:20] + "..."
    assert listen_chat._stale_badge_confirmed(
        preview, [{"text": long_reply, "direction": "outgoing"}])


# ── F1: scan 层——非文本消息绝不被"陈旧角标提交"吞掉 ────────────────────────────

def test_image_message_not_swallowed_by_stale_commit(monkeypatch):
    """F1 主窟窿：客户发[图片] → 气泡区无对应 Text → trailing 空，但预览≠我方回复
    → 必须走回退单条路径 emit content="[图片]"，绝不当陈旧角标静默提交。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"}])
    mw = _MW([_mk("默忆\n[1条] \n[图片]\n14:43\n")])
    out = listen_chat.scan_unread(mw, {})
    assert [m["content"] for m in out] == ["[图片]"]


def test_true_stale_badge_commits_no_emit(monkeypatch):
    """真陈旧角标（预览=我方最后回复）→ 不 emit，提交 last_preview 消费触发防重复回。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
        {"text": "您好99元", "direction": "outgoing"}])
    lp = {}
    mw = _MW([_mk("默忆\n[1条] \n您好99元\n14:44\n")])
    assert listen_chat.scan_unread(mw, lp) == []
    assert lp["默忆"] == "默忆\n[1条] \n您好99元\n14:44\n"


def test_preview_trigger_image_keeps_trigger_no_commit(monkeypatch):
    """F1 同族（badge=0 预览触发）：客户新消息是[图片]（读不到气泡）且非陈旧
    → 不提交不 emit，触发态保留下轮重试（绝不静默消费）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"}])
    lp = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n[图片]\n14:43\n")])
    assert listen_chat.scan_unread(mw, lp) == []
    assert lp["默忆"] == "默忆\n在吗\n14:40\n"  # 未提交 → 下轮重试


# ── F2: 角标首见 seed last_preview——emit 失败后必可重试 ─────────────────────────

def test_badge_first_seen_seeds_preview_for_retry(monkeypatch):
    """F2：重启后 last_preview 空 + 角标会话 emit → 主循环草稿失败（不提交）→
    下轮角标已被开窗消费、name 去角标变化 → 必须靠 seed 的预览触发再次 emit，绝不永久丢。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧回复", "direction": "outgoing"},
        {"text": "在吗", "direction": "incoming"}])
    lp = {}
    out1 = listen_chat.scan_unread(_MW([_mk("默忆\n[1条] \n在吗\n14:40\n")]), lp)
    assert [m["content"] for m in out1] == ["在吗"]
    # 模拟主循环草稿失败：不调 _commit_reply_success → lp 不提交
    out2 = listen_chat.scan_unread(_MW([_mk("默忆\n在吗\n14:40\n")]), lp)
    assert [m["content"] for m in out2] == ["在吗"], "角标被消费后必须靠 seed 的预览触发重试"


# ── F3: _KNOWN_GROUPS 缓存必须先过标题归属验证 ─────────────────────────────────

def test_group_not_cached_when_title_mismatch(monkeypatch):
    """F3：selected 验证通过但面板还停在上一个群的异步瞬间 → 读到别人的"(N)"标题。
    标题归属验证不过 → 本轮不回（判群结果生效），但绝不写 _KNOWN_GROUPS（防真客户永久拉黑）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_chat_title_matches", lambda mw, s: False)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["别的群(5)"])
    lp = {"客户C": "客户C\n在吗\n14:40\n"}
    mw = _MW([_mk("客户C\n[1条] \n发下资料\n14:43\n")])
    assert listen_chat.scan_unread(mw, lp) == []
    assert "客户C" not in listen_chat._KNOWN_GROUPS


def test_group_cached_only_with_title_confirmed(monkeypatch):
    """F3 对照：标题归属验证通过（fixture 默认 True）→ 才允许写 _KNOWN_GROUPS。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["某客户群(3)"])
    mw = _MW([_mk("某客户群\n[2条] \n在吗\n14:43\n")])
    assert listen_chat.scan_unread(mw, {}) == []
    assert "某客户群" in listen_chat._KNOWN_GROUPS


# ── F4: should_open 谓词——黑名单/操作者会话连候选都不进 ────────────────────────

def test_should_open_gate_excludes_sender(monkeypatch):
    """F4：should_open 拦掉的 sender（黑名单/操作者本人）不开窗（保留其未读角标）、
    不 emit、不烧 SCAN_OPEN_BUDGET；其他 sender 正常。"""
    opened = []

    def _fake_open(mw, it, s, expect_content=""):
        opened.append(s)
        return True

    monkeypatch.setattr(listen_chat, "_open_chat", _fake_open)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧", "direction": "outgoing"}, {"text": "新", "direction": "incoming"}])
    mw = _MW([_mk("老板\n[3条] \n盯一下\n14:40\n"),
              _mk("客户D\n[1条] \n在吗\n14:41\n")])
    out = listen_chat.scan_unread(mw, {}, should_open=lambda s: s != "老板")
    assert opened == ["客户D"]
    assert [m["sender"] for m in out] == ["客户D"]


def test_should_open_default_none_allows_all(monkeypatch):
    """F4 对照：should_open 缺省 None → 全放行（向后兼容，主循环 Task 5 再接线）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧", "direction": "outgoing"}, {"text": "新", "direction": "incoming"}])
    mw = _MW([_mk("老板\n[1条] \n盯一下\n14:40\n")])
    out = listen_chat.scan_unread(mw, {})
    assert [m["sender"] for m in out] == ["老板"]
