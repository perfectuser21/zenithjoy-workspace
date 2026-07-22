# test_overlay_window.py — overlay_window 逻辑层单测（闸门：碰 wechat-rpa 必带 tests/*.py）
#
# 覆盖第二刀 overlay_window.py 的纯逻辑面（非 Windows CI 可跑）：
#   - PositionLoop.get_visibility 判据表退化路径（hwnd None → hide）
#   - PositionLoop.load_state 损坏 JSON → 默认值 + .bak 备份（BEHAVIOR-3）
#   - PositionLoop.save_state / load_state 往返
#   - EventTailConsumer：坏行跳过 / event_id 幂等去重 / heartbeat 超时降级 /
#     heartbeat 新鲜时正常返回（BEHAVIOR-4/8）
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from overlay.overlay_window import EventTailConsumer, PositionLoop  # noqa: E402


def test_get_visibility_none_hwnd_hides(tmp_path):
    loop = PositionLoop(str(tmp_path))
    assert loop.get_visibility(None) == "hide"


def test_load_state_corrupt_json_returns_default_and_backs_up(tmp_path):
    loop = PositionLoop(str(tmp_path))
    state_path = os.path.join(str(tmp_path), "overlay-state.json")
    with open(state_path, "w", encoding="utf-8") as f:
        f.write("{broken json!!")
    state = loop.load_state()
    assert state == PositionLoop.DEFAULT_STATE
    assert os.path.exists(state_path + ".bak")


def test_save_then_load_state_roundtrip(tmp_path):
    loop = PositionLoop(str(tmp_path))
    loop.save_state({"user_closed": True, "x": 10, "y": 20})
    state = loop.load_state()
    assert state["user_closed"] is True
    assert state["x"] == 10 and state["y"] == 20


def _write_events(path, events):
    with open(path, "w", encoding="utf-8") as f:
        for ev in events:
            f.write((ev if isinstance(ev, str) else json.dumps(ev, ensure_ascii=False)) + "\n")


def test_tail_consumer_skips_bad_lines_and_dedups(tmp_path):
    consumer = EventTailConsumer(str(tmp_path))
    now = time.time()
    _write_events(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": now, "event_id": "h-1"},
        "{{{ 坏行 not json",
        {"type": "reply_sent", "event_id": "e-1", "contact": "张三"},
        {"type": "reply_sent", "event_id": "e-1", "contact": "张三"},  # 重复
    ])
    events = consumer.get_events()
    ids = [e.get("event_id") for e in events]
    assert ids.count("e-1") == 1          # 幂等去重
    assert all(e.get("type") != "degraded" for e in events)  # 心跳新鲜不降级
    # 二次消费：同一 event_id 不再返回
    _write_events(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": time.time(), "event_id": "h-2"},
        {"type": "reply_sent", "event_id": "e-1", "contact": "张三"},
    ])
    second = consumer.get_events()
    assert all(e.get("event_id") != "e-1" for e in second)


def test_tail_consumer_stale_heartbeat_degrades(tmp_path):
    """心跳过期 → degraded 事件必须出现（供浮窗顶部状态展示"休息中"），
    但**不能吞掉同批真实事件**（2026-07-16 真机回归：画像卡永远显示不出内容，
    根因是这里曾经 `return [DEGRADED_EVENT]` 直接短路，真实 reply_sent 被整批丢弃，
    switch_customer 永远不会被下游调用）。
    """
    consumer = EventTailConsumer(str(tmp_path))
    stale_ts = time.time() - 3600  # 1 小时前
    _write_events(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": stale_ts, "event_id": "h-old"},
        {"type": "reply_sent", "event_id": "e-9", "contact": "李四"},
    ])
    events = consumer.get_events()
    types = [e["type"] for e in events]
    assert "degraded" in types, "心跳过期必须仍然展示 degraded 状态"
    assert "reply_sent" in types, (
        "心跳过期不能吞掉同批真实事件——真机上 heartbeat 类型事件从未被写入过 "
        "events.jsonl，此条件永远成立，真实事件因此被永久丢弃"
    )
    reply_events = [e for e in events if e["type"] == "reply_sent"]
    assert reply_events[0]["contact"] == "李四"


