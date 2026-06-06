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
import time

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


# ─────────────────────────────────────────────────────────────────────────────
# D. replied TTL：过期条目自动清除（根因 D — replied.json 永不过期导致消息被永久跳过）
#
# 背景：2026-06-06 xian-pc 发现 default 忆 30+ 分钟没有收到 AI 回复。
#   根因：replied.json 里的 (sender, content) 条目从未过期。
#   一旦默忆的某条消息被回复过，同内容的后续消息被永久 skip(replied)。
# 修法：
#   - 文件格式改为 [sender, content, timestamp]（3 元素）
#   - REPLIED_TTL 常量（默认 24h）控制过期时间
#   - _load_replied 过滤超 TTL 的条目
#   - _save_replied 写入时带时间戳（从 _replied_ts 取）
#   - 主循环记录 _replied_ts[key] = now，并每小时清理内存中过期条目
# ─────────────────────────────────────────────────────────────────────────────

def test_replied_ttl_constant_exists():
    """REPLIED_TTL 常量必须存在，单位秒，值 >= 3600（至少 1 小时）。"""
    assert hasattr(listen_chat, "REPLIED_TTL"), (
        "缺少 REPLIED_TTL 常量 — replied.json 过期清除功能未实现"
    )
    assert listen_chat.REPLIED_TTL >= 3600, (
        f"REPLIED_TTL={listen_chat.REPLIED_TTL} 太短，至少应为 3600s（1h）"
    )


def test_load_replied_filters_expired_entries(tmp_path, monkeypatch):
    """_load_replied 必须过滤掉超过 REPLIED_TTL 的条目（新格式 3 元素）。

    永久不过期的根因：replied.json 只存 [sender, content]，没有时间戳，
    _load_replied 全部加载，同内容消息永久被跳过。
    """
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    now = time.time()
    ttl = listen_chat.REPLIED_TTL

    data = [
        ["新鲜用户", "你好", now - 100],        # 新鲜，应保留
        ["过期用户", "你好", now - ttl - 1],     # 过期，应清除
        ["另一过期", "在吗", now - ttl * 2],     # 超长过期，应清除
    ]
    with open(test_file, "w", encoding="utf-8") as f:
        json.dump(data, f)

    loaded = listen_chat._load_replied()

    assert ("新鲜用户", "你好") in loaded, "新鲜条目被错误清除"
    assert ("过期用户", "你好") not in loaded, "过期条目未被清除 — TTL 未生效"
    assert ("另一过期", "在吗") not in loaded, "超长过期条目未被清除 — TTL 未生效"


def test_load_replied_supports_old_format(tmp_path, monkeypatch):
    """旧格式（2 元素列表，无时间戳）必须向后兼容：_load_replied 仍能加载。"""
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    data = [["张三", "你好"], ["李四", "在吗"]]
    with open(test_file, "w", encoding="utf-8") as f:
        json.dump(data, f)

    loaded = listen_chat._load_replied()
    assert ("张三", "你好") in loaded, "旧格式条目未被加载（向后兼容破坏）"
    assert ("李四", "在吗") in loaded, "旧格式条目未被加载（向后兼容破坏）"


def test_save_replied_stores_timestamps(tmp_path, monkeypatch):
    """_save_replied 保存后每个条目必须包含时间戳（3 元素 [sender, content, ts]）。"""
    test_file = str(tmp_path / "zj-replied.json")
    monkeypatch.setattr(listen_chat, "_REPLIED_FILE", test_file)

    ts_now = time.time()
    monkeypatch.setattr(listen_chat, "_replied_ts", {("王五", "你好"): ts_now})

    listen_chat._save_replied({("王五", "你好")})

    with open(test_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert len(data) == 1, "保存的条目数量不对"
    assert len(data[0]) == 3, f"新格式必须是 [sender, content, timestamp]，实际是 {data[0]}"
    assert data[0][0] == "王五"
    assert data[0][1] == "你好"
    assert isinstance(data[0][2], float), "时间戳必须是 float"
    assert abs(data[0][2] - ts_now) < 1.0, "时间戳值与预期不符"


def test_replied_ts_module_level_dict_exists():
    """_replied_ts 模块级 dict 必须存在（供 _save_replied 读取时间戳）。"""
    assert hasattr(listen_chat, "_replied_ts"), (
        "缺少 _replied_ts 模块级 dict — _save_replied 无法获取时间戳"
    )
    assert isinstance(listen_chat._replied_ts, dict), "_replied_ts 必须是 dict"
