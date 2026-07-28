"""
panel_events.py — 作战窗 Agent Panel 刀1 独立事件写入
PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md

与 line04 现有 events.jsonl（唯一写者=listen_chat.py，供画像卡 overlay_window.py 只读消费）
完全独立的新文件 panel-events.jsonl，绝不能共用——否则破坏现有单写者约束
（golden-path-4-smoke.sh Step15c 曾因单写者被破坏出过真机事故：画像卡永远显示不出内容）。

6 种事件：task_started / step / waiting / stuck / done / failed
"""
import json
import os
import time
import uuid

from overlay.pii_filter import filter_pii

_VALID_EVENTS = {"task_started", "step", "waiting", "stuck", "done", "failed"}

_PANEL_EVENTS_FILENAME = "panel-events.jsonl"


def _state_dir():
    return os.environ.get("ZJ_STATE_DIR") or os.environ.get("PUBLIC", r"C:\Users\Public")


def _panel_events_path():
    return os.path.join(_state_dir(), _PANEL_EVENTS_FILENAME)


def new_task_id(sender):
    return f"{sender}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"


def write_panel_event(event, task_id, line, device, title, detail=None, progress=None, severity="info"):
    """追加写入一条作战窗事件（软失败：任何异常仅静默吞，不上抛——面板是旁观者，
    绝不能因为写事件失败反过来影响 handler 干活，参照 shared/event-reporter.ts 纪律）。"""
    if event not in _VALID_EVENTS:
        raise ValueError(f"unknown panel event type: {event!r}, must be one of {sorted(_VALID_EVENTS)}")

    record = {
        "event": event,
        "task_id": task_id,
        "line": line,
        "device": device,
        "title": filter_pii(title) if title else title,
        "detail": filter_pii(detail) if detail else detail,
        "progress": list(progress) if progress else None,
        "severity": severity,
        "ts": time.time(),
    }
    try:
        with open(_panel_events_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass
