# Sprint PRD — Line04 浮窗 events_writer 重新实现

task_id: af47b1da-0846-4300-bb1a-a733be50c9bd
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
journey_type: user_facing
target_environment: windows_cloud
thickness: thin
sprint_dir: sprints/07152230-line04-events-writer
date: 2026-07-15

## Journey 定位

**客户私域 AI 接管**（Path 4）—— 第四刀（事件写者补全）。

前三刀（PR#1239/#1245/#1256/#1309/#1311）已建立全局流水版浮窗基础设施：
- overlay_window.py 已可读取 events.jsonl 并渲染到浮窗 UI
- preflight/watchdog/pii_filter 全部就位
- node 侧 overlay handler 接线完成

**本刀根因**：真机排障（2026-07-15）发现浮窗弹出但内容永远空白。根因确认：
events.jsonl 完全没有写入方。历史上 PR#1239 曾在 contract-dod.md 的 BEHAVIOR-9 中
声明 listen_chat.py 第 4787 行 DELIVERED 点应调用 write_event，但实际实现从未落地——
listen_chat.py 目前仅存储 `drafts[id(m)] = reply`，`reasoning` 字段被
`result.get("reasoning")` 丢弃，且无任何 events.jsonl 追加写逻辑。

本刀：在 listen_chat.py DELIVERED 确认点（第 4794 行 `_commit_reply_success`
调用点之前）补写 events.jsonl 的 write_event 逻辑，同步修复 reasoning
字段在 drafts 字典中的传递链路缺失。

路径声明：本 PR 把 Path 4「AI 思考浮窗」从 thin-有基础设施但写者缺失（浮窗空白）
推到 thin-数据管道完整（浮窗真实显示回复动态+推理摘要）。

---

## 地基声明（禁止重做）

以下均已在前三刀交付，本刀**直接复用，禁止重写**：

- `services/agent/wechat-rpa/overlay/pii_filter.py`（PII 过滤纯函数 `filter_pii`）
- `services/agent/wechat-rpa/overlay/preflight.py`（软检测）
- `services/agent/wechat-rpa/overlay/watchdog.py`（熔断守活）
- `services/agent/wechat-rpa/overlay/overlay_window.py`（窗口本体 + tail 消费 + 渲染）
- `services/agent/modules/line04/handlers/overlay.ts`（node 侧接线）
- `apps/api/src/services/wechat-draft.ts`（reasoning 合同扩展 + PII 硬闸；已返回 `reasoning` 字段）
- `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh`（第一刀 smoke）
- `.github/workflows/scripts/smoke/line04-ai-overlay-r2-smoke.sh`（第二刀 smoke）
- `sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py`（pipeline 骨架测试，本刀补真实实现让其真绿）

---

## Invariant 约束（继承前三刀 12 条，本刀无新增）

1. **唯一写者**：events.jsonl 唯一写者 = listen_chat（O_APPEND 追加写）；浮窗/overlay 侧严禁写入（已有 BEHAVIOR-8 grep 断言保护）
2. **挂点锁定**：reply_sent 事件挂点 = listen_chat.py DELIVERED 确认成功点（`_commit_reply_success` 调用行附近），禁挂 `_commit_reply_success` 本体内部（该函数还被 replied/dup/roster_gate 终态复用，无 message_id 场景不应写 reply_sent）
3. **reasoning 来源**：单一来源 = LLM 合同 JSON 字段（≤30字，wechat-draft.ts 已截断）；listen_chat 侧写入前做 PII 二次过滤（调 `pii_filter.filter_pii`）
4. **stage 取值域**：customer_stage 复用既有 A1/A2/A3/A4/null，禁另造
5. **PII 双硬闸**：中台返回前截断（第一闸，wechat-draft.ts 已有）+ listen_chat 写 events 前 `filter_pii` 二次执行（第二闸，本刀新增）
6. **浮窗软检测不入 manifest requiredChecks**（保持现状）
7. **熔断守活**：60min 内 8 次存活<60s → 熔断静默（watchdog.py 已有，本刀不动）
8. **用户关闭处理**：exit_code 0 + user_closed=true，守活只对非零退出码重拉（现有，不动）
9. **状态目录**：events.jsonl 路径在 `_STATE_DIR` 下（`ZJ_STATE_DIR` 环境变量或 `C:\Users\Public`），严禁 C:\Users\Public 以外的硬编码路径
10. **event_id 幂等去重**：按整串精确匹配；epoch_ms 仅展示排序用
11. **浮窗只观察**：overlay 进程绝不干预微信窗口（防两进程拉扯）
12. **异常文案**：一律温和文案，禁"错误/中断/!"字样

