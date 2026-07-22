# -*- coding: utf-8 -*-
# listen_chat._write_event 单测（task:af47b1da，events_writer 重新实现）。
# 覆盖 FR-2：events.jsonl 合规写入 / PII 二次过滤 / reasoning 截断 ≤30 字 / 软失败。
import json
import os
from unittest.mock import patch

import listen_chat


def _read_events(state_dir):
    events_file = os.path.join(state_dir, "events.jsonl")
    assert os.path.exists(events_file), "events.jsonl 未被创建"
    with open(events_file, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_write_event_creates_jsonl_with_required_fields(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "张三", "客户询问价格，已推送优惠", None)

    rows = _read_events(state_dir)
    assert len(rows) == 1
    row = rows[0]
    required_fields = {"v", "event_id", "date", "type", "contact", "stage", "reasoning", "ts"}
    assert required_fields <= row.keys(), f"缺少必需字段: {required_fields - row.keys()}"
    assert row["v"] == 1
    assert row["type"] == "reply_sent"
    assert row["contact"] == "张三"
    assert len(row["event_id"].split("-")) == 3, f"event_id 格式不符: {row['event_id']}"


def test_write_event_reasoning_null_when_none(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "李四", None, None)

    row = _read_events(state_dir)[0]
    assert row["reasoning"] is None


def test_write_event_pii_filter_phone(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "王五", "客户留下手机 13812345678 已回复", None)

    content = open(os.path.join(state_dir, "events.jsonl"), encoding="utf-8").read()
    assert "13812345678" not in content, f"events.jsonl 不应含原始手机号\n内容: {content}"


def test_write_event_pii_filter_wechat_id(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "赵六", "客户微信 wxid_testaccount123", None)

    content = open(os.path.join(state_dir, "events.jsonl"), encoding="utf-8").read()
    assert "wxid_testaccount123" not in content, f"events.jsonl 不应含原始微信号\n内容: {content}"


def test_write_event_reasoning_truncated_to_30_chars(tmp_path):
    state_dir = str(tmp_path)
    long_reasoning = "这是一段超过三十个字符的推理文案，客户询问了价格并表示非常感兴趣，我们推送了最新的限时优惠活动"
    assert len(long_reasoning) > 30
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "孙七", long_reasoning, None)

    row = _read_events(state_dir)[0]
    assert row["reasoning"] is not None
    assert len(row["reasoning"]) <= 30, f"reasoning 超 30 字: {row['reasoning']}"


def test_write_event_short_reasoning_kept(tmp_path):
    state_dir = str(tmp_path)
    short_reasoning = "已推送优惠活动"
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        listen_chat._write_event("reply_sent", "周八", short_reasoning, None)

    row = _read_events(state_dir)[0]
    assert len(row["reasoning"] or "") <= 30


def test_write_event_soft_fail_on_unwritable_dir():
    bad_state_dir = "/nonexistent_zj_state_dir_for_test"
    with patch.dict(os.environ, {"ZJ_STATE_DIR": bad_state_dir}):
        # 关键断言：不可写目录不抛异常（软失败，仅 log）
        listen_chat._write_event("reply_sent", "吴九", "测试软失败", None)


def test_write_event_soft_fail_on_readonly_dir(tmp_path):
    readonly_dir = tmp_path / "readonly"
    readonly_dir.mkdir()
    readonly_dir.chmod(0o444)
    try:
        with patch.dict(os.environ, {"ZJ_STATE_DIR": str(readonly_dir)}):
            listen_chat._write_event("reply_sent", "郑十", "只读目录测试", None)
    finally:
        readonly_dir.chmod(0o755)


def test_run_real_listen_writes_heartbeat_event():
    """★2026-07-16 画像卡永远空白根治：run_real_listen 主循环必须调用
    _write_event("heartbeat", ...) 写进 events.jsonl，overlay 的 EventTailConsumer
    才能真正判定"AI 客服在线"（否则 _last_heartbeat_ts 永远是 None，degraded
    状态永久成立——纯 UI 提示层面的问题，但也是本次真机复盘该顺手治好的部分）。
    """
    import ast

    src_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "listen_chat.py")
    with open(src_path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "run_real_listen":
            writes_heartbeat = False
            for n in ast.walk(node):
                if (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                        and n.func.id == "_write_event" and n.args
                        and isinstance(n.args[0], ast.Constant)
                        and n.args[0].value == "heartbeat"):
                    writes_heartbeat = True
                    break
            assert writes_heartbeat, (
                "run_real_listen 必须调用 _write_event(\"heartbeat\", ...) 写心跳事件到 "
                "events.jsonl，否则 overlay 的 EventTailConsumer 永远判定不在线"
            )
            return
    raise AssertionError("未找到 run_real_listen 函数")
