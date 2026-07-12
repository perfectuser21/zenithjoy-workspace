import json
import os
import time
import re

def _make_event_id(run_id: str, seq: int) -> str:
    ts_ms = int(time.time() * 1000)
    return f"{ts_ms}-{run_id[:6]}-{seq}"

def write_reply_sent(events_path: str, contact: str, reasoning: str, stage: str = "A1", run_id: str = "000000", seq: int = 0) -> dict:
    """写入 reply_sent 事件到 events.jsonl（O_APPEND 模式）"""
    from services.line04.overlay.pii_filter import filter_pii
    filtered_reasoning = filter_pii(reasoning)

    event = {
        "v": 1,
        "event_id": _make_event_id(run_id, seq),
        "type": "reply_sent",
        "contact": contact,
        "stage": stage,
        "reasoning": filtered_reasoning,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    _rotate_if_needed(events_path)

    with open(events_path, 'a', encoding='utf-8') as f:
        f.write(json.dumps(event, ensure_ascii=False) + '\n')

    return event

def _rotate_if_needed(events_path: str, max_bytes: int = 5 * 1024 * 1024):
    """5MB 轮转：rename 到 .1"""
    try:
        if os.path.exists(events_path) and os.path.getsize(events_path) > max_bytes:
            rotated = events_path + ".1"
            if os.path.exists(rotated):
                os.remove(rotated)
            os.rename(events_path, rotated)
    except OSError:
        pass
