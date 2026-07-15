# Contract DoD — Line04 events_writer

sprint_dir: sprints/07152230-line04-events-writer
task_id: af47b1da-0846-4300-bb1a-a733be50c9bd
date: 2026-07-15

---

## [BEHAVIOR] 条目

### BEHAVIOR-1：唯一写者断言（Invariant I1）

**描述**：events.jsonl 唯一写者为 listen_chat.py，overlay 目录下任何文件均不得包含写入 events.jsonl 的调用。写入必须使用追加模式（`open(..., "a")`），禁止覆盖模式。

**验收命令**：
```bash
# BEHAVIOR-1（继承自原 BEHAVIOR-8）回归
# 注：overlay_window.py 允许只读消费 events.jsonl（"r" 模式），此处检查写入调用（"a"/"w" 模式）
write_opens=$(grep -rn 'open.*"a"\|open.*"w"' services/agent/wechat-rpa/overlay/ --include="*.py" 2>/dev/null \
  | grep -i "events" | grep -v "^[[:space:]]*#" | grep -v "__pycache__" || true)
if [ -n "$write_opens" ]; then
  echo "FAIL: overlay 目录含 events 写入调用: $write_opens"
  exit 1
fi
echo "PASS: overlay 目录无 events.jsonl 写入调用"

# O_APPEND 追加模式断言：确认使用追加模式而非覆盖模式
result_append=$(grep -n 'open.*"a"' services/agent/wechat-rpa/listen_chat.py | grep -i "events")
if [ -z "$result_append" ]; then
  echo "FAIL: listen_chat.py 中未找到 events 文件的追加模式 open(\"a\") 调用"
  exit 1
fi
echo "PASS: 追加模式确认: $result_append"
```

**失败判定**：overlay grep 有任何输出，或 O_APPEND grep 无输出 → FAIL

---

### BEHAVIOR-2：reply_sent 写入点约束（Invariant I2）

**描述**：reply_sent 事件必须挂接在 listen_chat.py DELIVERED 确认成功点（`_commit_reply_success` 调用行之后的 `if ok:` 分支内），不得在 `_commit_reply_success` 函数本体内部调用 `_write_event`。

**验收命令**：
```bash
# BEHAVIOR-2（继承自原 BEHAVIOR-9）挂点回归
# 断言1：_write_event 调用存在于 DELIVERED 点（_commit_reply_success 后）
result=$(grep -n '_write_event("reply_sent"' services/agent/wechat-rpa/listen_chat.py)
if [ -z "$result" ]; then
  echo "FAIL: DELIVERED 点未找到 _write_event(\"reply_sent\") 调用"
  exit 1
fi
echo "PASS: DELIVERED 点挂接确认: $result"

# 断言2：_commit_reply_success 本体内不含 _write_event 调用
# 提取函数体（简化：检查函数定义后5行内无 _write_event）
body=$(awk '/def _commit_reply_success/,/^def /' services/agent/wechat-rpa/listen_chat.py | grep "_write_event" | head -5)
if [ -n "$body" ]; then
  echo "FAIL: _commit_reply_success 本体内含 _write_event 调用（违反 Invariant I2）"
  exit 1
fi
echo "PASS: _commit_reply_success 本体内无 _write_event 调用"
```

**失败判定**：断言1 无输出，或断言2 有输出 → FAIL

---

### BEHAVIOR-3：reasoning PII 二次过滤（Invariant I3 / I5）

**描述**：listen_chat.py 在写入 events.jsonl 前必须对 reasoning 字段调用 `filter_pii` 进行 PII 二次过滤。即使中台侧（wechat-draft.ts）已做第一闸，agent 侧仍执行第二闸。

**验收命令**：
```bash
# pytest 验证 PII 过滤行为
pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py::test_write_event_pii_filter -v
# 期望：PASSED

# grep 验证源码含 filter_pii 调用
result=$(grep -n "filter_pii" services/agent/wechat-rpa/listen_chat.py)
if [ -z "$result" ]; then
  echo "FAIL: listen_chat.py 未找到 filter_pii 调用"
  exit 1
fi
echo "PASS: filter_pii 调用确认: $result"
```

