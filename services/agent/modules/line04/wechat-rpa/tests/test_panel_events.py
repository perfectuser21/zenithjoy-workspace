# test_panel_events.py — 作战窗刀1 独立事件写入单测
#
# 关键约束（PrepPRD 前置工作 + FR GAN Phase1 缺口#7）：
#   panel-events.jsonl 必须与现有 line04 画像卡用的 events.jsonl 完全独立文件，
#   不能破坏 events.jsonl 的单写者约束（golden-path-4-smoke.sh Step15c 曾因此出真机事故）。
#   detail/title 字段必须过滤 PII（FR GAN 缺口#8：detail 易被塞入聊天原文/手机号）。
#
# 隔离：每个测试各自用 pytest tmp_path + patch.dict(ZJ_STATE_DIR)，
# 不用 conftest 里全会话共享的那份（会被同批次其它测试污染，仿 test_events_writer.py 写法）。
import ast
import json
import os
from unittest.mock import patch

import pytest

from panel.panel_events import write_panel_event, new_task_id


def _panel_events_path(state_dir):
    return os.path.join(state_dir, "panel-events.jsonl")


def _legacy_events_path(state_dir):
    return os.path.join(state_dir, "events.jsonl")


def _read_lines(path):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def test_writes_to_panel_events_jsonl_not_legacy_events_jsonl(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        write_panel_event(
            "task_started", task_id="t1", line="line04", device="xian-pc", title="回复客户张三",
        )
    assert os.path.exists(_panel_events_path(state_dir))
    assert not os.path.exists(_legacy_events_path(state_dir)), (
        "panel事件绝不能写进line04现有events.jsonl，会破坏单写者约束"
    )


def test_written_record_has_all_six_event_schema_fields(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        write_panel_event(
            "step", task_id="t2", line="line04", device="xian-pc", title="回复客户李四",
            detail="第2/5步：读取对话历史", progress=(2, 5), severity="info",
        )
    rec = _read_lines(_panel_events_path(state_dir))[-1]
    assert rec["event"] == "step"
    assert rec["task_id"] == "t2"
    assert rec["line"] == "line04"
    assert rec["device"] == "xian-pc"
    assert rec["title"] == "回复客户李四"
    assert rec["detail"] == "第2/5步：读取对话历史"
    assert rec["progress"] == [2, 5]
    assert rec["severity"] == "info"
    assert isinstance(rec["ts"], float)


def test_unknown_event_type_rejected(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        with pytest.raises(ValueError):
            write_panel_event("bogus_event", task_id="t3", line="line04", device="d", title="x")


def test_multiple_writes_append_not_overwrite(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        write_panel_event("task_started", task_id="t4", line="line04", device="d", title="a")
        write_panel_event("done", task_id="t4", line="line04", device="d", title="a")
    lines = _read_lines(_panel_events_path(state_dir))
    task4_events = [r for r in lines if r["task_id"] == "t4"]
    assert len(task4_events) == 2
    assert [r["event"] for r in task4_events] == ["task_started", "done"]


def test_pii_in_detail_gets_filtered(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        write_panel_event(
            "step", task_id="t5", line="line04", device="d", title="x",
            detail="客户手机号是13812345678",
        )
    rec = _read_lines(_panel_events_path(state_dir))[-1]
    assert "13812345678" not in rec["detail"]
    assert rec["detail"] == "[手机号]"


def test_new_task_id_generates_unique_ids():
    ids = {new_task_id("张三") for _ in range(20)}
    assert len(ids) == 20


def test_detail_and_progress_optional(tmp_path):
    state_dir = str(tmp_path)
    with patch.dict(os.environ, {"ZJ_STATE_DIR": state_dir}):
        write_panel_event("task_started", task_id="t6", line="line04", device="d", title="x")
    rec = _read_lines(_panel_events_path(state_dir))[-1]
    assert rec["detail"] is None
    assert rec["progress"] is None


def test_soft_fail_on_unwritable_dir():
    """面板是旁观者，打点失败绝不能抛异常影响真实回复流程（软失败纪律，仿 events_writer）。"""
    with patch.dict(os.environ, {"ZJ_STATE_DIR": "/nonexistent_zj_state_dir_for_test"}):
        write_panel_event("task_started", task_id="t7", line="line04", device="d", title="x")


# ---- listen_chat.py 真实打点接线校验（AST 静态分析，仿 test_run_real_listen_writes_heartbeat_event） ----
# 真实微信回复流程需要真机窗口，无法在 CI 里功能性跑通；用 AST 校验 3 个打点调用点真实存在，
# 和 golden-path-4-smoke.sh Step15b 用 grep 校验 _write_event("reply_sent" 是同一类等价断言。

def _listen_chat_ast():
    src_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "listen_chat.py",
    )
    with open(src_path, encoding="utf-8") as f:
        return ast.parse(f.read())


def _calls_write_panel_event_with(tree, func_name, event_type):
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            for n in ast.walk(node):
                if (
                    isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Name)
                    and n.func.id == "write_panel_event"
                ):
                    for kw in n.keywords:
                        if kw.arg is None:
                            continue
                    # 第一个位置参数是事件类型字符串
                    if n.args and isinstance(n.args[0], ast.Constant) and n.args[0].value == event_type:
                        return True
            return False
    raise AssertionError(f"listen_chat.py 未找到函数 {func_name}")


def test_gen_draft_emits_task_started():
    assert _calls_write_panel_event_with(_listen_chat_ast(), "_gen_draft", "task_started"), (
        "_gen_draft 必须调用 write_panel_event(\"task_started\", ...)，"
        "否则作战窗面板永远看不到 line04 任务开始"
    )


def test_run_real_listen_emits_done():
    assert _calls_write_panel_event_with(_listen_chat_ast(), "run_real_listen", "done"), (
        "run_real_listen 发送成功分支必须调用 write_panel_event(\"done\", ...)"
    )


def test_run_real_listen_emits_failed():
    assert _calls_write_panel_event_with(_listen_chat_ast(), "run_real_listen", "failed"), (
        "run_real_listen 发送失败分支必须调用 write_panel_event(\"failed\", ...)"
    )
