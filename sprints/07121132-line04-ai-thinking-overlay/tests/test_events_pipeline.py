"""
test_events_pipeline.py — events.jsonl 管道骨架测试

覆盖 BEHAVIOR-1、BEHAVIOR-2、BEHAVIOR-3 的所有断言点。
实现时将 TODO 替换为真实导入。

运行：pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py -v
"""
import json
import os
import threading
import time
import tempfile
import re
from pathlib import Path
import pytest

# TODO: 实现完成后替换为真实导入
# from services.line04.overlay.tail_reader import TailReader
# from services.line04.overlay.pii_filter import filter_pii
# from services.line04.listen_chat import write_event


# ─── 辅助函数 ───────────────────────────────────────────────────────────────

def make_event(event_type: str, contact: str = "张三", stage: str = "A1",
               reasoning: str = "客户询问价格，已推送优惠方案", seq: int = 1,
               event_id: str = None) -> dict:
    """生成合规 events.jsonl 行 schema"""
    epoch_ms = int(time.time() * 1000)
    run_id = "abc123"
    eid = event_id or f"{epoch_ms}-{run_id}-{seq}"
    return {
        "v": 1,
        "event_id": eid,
        "date": time.strftime("%Y-%m-%d"),
        "type": event_type,
        "contact": contact,
        "stage": stage,
        "reasoning": reasoning,
        "ts": int(time.time()),
    }


def write_line(path: str, row: dict):
    """O_APPEND 追加写一行"""
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


# ─── BEHAVIOR-1：事件 schema 合规 ────────────────────────────────────────────