---

## 根因技术分析

### 缺失链路 1：reasoning 未在 drafts 字典中传递

**当前代码**（listen_chat.py 约 4734-4741 行）：
```python
reply = (result or {}).get("reply")
# ... 跳过 if not reply
drafts[id(m)] = reply          # 只存 reply，reasoning 被丢弃
draft_message_ids[id(m)] = (result or {}).get("message_id")
```

**修复**：新增 `draft_reasonings` 字典，同步存储 `result.get("reasoning")`。

### 缺失链路 2：DELIVERED 点无 write_event 调用

**当前代码**（listen_chat.py 约 4792-4794 行，`ok=True` 分支）：
```python
_commit_reply_success(m, last_preview)  # DELIVERED
```
无任何 events.jsonl 写入。

**修复**：在 `_commit_reply_success` 调用后（不在其本体内），调用新实现的 `_write_event` 函数。

### 缺失链路 3：`_write_event` 函数本身不存在

需在 listen_chat.py 中实现 `_write_event(event_type, sender, reasoning, stage)` 纯函数：
- 构造合规 event 字典（字段：v/event_id/date/type/contact/stage/reasoning/ts）
- PII 二次过滤（调 `overlay.pii_filter.filter_pii`）
- reasoning 截断到 ≤30 字
- O_APPEND 模式追加写到 `os.path.join(_STATE_DIR, "events.jsonl")`
- 异常软失败：写入失败只 `_log` 告警，不影响主链路

### 缺失链路 4：build-modules 双路同步

`services/agent/build-modules/line04/wechat-rpa/listen_chat.py` 是打包用副本，
所有修改必须双路同步（与主路径保持一致）。

---

## 累积 FR

### FR-1：reasoning 字段传递链路修复

**F-1.1** 新增 `draft_reasonings: Dict[int, Optional[str]] = {}` 字典（与 `drafts` 并列）  
**F-1.2** Phase 1（并行 draft-generate 循环）中：`draft_reasonings[id(m)] = (result or {}).get("reasoning")`  
**F-1.3** Phase 2（串行发送循环）中：`reasoning = draft_reasonings.get(id(m))` 取出备用  

### FR-2：`_write_event` 函数实现

**F-2.1** 在 listen_chat.py 中实现 `_write_event` 函数，签名：
```python
def _write_event(
    event_type: str,
    contact: str,
    reasoning: Optional[str] = None,
    stage: Optional[str] = None,
) -> None:
```

**F-2.2** 函数内部构造事件：
```python
{
    "v": 1,
    "event_id": f"{int(time.time()*1000)}-{uuid4().hex[:6]}-1",
    "date": time.strftime("%Y-%m-%d"),
    "type": event_type,
    "contact": contact,
    "stage": stage,
    "reasoning": filter_pii(reasoning[:30]) if reasoning else None,
    "ts": int(time.time()),
}
```

**F-2.3** O_APPEND 追加写到 `os.path.join(_STATE_DIR, "events.jsonl")`：
```python
events_path = os.path.join(_STATE_DIR, "events.jsonl")
with open(events_path, "a", encoding="utf-8") as f:
    f.write(json.dumps(row, ensure_ascii=False) + "\n")
```

**F-2.4** 异常软失败：`except Exception as exc: _log(f"write_event failed: {exc}")`，主链路继续

**F-2.5** `pii_filter` 导入：在 listen_chat.py 顶部新增 `from overlay.pii_filter import filter_pii`（延迟导入兜底：若 ImportError 则 `filter_pii = lambda x: x`）

### FR-3：DELIVERED 点挂接 write_event

**F-3.1** 在 listen_chat.py 第 4794 行 `_commit_reply_success(m, last_preview)` 调用之后（同一 `if ok:` 分支内），追加：
```python
_write_event(
    "reply_sent",
    contact=m["sender"],
    reasoning=draft_reasonings.get(id(m)),
    stage=None,   # stage 字段暂缺（API 返回的 tags.stage 未透传到 listen_chat，Phase 2 PRD 再扩展）
)
```

**F-3.2** 不在 `_commit_reply_success` 本体内部写 events（Invariant-2 保护）

### FR-4：build-modules 双路同步

**F-4.1** `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` 与主路径保持完全一致（相同 diff）