def test_tail_consumer_never_seen_heartbeat_still_returns_real_events(tmp_path):
    """★核心回归点：events.jsonl 里从头到尾都没有 heartbeat 类型事件（真机现状——
    listen_chat.py 全文件从未写过 heartbeat 事件）→ `_last_heartbeat_ts` 永远是
    None → 旧逻辑永远判定 degraded 并短路返回，真实 contact 事件永远传不到
    switch_customer。修复后必须仍能拿到真实事件，画像卡才有数据可用。
    """
    consumer = EventTailConsumer(str(tmp_path))
    _write_events(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "reply_sent", "event_id": "e-1", "contact": "小美同学"},
    ])
    events = consumer.get_events()
    contacts = [e.get("contact") for e in events if e.get("type") == "reply_sent"]
    assert "小美同学" in contacts, (
        "真机现状（从无 heartbeat 事件）下，真实事件必须仍能被消费到——"
        "这是画像卡永远空白的根本 bug"
    )


def test_tail_consumer_missing_file_degrades_not_crash(tmp_path):
    consumer = EventTailConsumer(str(tmp_path))
    events = consumer.get_events()
    assert events == [EventTailConsumer.DEGRADED_EVENT]


# ─── Bug ①回归：_find_wechat_hwnd 必须用 EnumWindows，支持微信 4.x Qt 类名 ──────────

def test_detect_wechat_hwnd_rejects_old_class(tmp_path):
    """Bug ①回归：旧类名 WeChatMainWndForPC 不再命中（3.x 类名，4.x 消失了）。"""
    loop = PositionLoop(str(tmp_path))
    result = loop._detect_wechat_hwnd_from_list([
        (1001, "WeChatMainWndForPC", "微信"),
    ])
    assert result is None


def test_detect_wechat_hwnd_finds_mmui(tmp_path):
    """Bug ①回归：mmui::MainWindow 可命中（4.1.8.x 主窗口标准类名）。"""
    loop = PositionLoop(str(tmp_path))
    result = loop._detect_wechat_hwnd_from_list([
        (1001, "SomeOtherWindow", "其他"),
        (1002, "mmui::MainWindow", "微信"),
    ])
    assert result == 1002


def test_detect_wechat_hwnd_finds_qt_outer_frame(tmp_path):
    """Bug ①回归：Qt51514QWindowIcon + title=微信 可命中（4.1.10+ 外框）。"""
    loop = PositionLoop(str(tmp_path))
    result = loop._detect_wechat_hwnd_from_list([
        (2001, "Qt51514QWindowIcon", "微信"),
    ])
    assert result == 2001


def test_detect_wechat_hwnd_skips_qt_non_wechat_title(tmp_path):
    """Bug ①回归：Qt*QWindowIcon 但 title 不是微信，不命中（避免误判其他 Qt 应用）。"""
    loop = PositionLoop(str(tmp_path))
    result = loop._detect_wechat_hwnd_from_list([
        (3001, "Qt51514QWindowIcon", "其他应用"),
    ])
    assert result is None


# ─── Bug ②回归：create_window 必须传 js_api=self ──────────────────────────────────

def test_create_window_passes_js_api(tmp_path, monkeypatch):
    """Bug ②回归：js_api=self 必须传给 create_window，否则 JS 侧 pywebview.api 为 undefined。"""
    import sys
    import unittest.mock as mock

    captured = {}

    fake_webview = mock.MagicMock()
    fake_webview.create_window.side_effect = lambda *a, **kw: (
        captured.update(kw) or mock.MagicMock()
    )

    monkeypatch.setitem(sys.modules, "webview", fake_webview)

    from overlay.overlay_window import OverlayApp
    app = OverlayApp(state_dir=str(tmp_path))
    app.run()

    assert "js_api" in captured, "create_window must be called with js_api= (Bug ②修复验证)"
    assert captured["js_api"] is app


# ─── Bug ⑤回归：_dock_to + _calc_dock_position 必须存在 ─────────────────────────

def test_position_loop_has_dock_to_method(tmp_path):
    """Bug ⑤回归：PositionLoop 必须有 _dock_to 方法（贴靠跟随）。"""
    loop = PositionLoop(str(tmp_path))
    assert hasattr(loop, "_dock_to"), "PositionLoop 缺少 _dock_to 方法"


def test_calc_dock_right_of_wechat_enough_space(tmp_path):
    """Bug ⑤回归：微信右缘外侧有空间时，贴右缘外侧（x=wechat_right）。"""
    loop = PositionLoop(str(tmp_path))
    # 微信 left=100 top=50 right=900 bottom=750，屏幕 1920 宽，可容纳 300px 面板
    x, y, w, h = loop._calc_dock_position(
        wechat_rect=(100, 50, 900, 750),
        screen_width=1920,
        overlay_width=300,
    )
    assert x == 900, f"期望 x=900（右缘外侧），实际 x={x}"
    assert y == 60, f"期望 y=top+10=60，实际 y={y}"
    assert w == 300
    assert h == max(380, min(980, 700 - 20))  # clamp(680, 380, 980) = 680


def test_calc_dock_fallback_inside_when_no_space(tmp_path):
    """Bug ⑤回归：右缘外侧放不下时，嵌内缘（x=wechat_right-314）。"""
    loop = PositionLoop(str(tmp_path))
    # 微信 right=1700，屏幕 1920，1700+300=2000>1920，放不下
    x, y, w, h = loop._calc_dock_position(
        wechat_rect=(100, 50, 1700, 750),
        screen_width=1920,
        overlay_width=300,
    )
    assert x == 1700 - 314, f"期望 x=1386（内缘 right-314），实际 x={x}"


# ─── BEHAVIOR-4 回归：switch_customer 画像卡切换（mock 模式，非 Windows CI 可跑）────

def test_switch_customer_fallback_on_api_error(tmp_path, monkeypatch):
    """BEHAVIOR-4：API 不可达时 switch_customer 返回降级占位数据，不抛出异常。"""
    import sys
    import unittest.mock as mock

    # mock pywebview 避免真实窗口
    fake_webview = mock.MagicMock()
    fake_webview.create_window.return_value = mock.MagicMock()
    monkeypatch.setitem(sys.modules, "webview", fake_webview)

    from overlay.overlay_window import OverlayApp
    app = OverlayApp(state_dir=str(tmp_path))

    # 强制 API 不可达（URL 无法连接）
    monkeypatch.setenv("ZJ_API", "http://127.0.0.1:19999")
    profile = app.switch_customer("test_wechat_id_A")

    assert profile["nickname"] == "test_wechat_id_A", "降级时 nickname 应为 wechat_id"
    assert "level" in profile
    assert app.current_customer == "test_wechat_id_A", "switch_customer 应更新 current_customer"


def test_switch_customer_two_customers_updates_state(tmp_path, monkeypatch):
    """BEHAVIOR-4：切换两个不同客户时，current_customer 跟随变化（mock API 响应）。"""
    import sys
    import unittest.mock as mock
    import urllib.request as _urllib_req

    fake_webview = mock.MagicMock()
    fake_webview.create_window.return_value = None
    monkeypatch.setitem(sys.modules, "webview", fake_webview)

    # mock urllib.request.urlopen 返回两个不同画像
    profiles = {
        "wxid_A": {"level": "VIP", "nickname": "客户A", "source": "抖音",
                   "contact_count": 5, "recent_actions": [], "ai_profile": "高价值"},
        "wxid_B": {"level": "standard", "nickname": "客户B", "source": "微信",
                   "contact_count": 1, "recent_actions": [], "ai_profile": ""},
    }

    def fake_urlopen(url, timeout=3):
        import json as _json
        for wid, prof in profiles.items():
            if wid in url:
                resp = mock.MagicMock()
                resp.read.return_value = _json.dumps(prof).encode()
                resp.__enter__ = lambda s: s
                resp.__exit__ = mock.MagicMock(return_value=False)
                return resp
        raise ConnectionError("not found")

    monkeypatch.setattr(_urllib_req, "urlopen", fake_urlopen)

    from overlay.overlay_window import OverlayApp
    importlib = __import__("importlib")
    import overlay.overlay_window as _ow_mod
    importlib.reload(_ow_mod)
    OverlayApp2 = _ow_mod.OverlayApp

    app = OverlayApp2(state_dir=str(tmp_path))
    p_a = app.switch_customer("wxid_A")
    assert app.current_customer == "wxid_A"
    assert p_a["nickname"] == "客户A"

    p_b = app.switch_customer("wxid_B")
    assert app.current_customer == "wxid_B"
    assert p_b["nickname"] == "客户B"
    assert p_a["nickname"] != p_b["nickname"], "切换后两客户画像应不同"