**失败判定**：pytest 失败，或 grep 无输出 → FAIL

---

### BEHAVIOR-4：主链路不阻塞（NFR-1 / Invariant F-2.4）

**描述**：`_write_event` 写入失败时只记录告警日志，不抛异常，不阻塞主链路消息发送流程。`_STATE_DIR` 不可写时微信回复仍正常发出。

**验收命令**：
```bash
# pytest 验证软失败行为
pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py::test_write_event_soft_fail -v
# 期望：PASSED（无异常抛出）

# grep 验证软失败代码路径
result=$(grep -n "except.*Exception.*exc.*_log\|write_event failed" services/agent/wechat-rpa/listen_chat.py)
if [ -z "$result" ]; then
  echo "FAIL: listen_chat.py 未找到 write_event 软失败异常处理"
  exit 1
fi
echo "PASS: 软失败路径确认: $result"
```

**失败判定**：pytest 失败，或 grep 无输出 → FAIL

---

### BEHAVIOR-5：switch_customer / reply_sent 事件写入完整性

**描述**：一次完整的 AI 回复流程（draft-generate → DELIVERED）后，events.jsonl 必须新增一行 `reply_sent` 事件，包含所有必需字段（v/event_id/date/type/contact/stage/reasoning/ts），且 reasoning 不超过 30 字。

**验收命令**：
```bash
# pytest 验证事件写入完整性
pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py::test_write_event_creates_jsonl -v
# 期望：PASSED

# 验证 reasoning 截断
pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py::test_write_event_reasoning_truncate -v
# 期望：PASSED

# 真机等价断言（CI 内）：
# 真机段等价断言：xian-rog 发一条微信消息 → events.jsonl 新增 reply_sent 行
# TODO: 真机验收完成后在 sprints/07152230-line04-events-writer/evidence/ 存截图 + events.jsonl 片段
```

**失败判定**：任一 pytest 失败 → FAIL

---

### BEHAVIOR-6：draft_reasonings 字典传递链路完整性（FR-1）

**描述**：listen_chat.py 中存在 `draft_reasonings` 字典，Phase 1 循环中写入 reasoning，Phase 2 循环中读取 reasoning 供 `_write_event` 使用。

**验收命令**：
```bash
# grep 验证 draft_reasonings 字典存在
result=$(grep -n "draft_reasonings" services/agent/wechat-rpa/listen_chat.py)
if [ -z "$result" ]; then
  echo "FAIL: listen_chat.py 未找到 draft_reasonings 字典"
  exit 1
fi
echo "PASS: draft_reasonings 存在: $(echo "$result" | head -3)"
```

**失败判定**：grep 无输出 → FAIL

---

### BEHAVIOR-7：stage 取值域断言（Invariant I4）

**描述**：本刀 `_write_event` 写入的 `stage` 字段固定为 `null`。非 null 透传（从 API 返回的 `tags.stage` 字段透传 A1/A2/A3/A4）为 Phase 2 scope，本刀不实现。

**验收命令**：
```bash
# 确认 DELIVERED 点挂接处 stage=None（即写入 null）
result=$(grep -n "stage=None\|\"stage\": null\|stage.*None" services/agent/wechat-rpa/listen_chat.py)
if [ -z "$result" ]; then
  echo "FAIL: listen_chat.py 未找到 stage=None 写入（本刀要求 stage 固定为 null）"
  exit 1
fi
echo "PASS: stage=None 确认: $result"
```

**失败判定**：grep 无输出 → FAIL

---

### BEHAVIOR-8：build-modules 双路同步（CP-08）

**描述**：`services/agent/build-modules/line04/wechat-rpa/listen_chat.py` 必须与主路径 `services/agent/wechat-rpa/listen_chat.py` 保持 diff 为零（draft_reasonings + _write_event + DELIVERED 挂接三处同步）。打包版本与测试版本行为一致。

