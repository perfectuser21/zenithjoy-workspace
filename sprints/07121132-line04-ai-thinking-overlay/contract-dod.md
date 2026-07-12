# Contract DoD — Line04 AI 思考浮窗

sprint_dir: sprints/07121132-line04-ai-thinking-overlay
task_id: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb
round: 1
date: 2026-07-12

---

## DoD 条目（[BEHAVIOR] 可测试行为断言）

### [BEHAVIOR] [BEHAVIOR-1] events.jsonl 写入正确性与唯一写者约束

**场景**：listen_chat 在 DELIVERED 调用点（:4787）追加 reply_sent 事件，浮窗只读。

**验收命令（manual:bash）**：
```bash
# 1a. 单元：O_APPEND 写入，行 schema 合规
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_reply_sent_schema -v

# 1b. grep 断言：浮窗代码中无 events.jsonl 写入行
! grep -rP "open\(.*events\.jsonl.*['\"][wa]" services/line04/overlay/

# 1c. 字段完整性：v/event_id/date/type/contact/stage/reasoning/ts 全部存在
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_event_schema_fields -v
```

**通过标准**：
- reply_sent 行包含所有必需字段，reasoning 长度 ≤30 字符
- 浮窗目录下无 events.jsonl 写入代码（grep 输出为空）
- event_id 格式为 `{epoch_ms}-{6位hex}-{seq}`

---

### [BEHAVIOR] [BEHAVIOR-2] events.jsonl 并发写读无丢失、坏行容错、幂等去重

**场景**：双线程并发写 10000 行；含坏行/半行时浮窗 tail 继续读；相同 event_id 重放不重计数。

**验收命令（manual:bash）**：
```bash
# 2a. 并发写读（10000 行，无丢失无重复）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_concurrent_write_read -v

# 2b. 坏行容错（含非 JSON 行，读侧不崩）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_bad_line_tolerance -v

# 2c. event_id 幂等去重
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_event_id_dedup -v

# 2d. 跨两代轮转回放（5MB → .1 → 新建，两代合并读）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_rotation_replay -v
```

**通过标准**：
- 并发写 10000 行后读侧计数 = 10000（无丢失，无因 O_APPEND 产生的重复）
- 含任意数量坏行时 tail_reader 仍输出有效行，不抛异常
- 重放相同 event_id 的行不增加今日计数

---

### [BEHAVIOR] [BEHAVIOR-3] PII 双硬闸：reasoning 不得含手机号/微信号，含"复述客户原话"场景必须过滤

**场景**：LLM 在 reasoning 中复述了客户原话（含手机号）→ 中台侧过滤 → agent 写 events 前二次过滤 → events.jsonl 中无 PII。

**验收命令（manual:bash）**：
```bash
# 3a. 中台侧 PII 过滤（含"复述客户原话"用例）
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts --reporter=verbose -t "PII"

# 3b. agent 层 PII 二次过滤（auto_reply.py 层，与中台同一纯函数）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_pii_double_gate -v

# 3c. 边界用例：手机号 13800138000 / 微信号 wxid_xxx / 身份证 110101199001011234
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py::test_pii_patterns -v
```

**通过标准**：
- 中台返回的 reasoning 不含手机号/微信号/身份证正则命中内容
- events.jsonl 写入的 reasoning 经二次过滤，无 PII
- "复述客户原话"用例（reasoning = "客户说他的手机是 13800138000"）→ 替换为降级文案

---

### [BEHAVIOR] [BEHAVIOR-4] 中台合同扩展：{reply, tags, reasoning} 三路断言

**场景**：wechat-draft.ts generateDraft 返回体包含 reasoning 字段，向后兼容；兜底路径 reasoning 降级；PII 命中降级。

**验收命令（manual:bash）**：
```bash
# 4a. 正常路径：LLM 返回 reasoning → 响应体含 reasoning，≤30 字
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts -t "reasoning normal path"

# 4b. 兜底缺省路径：:548 正则兜底，reasoning 缺失 → 降级文案「已回复 {联系人}」
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts -t "reasoning fallback"

# 4c. PII 命中降级：reasoning 含手机号 → 替换降级文案
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts -t "reasoning PII degraded"

# 4d. 向后兼容：旧 LLM 返回 {reply, tags}（无 reasoning）→ agent 侧渲染降级文案，不崩
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts -t "reasoning backward compat"
```

**通过标准**：
- 正常路径：`response.reasoning` 存在，`response.reasoning.length <= 30`
- 兜底路径：`response.reasoning` 为空或 undefined，agent 渲染「已回复 {联系人}」
- PII 路径：`response.reasoning` 不含手机号/微信号正则命中
- 向后兼容：无 reasoning 字段时不抛异常

---

### [BEHAVIOR] [BEHAVIOR-5] 浮窗软检测：pywebview/WebView2 缺失时降级，不 spawn，写 diag

