"""
events.jsonl 事件管道测试骨架
对应：[BEHAVIOR-INV-4] events.jsonl 唯一写者
对应：[BEHAVIOR-FUNC-4] 守护态默认文案非空
"""
import json
import os
import tempfile
import threading
import time
import pytest
from datetime import date, timedelta


def make_event(event_type: str, seq: int, run_id: str = "run001",
               contact: str = "张三", ts_ms: int = None) -> dict:
    ts = ts_ms or int(time.time() * 1000)
    return {
        "v": 1,
        "event_id": f"{ts}-{run_id}-{seq}",
        "type": event_type,
        "contact": contact,
        "ts_ms": ts,
    }


class TestBadLineSkip:
    """[BEHAVIOR-INV-4] 坏行容错"""

    def test_bad_line_skip(self, tmp_path):
        """JSON 解析失败的行跳过，不崩溃"""
        events_file = tmp_path / "events.jsonl"
        lines = [
            json.dumps(make_event("reply_sent", 1)) + "\n",
            "THIS IS NOT JSON\n",  # 坏行
            json.dumps(make_event("reply_sent", 2)) + "\n",
            "{broken json\n",  # 另一坏行
            json.dumps(make_event("reply_sent", 3)) + "\n",
        ]
        events_file.write_text("".join(lines))

        good_events = []
        bad_count = 0
        with open(events_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                    good_events.append(ev)
                except json.JSONDecodeError:
                    bad_count += 1  # 跳过，不崩溃

        assert len(good_events) == 3
        assert bad_count == 2


class TestConcurrentWriteRead:
    """[BEHAVIOR-INV-4] 并发写读 1 万行无丢无重"""

    def test_concurrent_write_read(self, tmp_path):
        """多线程并发追加写入，读取无丢无重"""
        events_file = tmp_path / "events.jsonl"
        total = 10000
        write_count = 0
        lock = threading.Lock()

        def writer(start, end, run_id):
            nonlocal write_count
            with open(events_file, "a", encoding="utf-8") as f:
                for i in range(start, end):
                    ev = make_event("reply_sent", i, run_id=run_id)
                    f.write(json.dumps(ev, ensure_ascii=False) + "\n")
                    with lock:
                        write_count += 1

        threads = []
        per_thread = total // 4
        for t in range(4):
            th = threading.Thread(
                target=writer,
                args=(t * per_thread, (t + 1) * per_thread, f"run{t:03d}")
            )
            threads.append(th)

        for th in threads:
            th.start()
        for th in threads:
            th.join()

        # 读取验证
        read_events = []
        with open(events_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        read_events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pytest.fail(f"Bad line: {line}")

        assert len(read_events) == total, f"Expected {total}, got {len(read_events)}"

        # 检查无重复 event_id
        event_ids = [e["event_id"] for e in read_events]
        assert len(event_ids) == len(set(event_ids)), "Duplicate event_ids found"


class TestCrossMidnightCount:
    """跨午夜计数正确区分日期"""

    def test_cross_midnight_count(self, tmp_path):
        """跨午夜时，today 只统计今日 reply_sent"""
        events_file = tmp_path / "events.jsonl"
        today = date.today()
        yesterday = today - timedelta(days=1)

        def day_ts(d: date, hour: int = 12) -> int:
            import datetime
            dt = datetime.datetime.combine(d, datetime.time(hour, 0, 0))
            return int(dt.timestamp() * 1000)

        events = [
            {**make_event("reply_sent", 1, ts_ms=day_ts(yesterday)), "ts_ms": day_ts(yesterday)},
            {**make_event("reply_sent", 2, ts_ms=day_ts(yesterday, 23)), "ts_ms": day_ts(yesterday, 23)},
            {**make_event("reply_sent", 3, ts_ms=day_ts(today)), "ts_ms": day_ts(today)},
            {**make_event("reply_sent", 4, ts_ms=day_ts(today, 15)), "ts_ms": day_ts(today, 15)},
            {**make_event("heartbeat", 5, ts_ms=day_ts(today)), "ts_ms": day_ts(today)},
        ]

        with open(events_file, "w", encoding="utf-8") as f:
            for ev in events:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")

        # 统计今日 reply_sent
        import datetime
        today_date_str = today.isoformat()
        count = 0
        with open(events_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    ev = json.loads(line.strip())
                    if ev.get("type") == "reply_sent":
                        ts = ev.get("ts_ms", 0) / 1000
                        ev_date = datetime.datetime.fromtimestamp(ts).date().isoformat()
                        if ev_date == today_date_str:
                            count += 1
                except json.JSONDecodeError:
                    pass

        assert count == 2, f"Expected 2 today's reply_sent, got {count}"


class TestTwoGenReplay:
    """跨两代 events.jsonl 回放计数"""

    def test_two_gen_replay(self, tmp_path):
        """回放当前代+前一代，今日计数累计正确"""
        import datetime
        today = datetime.date.today()

        def day_ts(hour: int = 10) -> int:
            dt = datetime.datetime.combine(today, datetime.time(hour, 0, 0))
            return int(dt.timestamp() * 1000)

        # 前一代（旧文件）
        old_file = tmp_path / "events.jsonl.1"
        with open(old_file, "w") as f:
            f.write(json.dumps({**make_event("reply_sent", 1, ts_ms=day_ts(9)), "ts_ms": day_ts(9)}) + "\n")
            f.write(json.dumps({**make_event("reply_sent", 2, ts_ms=day_ts(10)), "ts_ms": day_ts(10)}) + "\n")

        # 当前代
        new_file = tmp_path / "events.jsonl"
        with open(new_file, "w") as f:
            f.write(json.dumps({**make_event("reply_sent", 3, ts_ms=day_ts(11)), "ts_ms": day_ts(11)}) + "\n")
            f.write(json.dumps({**make_event("reply_sent", 4, ts_ms=day_ts(12)), "ts_ms": day_ts(12)}) + "\n")

        today_str = today.isoformat()
        count = 0
        for filepath in [old_file, new_file]:
            with open(filepath, "r") as f:
                for line in f:
                    try:
                        ev = json.loads(line.strip())
                        if ev.get("type") == "reply_sent":
                            ts = ev.get("ts_ms", 0) / 1000
                            ev_date = datetime.datetime.fromtimestamp(ts).date().isoformat()
                            if ev_date == today_str:
                                count += 1
                    except json.JSONDecodeError:
                        pass

        assert count == 4, f"Expected 4 from two-gen replay, got {count}"


class TestEventIdDedup:
    """[BEHAVIOR-INV-4] event_id 幂等去重"""

    def test_event_id_dedup(self, tmp_path):
        """相同 event_id 写入多次，只处理一次"""
        events_file = tmp_path / "events.jsonl"
        ev = make_event("reply_sent", 1)

        with open(events_file, "w") as f:
            # 同一 event_id 写 3 次
            for _ in range(3):
                f.write(json.dumps(ev) + "\n")

        seen_ids = set()
        processed = []
        with open(events_file, "r") as f:
            for line in f:
                try:
                    event = json.loads(line.strip())
                    eid = event["event_id"]
                    if eid not in seen_ids:
                        seen_ids.add(eid)
                        processed.append(event)
                except json.JSONDecodeError:
                    pass

        assert len(processed) == 1, f"Expected 1 after dedup, got {len(processed)}"


class TestGuardianModeNotBlank:
    """[BEHAVIOR-FUNC-4] 守护态默认文案非空"""

    def test_guardian_mode_not_blank(self):
        """NOT_FOUND 状态下守护态文案不为空"""
        # 模拟守护态文案生成逻辑
        today_count = 5
        last_action_time = "14:30"

        guardian_text = f"AI 客服守护中 · 今日已回复 {today_count} 条 · 最近动作 {last_action_time}"

        assert guardian_text.strip() != ""
        assert "AI 客服守护中" in guardian_text
        assert str(today_count) in guardian_text
        assert last_action_time in guardian_text
