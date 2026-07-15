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
    consumer = EventTailConsumer(str(tmp_path))
    stale_ts = time.time() - 3600  # 1 小时前
    _write_events(os.path.join(str(tmp_path), "events.jsonl"), [
        {"type": "heartbeat", "ts": stale_ts, "event_id": "h-old"},
        {"type": "reply_sent", "event_id": "e-9", "contact": "李四"},
    ])
    events = consumer.get_events()
    assert len(events) == 1
    assert events[0]["type"] == "degraded"
    assert "休息中" in events[0]["msg"]


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
        {"type": "reply_sent", "event_id": "e-1", "contact": "李四", "ts": now},
    ])

    app.get_events()
    assert called == ["李四"]
