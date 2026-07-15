# Contract Draft — Line04 浮窗 events_writer 重新实现

sprint_dir: sprints/07152230-line04-events-writer
task_id: af47b1da-0846-4300-bb1a-a733be50c9bd
contract_version: 1.0
date: 2026-07-15
branch: cp-07152209-ws-af47b1da

---

## 背景摘要

Path 4「AI 思考浮窗」前三刀已建立基础设施（overlay_window.py / pii_filter / watchdog / preflight / node 接线），但浮窗内容永远空白。根因：`events.jsonl` 完全没有写入方。

本刀目标：在 `listen_chat.py` DELIVERED 点补写 `_write_event` 逻辑，修复 `reasoning` 字段传递链路缺失，让浮窗真实显示回复动态 + 推理摘要。

---

## Invariant 继承（前三刀 12 条，本刀原样继承）

| # | 约束 |
|---|---|
| I1 | 唯一写者：events.jsonl 唯一写者 = listen_chat（O_APPEND 追加写）；overlay 侧严禁写入 |
| I2 | 挂点锁定：reply_sent 挂点在 `_commit_reply_success` 调用行之后，不在其本体内部 |
| I3 | reasoning 来源：单一来源 = LLM 合同 JSON 字段（≤30字），写入前 `filter_pii` 二次过滤 |
| I4 | stage 取值域：customer_stage 复用 A1/A2/A3/A4/null，禁另造 |
| I5 | PII 双硬闸：中台返回前截断（第一闸）+ listen_chat 写 events 前 filter_pii（第二闸） |
| I6 | 浮窗软检测不入 manifest requiredChecks |
| I7 | 熔断守活：60min 内 8 次存活<60s → 熔断静默（watchdog.py 已有，本刀不动） |
| I8 | 用户关闭：exit_code 0 + user_closed=true，守活只对非零退出码重拉 |
| I9 | 状态目录：events.jsonl 路径在 `_STATE_DIR`（`ZJ_STATE_DIR` 或 `C:\Users\Public`），严禁其他硬编码 |
| I10 | event_id 幂等去重：按整串精确匹配；epoch_ms 仅展示排序用 |
| I11 | 浮窗只观察：overlay 进程绝不干预微信窗口 |
| I12 | 异常文案：一律温和文案，禁"错误/中断/!"字样 |

---

## 交付范围（本刀新增）

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `services/agent/wechat-rpa/listen_chat.py` | 新增 `draft_reasonings` 字典 + `_write_event` 函数 + DELIVERED 点挂接 |
| `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` | 同步同 diff（双路同步） |

### 新增文件

| 文件 | 说明 |
|---|---|
| `sprints/07152230-line04-events-writer/tests/test_events_writer.py` | 4 个 pytest 用例（failing first） |
| `.github/workflows/scripts/smoke/line04-events-writer-smoke.sh` | 第三刀 smoke（6 节） |

### 禁止重做的地基文件

- `services/agent/wechat-rpa/overlay/pii_filter.py`
- `services/agent/wechat-rpa/overlay/preflight.py`
- `services/agent/wechat-rpa/overlay/watchdog.py`
- `services/agent/wechat-rpa/overlay/overlay_window.py`
- `services/agent/modules/line04/handlers/overlay.ts`
- `apps/api/src/services/wechat-draft.ts`
- `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh`
- `.github/workflows/scripts/smoke/line04-ai-overlay-r2-smoke.sh`

---

## 技术规格

### `draft_reasonings` 字典（FR-1）

```python
# Phase 1 初始化（与 drafts 并列）
draft_reasonings: Dict[int, Optional[str]] = {}

# Phase 1 draft-generate 循环内
draft_reasonings[id(m)] = (result or {}).get("reasoning")

# Phase 2 发送循环内
reasoning = draft_reasonings.get(id(m))
```

### `_write_event` 函数签名（FR-2）

```python
def _write_event(
    event_type: str,
    contact: str,
    reasoning: Optional[str] = None,
    stage: Optional[str] = None,
) -> None:
```

事件结构：

```json
{
    "v": 1,
    "event_id": "<epoch_ms>-<6位hex>-1",
    "date": "YYYY-MM-DD",
    "type": "<event_type>",
    "contact": "<contact>",
    "stage": "<A1|A2|A3|A4|null>",
    "reasoning": "<filter_pii(reasoning[:30]) or null>",
    "ts": 1234567890
}
```

### DELIVERED 点挂接（FR-3）

```python
# 在 _commit_reply_success(m, last_preview) 调用之后（if ok: 分支内）
_write_event(
    "reply_sent",
    contact=m["sender"],
    reasoning=draft_reasonings.get(id(m)),
    stage=None,
)
```

