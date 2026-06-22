"""
TDD — 出站发送（关键人播报/告警）REAL 路径必须读回真送达验证，治 sent≠送达 假阳性。

真机 bug（#818 出站播报假发）：send_chat.send_chat_message 的 REAL_PUBLISH=1 路径调
reply_in_chat(mw, item, message) **没传 sender** → reply_in_chat 走 fallback 分支
跳过读回校验（读回 gate 只在 sender 非空时生效）→ _uia_send 自报 True 即返回 True →
中台标 auto_sent，但消息可能根本没真送达（关键人没收到）。

修复：send_chat REAL 路径把 target 当 sender 传进 reply_in_chat，让读回 gate 生效。
读不到原文 → reply_in_chat 返回 False → send_chat_message ok=False → 中台标 send_failed。

【CI 安全】顶层零 pywinauto/win32 import；纯 Fake 注入，跨平台跑。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import listen_chat  # noqa: E402
import send_chat  # noqa: E402


class _PreviewListItem:
    def __init__(self, name: str):
        class _EI:
            pass
        self.element_info = _EI()
        self.element_info.name = name


class _PreviewMW:
    def __init__(self, items):
        self._items = items

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return self._items
        return []


def _patch_real_send_pipeline(monkeypatch, mw):
    """打桩 send_chat REAL 路径的窗口/切换/发送，只留「真送达读回 gate」真实执行。

    注意：别的 test 可能 importlib.reload(listen_chat) 换掉 sys.modules['listen_chat']，
    而 send_chat 函数体内 `from listen_chat import reply_in_chat` 取的是 sys.modules 里的
    活模块。故这里在活模块上打桩（不是 import 时捕获的旧引用），避免全套跑时被污染。
    """
    import types
    lc = sys.modules["listen_chat"]  # 活模块（防 reload 污染）
    sc = sys.modules["send_chat"]

    # send_chat 函数体内 import find_weixin.get_main_window / listen_chat.reply_in_chat
    fake_fw = types.ModuleType("find_weixin")
    fake_fw.get_main_window = lambda: mw
    monkeypatch.setitem(sys.modules, "find_weixin", fake_fw)

    # reply_in_chat 内部链路打桩（同 test_delivery_verification 的 gate-only 配方）
    monkeypatch.setattr(lc.time, "sleep", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_ensure_tray_visible", lambda *a, **k: "")
    monkeypatch.setattr(lc, "_restore_window_state", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_open_chat", lambda *a, **k: True)
    monkeypatch.setattr(lc, "_chat_title_matches", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_find_chat_input", lambda m: object())
    monkeypatch.setattr(lc, "_uia_send", lambda *a, **k: True)  # 自报成功
    monkeypatch.setattr(lc, "_navigate_away", lambda *a, **k: None)
    monkeypatch.setattr(lc, "_get_foreground_window", lambda *a, **k: 0)
    monkeypatch.setattr(lc, "_should_restore_foreground", lambda *a, **k: False)
    # rate_limiter：放行
    if sc.rate_limiter is not None:
        monkeypatch.setattr(sc.rate_limiter, "can_send", lambda *a, **k: (True, None))


def test_outbound_real_send_readback_missing_returns_ok_false(monkeypatch):
    """REAL 路径 _uia_send 自报成功，但读回会话预览里没有原文 → 判未送达，ok=False。

    旧代码 send_chat 不传 sender → reply_in_chat 跳过读回 → 这里返回 ok=True（红）。
    """
    mw = _PreviewMW([_PreviewListItem("默忆\n之前的旧消息\n12:40")])  # 预览未更新成新消息
    _patch_real_send_pipeline(monkeypatch, mw)
    sc = sys.modules["send_chat"]

    result = sc.send_chat_message("默忆", "默忆", "🟢 上线播报", real_publish=True)
    assert result["ok"] is False, "读回未确认送达必须 ok=False（治出站播报假发）"
    assert result.get("reason") == "send_failed"


def test_outbound_real_send_readback_confirmed_returns_ok_true(monkeypatch):
    """REAL 路径 _uia_send 自报成功，且读回会话预览出现原文 → 真送达确认，ok=True。"""
    mw = _PreviewMW([_PreviewListItem("默忆\n🟢 上线播报\n12:45")])  # 预览已是新发消息
    _patch_real_send_pipeline(monkeypatch, mw)
    sc = sys.modules["send_chat"]

    result = sc.send_chat_message("默忆", "默忆", "🟢 上线播报", real_publish=True)
    assert result["ok"] is True, "读回确认原文出现必须 ok=True"


def test_process_outbound_readback_fail_posts_send_failed(monkeypatch):
    """端到端：出站任务 → REAL 发送自报成功但读回失败 → 回执 send_failed（ok=False）+ 告警。

    复现真机假发：旧代码这条会回 ok=True 标 auto_sent（红）。
    """
    lc = sys.modules["listen_chat"]
    monkeypatch.setattr(
        lc, "fetch_outbound_tasks",
        lambda *a, **k: [{"task_id": "tk1", "target": "默忆", "message": "🟢 上线播报"}],
    )
    mw = _PreviewMW([_PreviewListItem("默忆\n之前的旧消息\n12:40")])  # 读回拿不到原文
    _patch_real_send_pipeline(monkeypatch, mw)

    receipts = []
    monkeypatch.setattr(
        lc, "post_outbound_receipt",
        lambda url, tid, ok, **k: receipts.append((tid, ok)),
    )
    alerts = []
    monkeypatch.setattr(
        lc, "post_failure_alert",
        lambda url, aid, kc, reason, **k: alerts.append((kc, reason)),
    )

    n = lc.process_outbound_once("http://mw", "agent-1", real_publish=True)
    assert n == 0, "读回未确认送达不算发成功"
    assert receipts == [("tk1", False)], "回执必须 send_failed，绝不在没真送达时标 auto_sent"
    assert alerts == [("默忆", "key_contact_send_failed")]
