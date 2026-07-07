# -*- coding: utf-8 -*-
"""锚点气泡扫描纯函数守卫：系统气泡剔除 + trailing incoming 切分。

守卫契约（proven-to-fire）：把 strip_system_bubbles 改成不剔除时间戳，
test_timestamp_does_not_hijack_anchor 必红（时间戳被判 outgoing 劫持锚点，
把之前的 incoming 全切掉 → 复现漏回）。
顶层零 pywinauto，纯 Fake 注入。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def _b(text, direction):
    return {"text": text, "direction": direction}


# ── _is_system_bubble ────────────────────────────────────────────────────────

def test_pure_time_is_system():
    for t in ["14:32", "9:05", "昨天 14:32", "前天 08:00", "星期二 09:05",
              "周三 21:00", "2026年7月1日 14:32", "7月1日 14:32",
              "下午 2:32", "昨天 下午2:32", "上午 9:05"]:
        assert listen_chat._is_system_bubble(t), t


def test_recall_and_pat_are_system():
    for t in ['"客户A" 撤回了一条消息', "你撤回了一条消息", "客户A拍了拍你", "以下是新消息"]:
        assert listen_chat._is_system_bubble(t), t


def test_normal_messages_not_system():
    for t in ["在吗", "什么价格", "价格 14:32 前有效", "我 7月1日 到货可以吗", "[图片]",
              "我下午 2:32 到"]:
        assert not listen_chat._is_system_bubble(t), t


def test_strip_system_bubbles_keeps_order():
    bubbles = [_b("在吗", "incoming"), _b("14:32", "outgoing"), _b("发下资料", "incoming")]
    assert listen_chat.strip_system_bubbles(bubbles) == [
        _b("在吗", "incoming"), _b("发下资料", "incoming")]


# ── split_trailing_incoming ──────────────────────────────────────────────────

def test_main_bug_five_messages_three_leaked():
    """主 bug 复现（2026-07-02 服务端证据）：连发5条、回1条后又来3条，
    角标已清、preview 只见最后一条——旧机制全漏，新机制必须取出 trailing 3 条。"""
    bubbles = [
        _b("在吗", "incoming"),
        _b("什么价格", "incoming"),
        _b("您好，价格是99元", "outgoing"),
        _b("我想买好产品", "incoming"),
        _b("发下资料", "incoming"),
        _b("你们公司信息", "incoming"),
    ]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == [
        "我想买好产品", "发下资料", "你们公司信息"]


def test_timestamp_does_not_hijack_anchor():
    """时间戳夹在客户连发中间：剔除后锚点仍是真 outgoing，trailing 完整。"""
    bubbles = listen_chat.strip_system_bubbles([
        _b("您好，价格是99元", "outgoing"),
        _b("我想买好产品", "incoming"),
        _b("14:32", "outgoing"),  # 居中时间戳被几何判 outgoing
        _b("发下资料", "incoming"),
    ])
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == [
        "我想买好产品", "发下资料"]


def test_last_outgoing_no_trailing():
    """我方/人工回复是最后一条 → trailing 空 → 不回（人工优先天然正确）。"""
    bubbles = [_b("在吗", "incoming"), _b("好的收到", "outgoing")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == []


def test_no_outgoing_no_badge_not_reply():
    """从未回过 + 无角标（陈年会话被预览扰动误触发）→ 绝不翻旧账。"""
    bubbles = [_b("半年前的消息", "incoming"), _b("没人理我", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == []


def test_no_outgoing_with_badge_takes_min():
    """从未回过 + 角标 N=2 → 只取最后 2 条 incoming（min(N, 可见)）。"""
    bubbles = [_b("旧消息", "incoming"), _b("新1", "incoming"), _b("新2", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=2) == ["新1", "新2"]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=9) == ["旧消息", "新1", "新2"]


def test_placeholder_bubbles_counted():
    """非文本消息占位符计入 incoming，绝不透明化（纯图片批也触发回复）。"""
    bubbles = [_b("好的", "outgoing"), _b("[图片]", "incoming"), _b("[语音]", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == ["[图片]", "[语音]"]


# -- _commit_reply_success ---------------------------------------------------

def test_commit_reply_success_updates_preview():
    """DELIVERED 后 last_preview 更新为 _preview_name（触发消费，下轮不重触发）。"""
    listen_chat._ANCHOR_STALL.clear()
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    msg = {"sender": "默忆", "content": "在吗",
           "_preview_name": "默忆\n在吗\n14:43\n", "_item": None}
    listen_chat._commit_reply_success(msg, last_preview)
    assert last_preview["默忆"] == "默忆\n在吗\n14:43\n"


def test_commit_reply_success_resets_stall():
    """DELIVERED 后 _ANCHOR_STALL[sender] 归零。"""
    listen_chat._ANCHOR_STALL["默忆"] = 2
    last_preview = {}
    msg = {"sender": "默忆", "content": "x",
           "_preview_name": "默忆\nx\n14:44\n", "_item": None}
    listen_chat._commit_reply_success(msg, last_preview)
    assert listen_chat._ANCHOR_STALL.get("默忆", 0) == 0


def test_commit_reply_success_missing_preview_name_safe():
    """_preview_name 缺失不抛（兼容回退路径 content-only 的 msg）。"""
    listen_chat._ANCHOR_STALL.clear()
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    msg = {"sender": "默忆", "content": "在吗", "_item": None}
    listen_chat._commit_reply_success(msg, last_preview)
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_image_fallback_commit_does_not_poison_anchor_and_lose_next_text():
    """P0 生产 bug 复现（issue 4024c90b，2026-07-07 客户实测）：
    客户发图片（不产生 bubble）后紧跟一句文字问题（在 bot 回完图片兜底话术之前就到达），
    bot 对图片走 F1 回退保底路径 emit（用预览 content="[图片]"，scan_unread ~1029行），
    DELIVERED 后 _commit_reply_success 若把 _REPLY_ANCHOR 设成这个"[图片]"幻影文本——
    它在真实 bubbles 里永远匹配不到（图片从不产生 bubble 条目）——下一轮 split_trailing_incoming
    锚点回退成"最后一条 outgoing"（bot 自己刚发的兜底回复），而客户那句问题在时序上正好排在
    这条 outgoing 之前，于是被判定为"锚点之前的旧消息"永久丢弃、再也不回复。

    正确行为：非文本回退路径的 commit 不能用不可复现的预览文本毒化 _REPLY_ANCHOR；
    下一轮 split_trailing_incoming 必须仍能捞到客户那句"这个多少钱"。
    """
    listen_chat._REPLY_ANCHOR.clear()

    # 图片轮：F1 回退保底 emit（scan_unread 里 c["content"]="[图片]"，_last_incoming 同源）
    image_round_msg = {
        "sender": "默忆", "content": "[图片]",
        "_preview_name": "默忆\n[1条] \n[图片]\n11:00\n",
        "_last_incoming": "[图片]", "_item": None,
    }
    listen_chat._commit_reply_success(image_round_msg, last_preview={})

    # 客户实际聊天面板时序（旧→新）：老回复 -> 客户紧跟图片发的新问题 -> bot 对图片的兜底回复
    bubbles = [
        {"text": "旧回复内容", "direction": "outgoing"},
        {"text": "这个多少钱", "direction": "incoming"},
        {"text": "能看，直接发内容或者截图过来", "direction": "outgoing"},
    ]
    tail = listen_chat.split_trailing_incoming(
        bubbles, badge_n=1, replied_anchor=listen_chat._REPLY_ANCHOR.get("默忆"))
    assert tail == ["这个多少钱"], (
        f"图片后紧跟的客户消息不应被永久丢弃，实际 tail={tail!r}"
    )