---

## 判定点登记表

| 判定点 ID | 描述 | 来源 Invariant/FR | 验收方式 |
|---|---|---|---|
| CP-01 | events.jsonl 唯一写者为 listen_chat，overlay 目录无写入调用 | I1 | grep BEHAVIOR-8 回归 |
| CP-02 | reply_sent 挂点在 `_commit_reply_success` 调用行之后，不在其本体内 | I2 | grep BEHAVIOR-9 回归 |
| CP-03 | reasoning 写入前执行 filter_pii 二次过滤 | I3 / I5 | pytest test_write_event_pii_filter |
| CP-04 | reasoning 截断到 ≤30 字 | I3 / F-2.2 | pytest test_write_event_reasoning_truncate |
| CP-05 | `_STATE_DIR` 不可写时软失败，主链路继续 | F-2.4 / NFR-1 | pytest test_write_event_soft_fail |
| CP-06 | `draft_reasonings` 字典存在于 listen_chat.py | F-1.1 | smoke 节③ grep |
| CP-07 | `_write_event` 调用存在于 DELIVERED 点附近（4790-4800 行） | F-3.1 | smoke 节② grep |
| CP-08 | build-modules 副本与主路径同步 | F-4.1 | smoke diff 断言 |
| CP-09 | events.jsonl 新增行包含所有必需字段 | F-2.2 | pytest test_write_event_creates_jsonl |
| CP-10 | reasoning=None 时事件行 reasoning 字段为 null（不崩溃） | NFR-3 | pytest test_write_event_creates_jsonl |

---

## E2E 验收

### CI 层验收（自动）

| 层级 | 内容 | 通过标准 |
|---|---|---|
| pytest unit | test_events_writer.py 4 case | 全绿，无 SKIP |
| pytest unit | test_events_pipeline.py（骨架，已有） | 全绿 |
| smoke sh | line04-events-writer-smoke.sh 6 节 | 全绿 |
| grep 回归 | overlay 目录无 events.jsonl 写入 | grep 无输出（BEHAVIOR-8） |
| grep 回归 | `_write_event` 在 DELIVERED 点 | grep 有输出（BEHAVIOR-9） |
| 全量 CI | 现有 overlay/preflight/lifecycle 单测 | 不退绿 |

### 真机层验收（xian-rog，手动）

```bash
# manual:bash — 真机验收步骤（xian-rog staging 环境执行）

# 步骤 1：发送真实微信消息，等待 AI 自动回复
# （通过测试微信账号发送一条消息给绑定的客户账号）

# 步骤 2：检查 events.jsonl 是否新增 reply_sent 行
$env_file = "$env:ZJ_STATE_DIR\events.jsonl"
if (-not $env:ZJ_STATE_DIR) { $env_file = "C:\Users\Public\events.jsonl" }
Get-Content $env_file | Select-Object -Last 5

# 期望输出含：
# {"v":1,"event_id":"...","type":"reply_sent","contact":"...","reasoning":"...（非null）",...}

# 步骤 3：验证无 PII
Get-Content $env_file | Select-String -Pattern "1[3-9]\d{9}|wxid_|身份证"
# 期望：无匹配输出

# 步骤 4：浮窗截图验证（人工）
# 期望：浮窗显示「推理」卡片 + 「✓ 已送达」角标，非空白

# 步骤 5：主链路延迟验证（人工观察）
# 期望：发送时间与未加 write_event 前无可观察延迟差异
```

---

## 开发顺序（强制）

```
commit-1：test_events_writer.py（4 个 failing test）+ smoke sh 骨架（≥5行，非 exit 0）
commit-2：listen_chat.py 实现（draft_reasonings + _write_event + DELIVERED 挂接 + build-modules 同步）→ 让 commit-1 的测试全绿
commit-3：test-registry.yaml 注册 + CI wiring（如需）
```

**第一个 commit 必须是 E2E/smoke 和测试，不是实现。**

---

## 风险与注意事项

1. **`_commit_reply_success` 被多处调用**：本函数被 replied/dup/roster_gate 终态复用，无 message_id 场景不应写 reply_sent。挂点必须在 `if ok:` 分支内的外层调用处，不在函数本体内。
2. **pii_filter 导入延迟兜底**：若 ImportError，`filter_pii = lambda x: x`，不崩溃但 PII 不过滤（告警日志）。
3. **build-modules 双路同步**：每次改主路径必须同步改副本，遗漏会导致打包版本与测试版本行为不一致。
4. **stage 字段暂缺**：Phase 2 PRD 再扩展 API 返回的 `tags.stage` 透传，本刀写入 `null`。
