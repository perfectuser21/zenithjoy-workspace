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
# ─────────────────────────────────────────────────────────────────────────────
# C. last_content 清除防自回复风暴（Bug Fix v1.0.16）
#
# 背景：旧做法 last_content[sender]=reply 在 2026-06-10 引发自回复风暴：
#   AI 回复存入 last_content → 下次 scan 读截断 preview → Path2 误判变化
#   → 再调 DeepSeek → 再发一条 → 风暴每 30s 一条持续
# 修法：ok=True 后 last_content.pop(sender, None)
#   下次扫: prev=None → "首次见"不触发 → 风暴终止
# ─────────────────────────────────────────────────────────────────────────────

def test_last_content_cleared_after_successful_send():
    """成功回复后必须 pop(sender) 而不是存 reply 完整文本。

    last_content[sender]=reply 是自回复风暴根因（2026-06-10 xian-pc 复现）。
    """
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    assert 'last_content.pop(m["sender"], None)' in src, (
        "缺少 last_content.pop() — 成功回复后仍存 reply 全文，"
        "Path2 截断误判 → 自回复风暴"
    )
    assert 'last_content[m["sender"]] = reply' not in src, (
        "仍含 last_content[...] = reply — 此行是自回复风暴根因，必须改为 pop"
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
    """REPLIED_TTL 必须在合理范围：>= 60s（防双发）且 <= 300s（防同内容永久跳过）。

    24h 太长：同一客户 24h 内发相同内容第二次，永远收不到回复（已复现 bug）。
    轮询间隔 60s，2 个周期 = 120s 已足够防双发。上限 300s（5min）。
    """
    assert hasattr(listen_chat, "REPLIED_TTL"), (
        "缺少 REPLIED_TTL 常量 — replied.json 过期清除功能未实现"
    )
    assert listen_chat.REPLIED_TTL >= 60, (
        f"REPLIED_TTL={listen_chat.REPLIED_TTL} 太短，至少 60s 防止两个轮询周期内重复回复"
    )
    assert listen_chat.REPLIED_TTL <= 300, (
        f"REPLIED_TTL={listen_chat.REPLIED_TTL} 太长（> 300s）"
        f" — 同内容消息在窗口内永久被跳过（已复现：默忆 15:47→16:06 同内容无回复）"
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


# ─────────────────────────────────────────────────────────────────────────────
# E. 心跳 null 字段：post_heartbeat() 不得发送 null agent_id / wechat_id
#
# 背景：2026-06-06 发现 Dashboard 显示"未找到微信"而非"已登录"。
#   根因：post_heartbeat() 构造 body 时无条件写入 {"agent_id": None, ...}，
#   Python None → JSON null；API 端 Zod z.string().optional() 不接受 null
#   → safeParse 失败 → data={} → recordHeartbeat 无 diag → Dashboard 无法显示状态。
# 修法：body 只在非 None 时加 agent_id / wechat_id 字段（omit-if-None 模式）。
# ─────────────────────────────────────────────────────────────────────────────

def test_heartbeat_body_omits_null_agent_id(monkeypatch):
    """agent_id=None 时 POST body 不得包含 agent_id 键。

    包含 null 会让 API 端 Zod z.string().optional() 校验失败，
    导致 diag 不存入内存，Dashboard 永远显示"未找到微信"。
    """
    captured: list = []

    def fake_post(url, body, **kwargs):
        captured.append(dict(body))
        return ({"ok": True}, None)

    monkeypatch.setattr(listen_chat, "_post_with_retry", fake_post)

    listen_chat.post_heartbeat(
        "http://test-middleware",
        agent_id=None,
        wechat_id=None,
        diag={"main_window_found": True},
    )

    assert len(captured) == 1, "post_heartbeat 应调用一次 _post_with_retry"
    body = captured[0]
    assert "agent_id" not in body, (
        f"agent_id=None 时 body 不应含 agent_id 键（JSON null 让 Zod 失败），"
        f"实际 body keys: {list(body.keys())}"
    )
    assert "wechat_id" not in body, (
        f"wechat_id=None 时 body 不应含 wechat_id 键，"
        f"实际 body keys: {list(body.keys())}"
    )
    assert body.get("diag", {}).get("main_window_found") is True, "diag 应原样传入"


def test_heartbeat_body_includes_agent_id_when_set(monkeypatch):
    """agent_id 非 None 时 body 必须包含 agent_id 键且值正确。"""
    captured: list = []

    def fake_post(url, body, **kwargs):
        captured.append(dict(body))
        return ({"ok": True}, None)

    monkeypatch.setattr(listen_chat, "_post_with_retry", fake_post)

    listen_chat.post_heartbeat(
        "http://test-middleware",
        agent_id="xian-pc",
        diag={"main_window_found": True},
    )

    assert len(captured) == 1
    body = captured[0]
    assert body.get("agent_id") == "xian-pc", (
        f"agent_id='xian-pc' 时 body 应含 agent_id='xian-pc'，"
        f"实际: {body.get('agent_id')}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# F. _find_chat_input 搜索栏误判
#
# 根因：回退逻辑按面积选最大 Edit，搜索栏（顶部 ~5%）宽度大、
#   面积可超过聊天输入框，SetValue 打到搜索栏而非聊天输入框。
# 修法：过滤掉窗口上 40% 区域内的 Edit（top < window.top + height*0.4）。
# ─────────────────────────────────────────────────────────────────────────────

class _Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _FakeEdit:
    def __init__(self, aid, rect):
        class _EI:
            def __init__(self, aid):
                self.automation_id = aid
                self.name = ""
        self.element_info = _EI(aid)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _FakeMW:
    def __init__(self, win_rect, edits):
        self._rect = win_rect
        self._edits = edits

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        return self._edits


def test_find_chat_input_excludes_search_bar():
    """搜索栏（窗口上方）面积比聊天输入框大时，_find_chat_input 应返回聊天输入框。

    真实 bug 场景：搜索栏横跨整个联系人栏宽度（1200×40=48000），
    聊天输入框在右侧底部较窄（300×30=9000），旧逻辑按面积返回搜索栏。
    """
    win = _Rect(0, 0, 1200, 900)
    # 搜索栏：顶部横跨全宽，面积 = 1200×40 = 48000（大）
    search_bar = _FakeEdit("", _Rect(0, 0, 1200, 40))
    # 聊天输入框：底部右侧较窄，面积 = 300×30 = 9000（小）
    chat_input = _FakeEdit("", _Rect(300, 750, 600, 780))
    mw = _FakeMW(win, [search_bar, chat_input])

    result = listen_chat._find_chat_input(mw)
    assert result is chat_input, (
        "_find_chat_input 应返回聊天输入框（底部），而非搜索栏（顶部）"
    )


def test_find_chat_input_aborts_when_filter_removes_all():
    """所有 Edit 都在上半区（下半区无聊天输入框）→ 返回 None 中止，绝不回退到顶部搜索框。

    修正 2026-07-02：旧行为"退化到全局最大 Edit"= 顶部搜索框 → _uia_send 的 SetValue
    把回复写进搜索栏白发（用户症状"回复写进搜索框"）。详见 test_find_chat_input_no_search_fallback.py。
    """
    win = _Rect(0, 0, 1200, 900)
    edit_a = _FakeEdit("", _Rect(0, 10, 500, 50))   # 上半区
    edit_b = _FakeEdit("", _Rect(0, 60, 800, 100))  # 上半区（更大=搜索栏类）
    mw = _FakeMW(win, [edit_a, edit_b])

    result = listen_chat._find_chat_input(mw)
    assert result is None, (
        "下半区无聊天输入框时必须中止（None），绝不回退到顶部最大 Edit（搜索框）"
    )


# ─────────────────────────────────────────────────────────────────────────────
# G. replied 清理间隔不能是 3600s（replied 死锁 Bug Fix v1.0.16）
#
# 背景：REPLIED_TTL=120s，但内存清理 interval=3600s
#   → TTL 到期的条目最长被封锁 1 小时 + _skip_logged 静默无日志
#   → 于瑾等客户消息长达 1h 无回复（2026-06-10 xian-pc 复现）
# 修法：清理 interval 改为 REPLIED_TTL（120s），每个 TTL 周期扫一次
# ─────────────────────────────────────────────────────────────────────────────

def test_replied_cleanup_interval_not_hourly():
    """replied 内存清理间隔不能是 3600s（应 <= REPLIED_TTL）。

    3600s 间隔 + TTL=120s → 条目过期后最长 3600s 仍在内存 → 死锁无日志。
    """
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for i, line in enumerate(lines):
        if "last_replied_purge" in line and ">=" in line:
            stripped = line.strip()
            assert "3600" not in stripped, (
                f"第 {i+1} 行: replied 清理间隔仍为 3600s — "
                f"TTL={listen_chat.REPLIED_TTL}s 的条目过期后最长卡 3600s"
                f"\n    {stripped}"
            )
            break


# ─────────────────────────────────────────────────────────────────────────────
# H. 主循环不得有 range(2) 重试（双发 Bug Fix v1.0.16）
#
# 背景：_verify_sent 离屏模式下 Qt 气泡不刷新 → 返回 False（假阴性）
#   → for _attempt in range(2) 触发重试 → 第二次 SetValue+Enter → 第二条消息发出
# 修法：去掉 range(2) 外层重试；只调用一次 reply_in_chat
# ─────────────────────────────────────────────────────────────────────────────

def test_no_outer_retry_loop_in_reply_dispatch():
    """主循环 reply 分发不得有 range(2) 重试逻辑。

    假阴性返回 False 触发重试 → 第二次 SetValue+Enter → 重复发送（2026-06-10 复现）。
    """
    with open(LISTEN_CHAT_PATH, "r", encoding="utf-8") as f:
        src = f.read()

    assert "for _attempt in range(2)" not in src, (
        "主循环仍有 range(2) 重试 — _verify_sent 离屏假阴性触发重试 → 双发"
    )