### FR-5：测试补全（让骨架测试真绿）

**F-5.1** `sprints/07121132-line04-ai-thinking-overlay/tests/test_events_pipeline.py` 的 TODO 导入替换为真实实现：
- `write_line` 已是内联实现，无需改动
- BEHAVIOR-9 的挂点回归：`grep -n "reply_sent\|DELIVERED" services/agent/wechat-rpa/listen_chat.py | grep -E "479[0-9]:"` 有输出

**F-5.2** 新增 pytest 测试文件 `sprints/07152230-line04-events-writer/tests/test_events_writer.py`，覆盖：
- `test_write_event_creates_jsonl`：调 `_write_event` 后 events.jsonl 产生合规行
- `test_write_event_pii_filter`：reasoning 含手机号 → 写入行中被替换
- `test_write_event_reasoning_truncate`：reasoning >30字 → 写入行截断到 ≤30字
- `test_write_event_soft_fail`：`_STATE_DIR` 指向不可写路径 → 不抛异常，仅 log

**F-5.3** 新增 smoke 脚本 `.github/workflows/scripts/smoke/line04-events-writer-smoke.sh`（第三刀 smoke）：
- 节 ①：pytest test_events_writer.py 全绿
- 节 ②：grep 断言 listen_chat.py 含 `_write_event` 调用（4790-4800 行附近）
- 节 ③：grep 断言 `draft_reasonings` 字典存在于 listen_chat.py
- 节 ④：BEHAVIOR-8 只读保护回归（overlay 目录无 events.jsonl 写入调用）
- 节 ⑤：BEHAVIOR-9 挂点回归（reply_sent 不在 `_commit_reply_success` 本体内）
- 节 ⑥：真机段等价断言注释（`# 真机段等价断言：xian-rog 发一条微信消息 → events.jsonl 新增 reply_sent 行`）

**F-5.4** `test-registry.yaml` 新增 smoke 入口

---

## NFR

- **NFR-1 主链路零延迟**：`_write_event` 同步写入，但写入失败软失败；整条 I/O 路径 ≤5ms（本地追加写），不加锁（O_APPEND 是原子操作，单写者场景已满足）
- **NFR-2 CI 平台**：windows_cloud（GitHub Actions windows-latest runner），与前三刀一致
- **NFR-3 向后兼容**：无 `reasoning` 字段时（`draft_reasonings.get(id(m))` 返回 None）→ events.jsonl 中 `reasoning: null`，浮窗 overlay_window.py 已有 `ev.reasoning || ''` 兜底
- **NFR-4 build-modules 同步**：打包用副本与主路径同步，不单独维护差异

---

## CI 验收条件

| 层级 | 验收内容 | 通过标准 |
|---|---|---|
| pytest unit | test_events_writer.py 4 case | 全绿，无 SKIP |
| pytest unit | test_events_pipeline.py（骨架，已有） | 全绿（无真实 write_event 导入依赖，内联实现） |
| smoke sh | line04-events-writer-smoke.sh 6 节 | 全绿 |
| grep 回归 | overlay 目录无写入 events.jsonl | grep 无输出 |
| grep 回归 | `_write_event` 调用在 DELIVERED 点 | grep 有输出 |
| 全量 CI | 现有 overlay/preflight/lifecycle 单测 | 不退绿 |

---

## 真机验收标准（xian-rog，staging 安装正式包后执行）

1. 发一条真实微信消息给客户 → `C:\Users\Public\events.jsonl`（或 `%ZJ_STATE_DIR%\events.jsonl`）新增 `reply_sent` 行，含 `reasoning` 字段（非 null）
2. 浮窗截图：显示「推理」卡片 + 「✓ 已送达」角标（非空白）
3. `events.jsonl` 中无 PII（手机号/微信号/身份证）
4. 主链路发送时间与未加 write_event 前无可观察延迟差异

> 真机段等价断言（CI 内）：节 ⑥ smoke 注释标记，真机完成后在 sprint 目录存截图 + events.jsonl 片段。

---

## 开发顺序（强制）

```
commit-1：test_events_writer.py（4 个 failing test）+ smoke sh 骨架（≥5行，非 exit 0）
commit-2：listen_chat.py 实现（draft_reasonings + _write_event + DELIVERED 挂接 + build-modules 同步）→ 让 commit-1 的测试全绿
commit-3：test-registry.yaml 注册 + CI wiring（如需）
```

**第一个 commit 必须是 E2E/smoke 和测试，不是实现。**