**验收命令**：
```bash
# grep 验证 build-modules 含 draft_reasonings
result_bm=$(grep -n "draft_reasonings" services/agent/build-modules/line04/wechat-rpa/listen_chat.py 2>/dev/null)
if [ -z "$result_bm" ]; then
  echo "FAIL: build-modules/listen_chat.py 未同步 draft_reasonings"
  exit 1
fi
echo "PASS: build-modules draft_reasonings 同步确认"

# grep 验证 build-modules 含 _write_event
result_bm2=$(grep -n "_write_event" services/agent/build-modules/line04/wechat-rpa/listen_chat.py 2>/dev/null)
if [ -z "$result_bm2" ]; then
  echo "FAIL: build-modules/listen_chat.py 未同步 _write_event"
  exit 1
fi
echo "PASS: build-modules _write_event 同步确认"
```

**失败判定**：任一 grep 无输出 → FAIL

---

## 全量 pytest 验收命令

```bash
# manual:bash — 完整 CI 验收命令序列

# 1. 本刀新增测试
pytest sprints/07152230-line04-events-writer/tests/test_events_writer.py -v
# 期望：4 PASSED，0 FAILED，0 SKIPPED

# 2. 骨架测试（前三刀，保持全绿）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py -v
# 期望：全绿

# 3. smoke 脚本
bash .github/workflows/scripts/smoke/line04-events-writer-smoke.sh
# 期望：6 节全绿，exit 0

# 4. BEHAVIOR-1 唯一写者断言
grep -r "events.jsonl" services/agent/wechat-rpa/overlay/ --include="*.py" -l 2>/dev/null | grep -v "__pycache__"
# 期望：无输出

# 5. BEHAVIOR-2（继承自原 BEHAVIOR-9）挂点断言
grep -n '_write_event("reply_sent"' services/agent/wechat-rpa/listen_chat.py
# 期望：有输出

# 6. BEHAVIOR-7 stage=None 断言
grep -n "stage=None\|\"stage\": null\|stage.*None" services/agent/wechat-rpa/listen_chat.py
# 期望：有输出
```

---

## 判定点登记表

| 判定点 ID | BEHAVIOR | 描述 | 验收方式 | 类型 |
|---|---|---|---|---|
| CP-01 | BEHAVIOR-1 | overlay 目录无 events.jsonl 写入 | grep 无输出 | 自动 |
| CP-02 | BEHAVIOR-2 | reply_sent 在 DELIVERED 点，不在 _commit_reply_success 本体内 | grep 断言 | 自动 |
| CP-03 | BEHAVIOR-3 | reasoning 写入前 filter_pii 二次过滤 | pytest | 自动 |
| CP-04 | BEHAVIOR-5 | reasoning 截断到 ≤30 字 | pytest | 自动 |
| CP-05 | BEHAVIOR-4 | _STATE_DIR 不可写时软失败 | pytest | 自动 |
| CP-06 | BEHAVIOR-6 | draft_reasonings 字典存在于 listen_chat.py | grep | 自动 |
| CP-07 | BEHAVIOR-2 | _write_event("reply_sent") 调用在 DELIVERED 点（_commit_reply_success 后） | grep | 自动 |
| CP-08 | BEHAVIOR-8 | build-modules 副本与主路径同步（draft_reasonings + _write_event） | grep | 自动 |
| CP-15 | BEHAVIOR-7 | stage 字段本刀写入固定为 null（非 null 透传为 Phase 2 scope） | grep | 自动 |
| CP-09 | BEHAVIOR-5 | events.jsonl 新增行包含所有必需字段 | pytest | 自动 |
| CP-10 | BEHAVIOR-5 | reasoning=None 时 reasoning 字段为 null（不崩溃） | pytest | 自动 |
| CP-11 | BEHAVIOR-3 | pii_filter 导入失败时兜底（lambda x: x）不崩溃 | 代码审查 | 人工 |
| CP-12 | BEHAVIOR-5 | 真机：发消息 → events.jsonl 新增 reply_sent 行（含 reasoning 非 null） | xian-rog 手动 | 真机 |
| CP-13 | BEHAVIOR-3 | 真机：events.jsonl 中无 PII（手机/微信号/身份证） | xian-rog 手动 grep | 真机 |
| CP-14 | BEHAVIOR-4 | 真机：主链路发送时间无可观察延迟差异 | xian-rog 人工观察 | 真机 |