def _write_events_jsonl(path, events):
    with open(path, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def test_get_events_switches_customer_when_new_contact_seen(tmp_path, monkeypatch):
    """Step16：get_events() 消费到带 contact 的新事件时，真的调用 switch_customer 联动画像卡
    （里程碑B 遗留：switch_customer/_fetch_customer_profile 曾是孤儿代码，从未被事件循环调用）。
    """
    from overlay.overlay_window import OverlayApp

    app = OverlayApp(state_dir=str(tmp_path))

    called = []
    monkeypatch.setattr(app, "switch_customer", lambda wechat_id: called.append(wechat_id))

    now = time.time()
    _write_events_jsonl(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": now, "event_id": "h-1"},
        {"type": "reply_sent", "event_id": "e-1", "contact": "张三", "ts": now},
    ])

    app.get_events()
    assert called == ["张三"], f"应联动切换到张三，实际调用: {called}"


def test_get_events_does_not_resend_switch_for_same_contact(tmp_path, monkeypatch):
    """同一联系人连续事件 → 只切换一次，不重复调用（current_customer 已相同则跳过）。"""
    from overlay.overlay_window import OverlayApp

    app = OverlayApp(state_dir=str(tmp_path))
    app.current_customer = "张三"

    called = []
    monkeypatch.setattr(app, "switch_customer", lambda wechat_id: called.append(wechat_id))

    now = time.time()
    _write_events_jsonl(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": now, "event_id": "h-1"},
        {"type": "reply_sent", "event_id": "e-1", "contact": "张三", "ts": now},
    ])

    app.get_events()
    assert called == [], "current_customer 已是张三，不应重复切换"


def test_get_events_switches_customer_on_contact_change(tmp_path, monkeypatch):
    """联系人从 A 切到 B → switch_customer 调用一次，参数为 B。"""
    from overlay.overlay_window import OverlayApp

    app = OverlayApp(state_dir=str(tmp_path))
    app.current_customer = "张三"

    called = []
    monkeypatch.setattr(app, "switch_customer", lambda wechat_id: called.append(wechat_id))

    now = time.time()
    _write_events_jsonl(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": now, "event_id": "h-1"},
        {"type": "reply_sent", "event_id": "e-1", "contact": "李四", "ts": now},
    ])

    app.get_events()
    assert called == ["李四"]


# ─── evaluator 发现的真渲染缺口回归：switch_customer 必须真传六字段 + JS 侧必须真定义渲染函数 ───

def test_html_template_defines_customer_card_renderer():
    """HTML_TEMPLATE 必须真定义 window.__updateCustomerCard，且含画像卡 DOM 容器。

    回归背景：evaluator 独立评审发现 switch_customer() 调用 window.__updateCustomerCard，
    但 HTML_TEMPLATE 里从未定义这个函数、也没有画像卡 DOM——JS 侧 `fn && fn(...)` 静默短路，
    浮窗上什么都不会显示（调用链接上了，但落地效果不存在，孤儿代码的另一种变体）。
    """
    from overlay.overlay_window import OverlayApp

    html = OverlayApp.HTML_TEMPLATE
    assert "window.__updateCustomerCard = function" in html or "function __updateCustomerCard" in html, \
        "HTML_TEMPLATE 必须真定义 window.__updateCustomerCard（不能只有调用点没有定义）"
    # 画像卡 DOM 容器 id（六字段各自的渲染目标）必须存在
    for dom_id in ["profile-nickname", "profile-level", "profile-source",
                   "profile-contact-count", "profile-actions", "profile-ai"]:
        assert dom_id in html, f"HTML_TEMPLATE 缺画像卡 DOM 容器 id={dom_id}"