**场景**：spawn 前检测两项软依赖，任一缺失 → 不 spawn 浮窗进程，写 overlay-diag.json。

**验收命令（manual:bash）**：
```bash
# 5a. pywebview 不可用时降级
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_preflight.py::test_pywebview_missing -v

# 5b. WebView2 注册表缺失时降级
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_preflight.py::test_webview2_missing -v

# 5c. 两项均存在时通过
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_preflight.py::test_preflight_pass -v

# 5d. 降级时写 overlay-diag.json（字段完整性）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_preflight.py::test_diag_written_on_failure -v
```

**通过标准**：
- pywebview_missing：`preflight()` 返回 `{ok: False, reason: 'pywebview_missing'}`，overlay-diag.json 写入
- webview2_missing：`preflight()` 返回 `{ok: False, reason: 'webview2_missing'}`，overlay-diag.json 写入
- 两项均存在：`preflight()` 返回 `{ok: True}`
- diag.json 含全部 12 字段

---

### [BEHAVIOR] [BEHAVIOR-6] 崩溃熔断：60min 内 8 次存活<60s → 熔断静默

**场景**：守活循环检测到 8 次快速崩溃后进入熔断，停止重拉；agent 重启后复位。

**验收命令（manual:bash）**：
```bash
# 6a. 熔断触发（模拟 8 次存活 <60s）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py::test_circuit_breaker_trigger -v

# 6b. 熔断后不重拉
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py::test_circuit_open_no_respawn -v

# 6c. agent 重启后熔断复位
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py::test_circuit_reset_on_agent_restart -v

# 6d. 用户主动关闭（退出码 0 + user_closed=true）→ 守活不重拉
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py::test_user_close_no_respawn -v
```

**通过标准**：
- 8 次存活 <60s 后 `circuit_open == True`，守活停止重拉
- 熔断期间 overlay-diag.json `circuit_open == true`
- agent 重启后 `restart_count_60min` 归零，`circuit_open == false`
- 用户关闭后 overlay-state.json `user_closed == true`，守活不重拉

---

### [BEHAVIOR] [BEHAVIOR-7] listen_chat 明文日志清零

**场景**：4687/4691/4696 三处 `content[:20]` 明文日志改调脱敏函数，grep 断言清零。

**验收命令（manual:bash）**：
```bash
# 7a. grep 清零断言
result=$(grep -nP 'content\[:20\]' services/agent/wechat-rpa/listen_chat.py 2>/dev/null)
if [ -n "$result" ]; then
  echo "FAIL: 仍有明文日志: $result"
  exit 1
else
  echo "PASS: content[:20] 字样已清零"
fi

# 7b. 脱敏函数单测（确认替换逻辑正确）
pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_pii_filter.py::test_log_redaction -v
```

**通过标准**：
- `grep -nP 'content\[:20\]' services/agent/wechat-rpa/listen_chat.py` 输出为空
- 脱敏函数对 "hello 13800138000" → 输出不含原始手机号

---

### [BEHAVIOR] [BEHAVIOR-8] smoke 全链路通过（CI 集成验收）

**场景**：所有 CI 检查均为真绿（非假绿占位）。

**验收命令（manual:bash）**：
```bash
# 完整 smoke 一键执行
bash .github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh

# 验证 CI 接入
grep -r "line04-ai-overlay-smoke" .github/workflows/ | head -5
```

**通过标准**：
- smoke 脚本包含 ≥5 行实质内容，非 `exit 0` 占位
- smoke 脚本接入 CI（.github/workflows/ 中有引用）
- 所有 pytest / vitest / grep 断言均通过，脚本退出码 0

---

## DoD 汇总表

| 编号 | 行为描述 | 验收形式 | 状态 |
|------|---------|---------|------|
| BEHAVIOR-1 | events.jsonl 写入正确性与唯一写者约束 | pytest + grep | ⬜ |
| BEHAVIOR-2 | 并发写读无丢失、坏行容错、幂等去重 | pytest | ⬜ |
| BEHAVIOR-3 | PII 双硬闸（含复述客户原话用例） | pytest + vitest | ⬜ |
| BEHAVIOR-4 | 中台合同 reasoning 三路断言 | vitest | ⬜ |
| BEHAVIOR-5 | 浮窗软检测降级+diag写入 | pytest | ⬜ |
| BEHAVIOR-6 | 崩溃熔断触发+复位+用户关闭 | pytest | ⬜ |
| BEHAVIOR-7 | listen_chat 明文日志 grep 清零 | bash grep | ⬜ |
| BEHAVIOR-8 | smoke 全链路 CI 真绿 | bash smoke | ⬜ |

**[BEHAVIOR] 条目数：8**
**manual:bash 验收命令：存在（每条 BEHAVIOR 均含）**
**## E2E 验收段：存在（见 contract-draft.md 第五节）**