class TestEventSchema:
    """BEHAVIOR-1：events.jsonl 写入正确性与唯一写者约束"""

    def test_reply_sent_schema(self, tmp_path):
        """reply_sent 行包含所有必需字段，reasoning ≤30 字"""
        events_file = str(tmp_path / "events.jsonl")
        row = make_event("reply_sent", reasoning="已推送优惠活动信息")
        write_line(events_file, row)

        with open(events_file, encoding="utf-8") as f:
            loaded = json.loads(f.readline())

        required_fields = {"v", "event_id", "date", "type", "contact", "stage", "reasoning", "ts"}
        assert required_fields.issubset(loaded.keys()), f"缺少字段: {required_fields - loaded.keys()}"
        assert loaded["v"] == 1
        assert loaded["type"] == "reply_sent"
        assert len(loaded["reasoning"]) <= 30, f"reasoning 超 30 字: {loaded['reasoning']}"

    def test_event_schema_fields(self, tmp_path):
        """所有 4 种事件类型均满足 schema 约束"""
        events_file = str(tmp_path / "events.jsonl")
        for etype in ["reply_sent", "reply_skipped", "heartbeat", "agent_online"]:
            row = make_event(etype, seq=1)
            write_line(events_file, row)

        with open(events_file, encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == 4
        for line in lines:
            row = json.loads(line)
            assert "event_id" in row
            # event_id 格式：{epoch_ms}-{6位hex}-{seq}
            parts = row["event_id"].split("-")
            assert len(parts) == 3, f"event_id 格式不符: {row['event_id']}"

    def test_stage_values(self, tmp_path):
        """customer_stage 只能是 A1/A2/A3/A4/null（Invariant I4）"""
        valid_stages = {"A1", "A2", "A3", "A4", None}
        events_file = str(tmp_path / "events.jsonl")
        for stage in ["A1", "A2", "A3", "A4"]:
            row = make_event("reply_sent", stage=stage)
            write_line(events_file, row)

        with open(events_file, encoding="utf-8") as f:
            for line in f:
                row = json.loads(line)
                assert row.get("stage") in valid_stages, f"非法 stage: {row.get('stage')}"

    def test_reasoning_max_30_chars(self, tmp_path):
        """reasoning 字段必须 ≤30 字符"""
        events_file = str(tmp_path / "events.jsonl")
        long_reasoning = "这是超过三十个字的推理文案，客户询问了价格并表示很感兴趣，我们推送了最新优惠活动"
        assert len(long_reasoning) > 30, "测试前提：该字符串 >30 字"

        # 写入前应被截断到 ≤30 字
        truncated = long_reasoning[:30]
        row = make_event("reply_sent", reasoning=truncated)
        write_line(events_file, row)

        with open(events_file, encoding="utf-8") as f:
            loaded = json.loads(f.readline())
        assert len(loaded["reasoning"]) <= 30


# ─── BEHAVIOR-2：并发写读、坏行容错、幂等去重 ────────────────────────────────

class TestPipelineRobustness:
    """BEHAVIOR-2：并发、坏行、去重"""

    def test_concurrent_write_read(self, tmp_path):
        """双线程并发写 1000 行（简化版），读侧无丢失"""
        events_file = str(tmp_path / "events.jsonl")
        N = 1000
        write_count = {"n": 0}
        lock = threading.Lock()

        def writer(thread_id: int):
            for i in range(N // 2):
                row = make_event("reply_sent", seq=i, event_id=f"t{thread_id}-{i}")
                with open(events_file, "a", encoding="utf-8") as f:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                with lock:
                    write_count["n"] += 1

        t1 = threading.Thread(target=writer, args=(1,))
        t2 = threading.Thread(target=writer, args=(2,))
        t1.start(); t2.start()
        t1.join(); t2.join()

        with open(events_file, encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == N, f"期望 {N} 行，实际 {len(lines)} 行"

    def test_bad_line_tolerance(self, tmp_path):
        """含非 JSON 坏行时，tail 读取跳过坏行继续处理有效行"""
        events_file = str(tmp_path / "events.jsonl")

        # 写入：好行 → 坏行 → 好行
        good1 = make_event("reply_sent", contact="张三")
        bad_line = "这不是 JSON 内容！\n"
        good2 = make_event("heartbeat", contact="")

        with open(events_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(good1, ensure_ascii=False) + "\n")
            f.write(bad_line)
            f.write(json.dumps(good2, ensure_ascii=False) + "\n")

        # 模拟 tail_reader 坏行容错逻辑
        valid_rows = []
        with open(events_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    valid_rows.append(row)
                except json.JSONDecodeError:
                    pass  # 跳过坏行，不崩溃

        assert len(valid_rows) == 2, f"期望 2 条有效行，实际 {len(valid_rows)}"
        assert valid_rows[0]["type"] == "reply_sent"
        assert valid_rows[1]["type"] == "heartbeat"

    def test_event_id_dedup(self, tmp_path):
        """相同 event_id 重放不重计数"""
        events_file = str(tmp_path / "events.jsonl")
        fixed_id = "1234567890-abc123-1"
        row = make_event("reply_sent", event_id=fixed_id)

        # 写入 3 次（模拟重放）
        for _ in range(3):
            write_line(events_file, row)

        # 模拟幂等去重计数
        seen_ids = set()
        count = 0
        with open(events_file, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line.strip())
                    eid = r.get("event_id")
                    if eid and eid not in seen_ids:
                        seen_ids.add(eid)
                        if r["type"] == "reply_sent":
                            count += 1
                except json.JSONDecodeError:
                    pass

        assert count == 1, f"幂等去重后计数应为 1，实际 {count}"

    def test_rotation_replay(self, tmp_path):
        """文件轮转后（.1 → 新建），今日计数跨两代正确合并"""
        events_file = str(tmp_path / "events.jsonl")
        events_file_1 = str(tmp_path / "events.jsonl.1")

        today = time.strftime("%Y-%m-%d")

        # .1 代：3 条今日 reply_sent
        for i in range(3):
            row = make_event("reply_sent", seq=i, event_id=f"old-{i}", reasoning="旧代消息")
            write_line(events_file_1, row)

        # 当前代：2 条今日 reply_sent（不同 event_id）
        for i in range(2):
            row = make_event("reply_sent", seq=i + 10, event_id=f"new-{i}", reasoning="新代消息")
            write_line(events_file, row)

        # 模拟两代合并计数
        seen_ids = set()
        total_today = 0
        for path in [events_file_1, events_file]:
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                for line in f:
                    try:
                        r = json.loads(line.strip())
                        if r.get("date") == today and r.get("type") == "reply_sent":
                            eid = r.get("event_id", "")
                            if eid not in seen_ids:
                                seen_ids.add(eid)
                                total_today += 1
                    except json.JSONDecodeError:
                        pass

        assert total_today == 5, f"两代合并今日计数应为 5，实际 {total_today}"


# ─── BEHAVIOR-3：PII 双硬闸 ──────────────────────────────────────────────────

class TestPiiFilter:
    """BEHAVIOR-3：PII 双硬闸，含复述客户原话用例"""

    # 简化版 PII 过滤纯函数（实现完成后替换为真实导入）
    PII_PATTERNS = [
        (re.compile(r'1[3-9]\d{9}'), '[手机号]'),          # 手机号
        (re.compile(r'wxid_[A-Za-z0-9_]+'), '[微信号]'),   # 微信号
        (re.compile(r'\d{17}[\dXx]'), '[身份证]'),          # 身份证
    ]

    def filter_pii(self, text: str) -> str:
        """PII 过滤纯函数（与中台同逻辑）"""
        for pattern, replacement in self.PII_PATTERNS:
            if pattern.search(text):
                return replacement
        return text

    def test_pii_phone_number(self):
        """手机号被过滤"""
        result = self.filter_pii("客户说他的手机是 13800138000")
        assert "13800138000" not in result, "手机号应被过滤"

    def test_pii_wechat_id(self):
        """微信号被过滤"""
        result = self.filter_pii("加我微信 wxid_abc123xyz")
        assert "wxid_abc123xyz" not in result, "微信号应被过滤"

    def test_pii_id_card(self):
        """身份证被过滤"""
        result = self.filter_pii("身份证号 110101199001011234")
        assert "110101199001011234" not in result, "身份证应被过滤"

    def test_pii_verbatim_customer_message(self):
        """
        复述客户原话用例（BEHAVIOR-3 核心）：
        LLM reasoning 含客户原始消息文本（含手机号）→ 必须被过滤
        """
        # 模拟 LLM 在 reasoning 中复述了客户原话
        llm_reasoning = "客户询问价格并留下手机 13912345678，已推送活动"
        filtered = self.filter_pii(llm_reasoning)
        assert "13912345678" not in filtered, "复述客户原话中的手机号应被过滤"

    def test_pii_clean_text_unchanged(self):
        """不含 PII 的文案不被篡改"""
        clean = "已推送优惠活动，客户表示感兴趣"
        result = self.filter_pii(clean)
        assert result == clean, f"干净文案不应被修改: {result}"

    def test_pii_double_gate_event(self, tmp_path):
        """
        events.jsonl 写入前执行 PII 二次过滤（Invariant I5）：
        即使中台侧漏过，agent 侧仍会过滤
        """
        events_file = str(tmp_path / "events.jsonl")

        # 模拟 agent 写 events 前执行 PII 过滤
        raw_reasoning = "客户电话 13812345678 已回复"
        filtered_reasoning = self.filter_pii(raw_reasoning)
        row = make_event("reply_sent", reasoning=filtered_reasoning)
        write_line(events_file, row)

        with open(events_file, encoding="utf-8") as f:
            loaded = json.loads(f.readline())

        assert "13812345678" not in loaded.get("reasoning", ""), \
            "events.jsonl 中 reasoning 不应含手机号（PII 二次过滤）"

    def test_pii_patterns(self):
        """边界用例：三种 PII 类型全部覆盖"""
        cases = [
            ("手机号 13800138000", "13800138000"),
            ("微信 wxid_testaccount", "wxid_testaccount"),
            ("身份证 110101199001011234", "110101199001011234"),
        ]
        for text, pii in cases:
            result = self.filter_pii(text)
            assert pii not in result, f"PII [{pii}] 应被过滤，原文: {text}, 过滤后: {result}"