def test_switch_customer_passes_all_six_fields_to_js(tmp_path, monkeypatch):
    """switch_customer 调 evaluate_js 时必须传完整六字段，不能只传 nickname/level。"""
    from overlay.overlay_window import OverlayApp
    import urllib.request as _urllib_req
    import unittest.mock as mock

    full_profile = {
        "level": "VIP", "nickname": "客户A", "source": "抖音",
        "contact_count": 7, "recent_actions": ["咨询价格", "预约到店"],
        "ai_profile": "高价值意向客户",
    }

    def fake_urlopen(url, timeout=3):
        resp = mock.MagicMock()
        resp.read.return_value = json.dumps(full_profile).encode()
        resp.__enter__ = lambda s: s
        resp.__exit__ = mock.MagicMock(return_value=False)
        return resp

    monkeypatch.setattr(_urllib_req, "urlopen", fake_urlopen)

    app = OverlayApp(state_dir=str(tmp_path))
    fake_window = mock.MagicMock()
    app._window = fake_window

    app.switch_customer("wxid_full_test")

    assert fake_window.evaluate_js.called, "evaluate_js 未被调用"
    js_call_arg = fake_window.evaluate_js.call_args[0][0]
    for key, val in full_profile.items():
        val_str = json.dumps(val, ensure_ascii=False) if not isinstance(val, str) else val
        assert (val if isinstance(val, str) else str(val)) in js_call_arg or val_str in js_call_arg, \
            f"字段 {key}={val!r} 未真传给 JS（evaluate_js 调用内容: {js_call_arg[:300]}）"


# ─── GP-4 新增：tail_pointer 持久化（Inv-13） ───

def test_tail_consumer_load_pointer_returns_zero_when_missing(tmp_path):
    """_load_pointer 在 tail_pointer.txt 不存在时归零（Inv-13 软失败）。"""
    consumer = EventTailConsumer(str(tmp_path))
    assert consumer._file_offset == 0


def test_tail_consumer_save_then_load_pointer_roundtrip(tmp_path):
    """_save_pointer 写 offset 后 _load_pointer 可恢复（重启不重放旧事件）。"""
    consumer = EventTailConsumer(str(tmp_path))
    consumer._save_pointer(1024)
    # 新建 consumer 从磁盘恢复
    consumer2 = EventTailConsumer(str(tmp_path))
    assert consumer2._file_offset == 1024


def test_tail_consumer_load_pointer_corrupt_content_returns_zero(tmp_path):
    """tail_pointer.txt 内容损坏（非整数）→ 归零，不抛异常（Inv-13）。"""
    pointer_path = tmp_path / "tail_pointer.txt"
    pointer_path.write_text("not-a-number", encoding="utf-8")
    consumer = EventTailConsumer(str(tmp_path))
    assert consumer._file_offset == 0


# ─── GP-4 新增：open_customer_page webbrowser（Inv-15，FR-4） ───

def test_open_customer_page_calls_webbrowser_open(tmp_path, monkeypatch):
    """open_customer_page 必须调 webbrowser.open（Inv-15：外部浏览器非 iframe）。"""
    from overlay.overlay_window import OverlayApp
    import overlay.overlay_window as _ow_mod

    opened_urls = []

    def fake_open(url):
        opened_urls.append(url)

    monkeypatch.setattr(_ow_mod, "webbrowser", type("wb", (), {"open": staticmethod(fake_open)})())

    app = OverlayApp(state_dir=str(tmp_path))
    app.open_customer_page("wxid_test123")

    assert len(opened_urls) == 1
    assert "wxid_test123" in opened_urls[0]
