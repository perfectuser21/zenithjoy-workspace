"""
Regression tests — 防重复回复三连修（PR #648 根因）。

背景：2026-06-06 xian-rog 发现同一消息被 AI 回复两次。根因链：
  1. 微信 ListItem preview 截断（e.g., "您好，在的..." ≠ 实际发送的 174 字回复）
  2. last_content[sender] 存的是完整回复，但下一轮 scan_unread 读到截断 preview
     → 内容"变化" → Path 2 再次触发 → 第二次 DeepSeek 调用 → 第二条回复
  3. replied set 只在内存，进程重启后失忆 → 重启后对同一消息再发一遍

修法三件套：
  A. per-sender 30s 冷却（sender_reply_cooldown）—— 直接挡住第二次触发
  B. 成功后更新 last_content[sender] = reply（防 Path2 截断误判）
  C. replied 集合 JSON 持久化（重启不失忆）

本文件是这三件套的永久 regression test，禁止删除。
任何一个 test 变红 = 对应防护被破坏，CI 拦截。
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WECHAT_RPA_DIR = os.path.abspath(os.path.join(HERE, ".."))
LISTEN_CHAT_PATH = os.path.join(WECHAT_RPA_DIR, "listen_chat.py")
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)

import listen_chat  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# A. replied 持久化：重启后不重发（根因 C 的防护）
# ─────────────────────────────────────────────────────────────────────────────

def test_replied_persistence_round_trip(tmp_path, monkeypatch):
    """_save_replied 写 JSON → _load_replied 重读，集合完全恢复。

    模拟场景：watchdog 重启 listen_chat.py 之后，之前已回复的消息不应再被触发。
    如果 _REPLIED_FILE / _load_replied / _save_replied 任意一环坏掉，本测试即红。
    """
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    original: set = {("张三", "你好"), ("李四", "在吗"), ("王五", "哈哈哈哈哈哈哈哈哈哈")}
    listen_chat._save_replied(original)

    # 重新加载（模拟进程重启）
    loaded = listen_chat._load_replied()

    assert loaded == original, f"重启后 replied 集合不一致: {loaded} != {original}"


def test_replied_persistence_survives_unicode(tmp_path, monkeypatch):
    """replied 集合含 emoji / 特殊 Unicode 也能正确序列化、反序列化。"""
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    original: set = {("😊客户A", "你好😊"), ("日本語テスト", "こんにちは")}
    listen_chat._save_replied(original)
    loaded = listen_chat._load_replied()

    assert loaded == original


def test_load_replied_returns_empty_set_on_missing_file(tmp_path, monkeypatch):
    """文件不存在（首次安装）→ _load_replied 返回空集合，不抛异常。"""
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", str(tmp_path / "nonexistent.json"))
    result = listen_chat._load_replied()
    assert result == set()


def test_save_replied_idempotent(tmp_path, monkeypatch):
    """连续 _save_replied 两次，最终文件内容以第二次为准（不叠加）。"""
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    listen_chat._save_replied({("A", "1"), ("B", "2")})
    listen_chat._save_replied({("C", "3")})

    loaded = listen_chat._load_replied()
    assert loaded == {("C", "3")}


# ─────────────────────────────────────────────────────────────────────────────
# B. per-sender 30s 冷却（根因 A 的防护）
# ─────────────────────────────────────────────────────────────────────────────

def test_sender_cooldown_constant_is_30s():
    """SENDER_COOLDOWN 必须 >= 30 秒。

    10s 冷却不够（已有案例：第二次触发在 19s）。降到 10s 以下本测试即红。
    """
    assert listen_chat.SENDER_COOLDOWN >= 30.0, (
        f"SENDER_COOLDOWN={listen_chat.SENDER_COOLDOWN} 太短，"
        f"xian-rog 实测第二次触发在 19s，需 >= 30s"
    )


def test_sender_cooldown_check_exists_in_source():
    """run_real_listen 主循环必须有 sender_reply_cooldown 冷却检查。

    如果有人删了这行，第一条消息回复完 30s 内的第二条消息又会被 AI 处理，
    导致重复回复。本测试检查关键代码行存在。
    """
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    assert "sender_reply_cooldown" in src, "缺少 sender_reply_cooldown 变量"
    assert "SENDER_COOLDOWN" in src, "缺少 SENDER_COOLDOWN 常量"
    # 确认是在做 < SENDER_COOLDOWN 的冷却判断，不只是定义
    assert "sender_reply_cooldown.get" in src, (
        "缺少 sender_reply_cooldown.get(...) 检查 — 冷却逻辑可能已被删除"
    )


# ─────────────────────────────────────────────────────────────────────────────
# C. last_content 更新防 Path2 误触发（根因 B 的防护）
# ─────────────────────────────────────────────────────────────────────────────

def test_last_content_updated_to_reply_after_successful_send():
    """成功回复后必须把 last_content[sender] 更新为实际发送的 reply 文本。

    根因：微信 ListItem 的 preview 是截断版本（e.g., "您好，在..." 而非完整 174 字回复）。
    如果 last_content 存的是完整 reply，下次 scan_unread 读到截断 preview ≠ last_content
    → 误判为"内容变化" → Path 2 再次触发 → 第二个 DeepSeek 调用 → 第二条回复。

    正确做法：ok=True 之后 last_content[sender] = reply（不是 content）。
    本测试检查这行代码存在于源文件中。
    """
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    # 这行代码更新 last_content 为 reply（不是 content），是防双发的关键
    assert 'last_content[m["sender"]] = reply' in src, (
        "缺少 last_content[m[\"sender\"]] = reply 赋值 — "
        "Path2 截断误触发根因未被修复：下次 scan_unread 读到截断 preview "
        "!= 完整 reply → 误判内容变化 → 第二次 AI 调用 → 重复回复"
    )

    # 并且这个赋值必须在 ok=True 之后（防止失败时也更新）
    ok_idx = src.rfind("if ok:")
    assign_idx = src.rfind('last_content[m["sender"]] = reply')
    assert assign_idx > ok_idx, (
        "last_content 赋值必须在 if ok: 成功分支内（在 ok_idx 之后）"
    )
