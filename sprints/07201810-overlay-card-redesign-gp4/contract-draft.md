# Sprint Contract Draft（首轮）

task_id: 757c6ab8-985c-415d-8e4f-9749bd0709fc
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
sprint_dir: sprints/07201810-overlay-card-redesign-gp4
target_environment: windows_cloud
date: 2026-07-20

## Golden Path

[listen_chat.py 在 _gen_draft 调用前写 thinking 事件] → [overlay_window.py EventTailConsumer 以 tail_pointer.txt 恢复偏移量消费] → [overlay JS 接收 thinking 事件激活 setThinking() 蓝色动画] → [post_draft_generate 完成 → reply_sent 到达] → [中台 /api/wechat/customer-profile 返回三段论(need/budget/concern)+最近3条消息] → [overlay 画像卡渲染三段论字段] → [「查看画像」按钮可点击 → webbrowser.open 打开 CustomerProfilePage] → [全链路 exit 0]

---

## Step 1：tail_pointer.txt 持久化——EventTailConsumer 重启后不重放旧 event_id

**来源**：`[FROM_PRD]` — FR-1（F1.1/F1.2/F1.3）和 Gate A 前置门槛：overlay 重启后从 `_STATE_DIR/tail_pointer.txt` 恢复字节 offset，不重放旧 event_id。

**可观测行为**：`EventTailConsumer.__init__` 读取 `tail_pointer.txt` 并 `f.seek(offset)`；每次 `get_events()` 后将 `f.tell()` 写回 `tail_pointer.txt`；文件损坏/不存在时归零不崩溃。

**验证命令**：
```bash
# L1-1：tail_pointer 重启后 get_events 不返回旧 event_id（pytest）
cd /workspace && python -m pytest services/agent/wechat-rpa/tests/ -k "tail_pointer" -v 2>&1 | tail -20

# smoke: overlay 重启后 tail_pointer.txt 存在且为整数（L2-2）
ZJ_STATE_DIR=$(mktemp -d) python - <<'EOF'
import sys, os, json, time
os.makedirs(os.environ["ZJ_STATE_DIR"], exist_ok=True)
events_path = os.path.join(os.environ["ZJ_STATE_DIR"], "events.jsonl")
with open(events_path, "a") as f:
    f.write(json.dumps({"v":1,"event_id":"1000-aabbcc-1","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
c = EventTailConsumer(os.environ["ZJ_STATE_DIR"])
c.get_events()
ptr = os.path.join(os.environ["ZJ_STATE_DIR"], "tail_pointer.txt")
assert os.path.exists(ptr), f"FAIL: tail_pointer.txt 不存在"
val = open(ptr).read().strip()
assert val.isdigit(), f"FAIL: tail_pointer.txt 内容非整数: {val!r}"
print(f"OK tail_pointer={val}")
EOF
```

**硬阈值**：pytest `tail_pointer` 系列全 PASS；`tail_pointer.txt` 存在且为整数。

---

## Step 2：thinking 事件写入——_write_event 在 _gen_draft 调用前插入 thinking type

**来源**：`[FROM_PRD]` — FR-3（F3.1/F3.3）：`listen_chat.py` 约 :5700 `_gen_draft` 函数内部，在 `post_draft_generate` 调用前插入 `_write_event("thinking", sender)`；`thinking` type 时 `reasoning=None`、`text='思考中...'`。

**可观测行为**：`events.jsonl` 在 `post_draft_generate` 返回之前出现 `"type":"thinking"` 条目；thinking 事件不含 PII 字段（无 content/reply/reasoning 真实内容）。

**验证命令**：
```bash
# L1-2：thinking event 写入后 events.jsonl 不含 PII 字段（pytest grep）
cd /workspace && python -m pytest services/agent/wechat-rpa/tests/ -k "thinking_event_no_pii or thinking_pii" -v 2>&1 | tail -20

# L1-3：_write_event 三处调用点字段无污染（静态断言）
python3 - <<'EOF'
import ast, sys
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py").read()
# 检查 thinking 写入点存在
assert '_write_event("thinking"' in src or "_write_event('thinking'" in src, "FAIL: 缺 thinking 写入点"
# 检查三处调用点
calls = [l.strip() for l in src.splitlines() if "_write_event(" in l and not l.strip().startswith("#")]
print(f"OK: _write_event 调用点 {len(calls)} 处")
for c in calls:
    print(f"  {c[:80]}")
assert len(calls) >= 3, f"FAIL: 期望 ≥3 处调用点，实际 {len(calls)}"
EOF
```

**硬阈值**：`events.jsonl` 含 `"type":"thinking"` 且不含明文消息内容；`_write_event` 调用点 ≥3。

---

## Step 3：overlay setThinking() 激活——thinking 事件到达时调用前端动画

**来源**：`[FROM_PRD]` — FR-3（F3.2）：`overlay_window.py:675` 已有 `setThinking()` 死代码被激活：`thinking` event 到达时调用，参数为 `ev.text || '思考中...'`。PRD 注明"现状已满足，无需改动"。

**可观测行为**：`overlay_window.py:675` 行包含 `if (ev.type === 'thinking') { setThinking(ev.text || '思考中...'); return; }`；浮窗 HTML 含 `setThinking` 函数定义。

**验证命令**：
```bash
# 静态断言：overlay_window.py 含 setThinking 激活代码
python3 - <<'EOF'
src = open("/workspace/services/agent/wechat-rpa/overlay/overlay_window.py").read()
assert "setThinking" in src, "FAIL: 缺 setThinking 函数定义"
assert "ev.type === 'thinking'" in src or 'ev.type === "thinking"' in src, "FAIL: 缺 thinking 事件分发"
print("OK: setThinking 激活代码存在")
EOF
```

**硬阈值**：`overlay_window.py` 含 `setThinking` 定义及 `thinking` 事件分发逻辑。

---

## Step 4：cs_memory_longterm 三段论接入——/api/wechat/customer-profile 返回 need/budget/concern

**来源**：`[FROM_PRD]` — FR-2（F2.1/F2.2/F2.3）和 Gate E：中台 `GET /api/wechat/customer-profile?wechat_id=<id>` 响应扩展 `portrait.need/budget/concern`（来自 `cs_memory_longterm.summary`）及 `recent_messages[0..2]`；`overlay_window.py renderProfile` 补充三段论字段渲染。

**可观测行为**：curl `/api/wechat/customer-profile` 响应 JSON 含 `portrait.need`、`portrait.budget`、`portrait.concern` 字段及 `recent_messages` 数组（长度 ≤3）；overlay HTML 渲染三段论各一行。

**验证命令**：
```bash
# L2-3：/api/wechat/customer-profile 响应含三段论字段及最近3条消息（curl JSON assert）
WECHAT_ID="test_wx_001"
curl -s "http://localhost:5200/api/wechat/customer-profile?wechat_id=${WECHAT_ID}" | python3 - <<'EOF'
import sys, json
data = json.load(sys.stdin)
body = data.get("data", data)
portrait = body.get("portrait", {})
for field in ["need", "budget", "concern"]:
    assert field in portrait, f"FAIL: portrait 缺 {field} 字段"
msgs = body.get("recent_messages", [])
assert isinstance(msgs, list), "FAIL: recent_messages 不是列表"
assert len(msgs) <= 3, f"FAIL: recent_messages 超过3条: {len(msgs)}"
print(f"OK portrait={list(portrait.keys())} recent_messages_count={len(msgs)}")
EOF

# vitest: /api/wechat/customer-profile 响应含三段论字段（L1 单元验证）
cd /workspace && npx vitest run --reporter=verbose -t "customer-profile.*portrait\|portrait.*need\|need.*budget.*concern" 2>&1 | tail -20
```

**硬阈值**：curl 响应含 `portrait.need/budget/concern`；`recent_messages` 长度 ≤3；vitest PASS。

---

## Step 5：open_customer_page 方法——webbrowser.open 打开 CustomerProfilePage

**来源**：`[FROM_PRD]` — FR-4（F4.1/F4.2/F4.3）和 Gate G（xian-rog 真机验证）、Inv-15：`OverlayApp` 新增 `open_customer_page(wechat_id)` 方法调用 `webbrowser.open(url)`；overlay HTML 新增「查看画像」按钮，无 session 时置灰。

**可观测行为**：`overlay_window.py` 含 `open_customer_page` 方法及 `webbrowser.open` 调用；HTML 模板含「查看画像」按钮；`wechat_id` 来自 `_current_wechat_id` 缓存。

**验证命令**：
```bash
# L1-5：open_customer_page mock 调用 webbrowser.open 带正确 URL（pytest monkeypatch）
cd /workspace && python -m pytest services/agent/wechat-rpa/tests/ -k "open_customer_page" -v 2>&1 | tail -20

# 静态断言：overlay_window.py 含 open_customer_page + webbrowser.open
python3 - <<'EOF'
src = open("/workspace/services/agent/wechat-rpa/overlay/overlay_window.py").read()
assert "open_customer_page" in src, "FAIL: 缺 open_customer_page 方法"
assert "webbrowser.open" in src, "FAIL: 缺 webbrowser.open 调用"
assert "查看画像" in src or "open_customer_page" in src, "FAIL: 缺按钮定义"
print("OK: open_customer_page 方法及 webbrowser.open 存在")
EOF
```

**硬阈值**：pytest `open_customer_page` PASS；`overlay_window.py` 含 `webbrowser.open` 调用；按钮存在。

---

## Step 6：Gate D——_write_event 三处调用点无多余字段污染

**来源**：`[FROM_PRD]` — Gate D：`thinking` type 加入后，grep 全部 3 处 `_write_event` 调用点（:4442/:5324/:5779），无多余字段污染；Inv-14：thinking 写入时 contact 以外无额外字段。

**可观测行为**：`_write_event("thinking", ...)` 调用不传 `reasoning`（或传 None）；思考事件 JSON 不含 `wechat_id`/`content`/`reply` 字段。

**验证命令**：
```bash
# L1-3：静态检查 _write_event 调用点
python3 - <<'EOF'
import re
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py").read()
lines = [(i+1, l.strip()) for i, l in enumerate(src.splitlines()) if "_write_event(" in l and not l.strip().startswith("#")]
print(f"_write_event 调用点 {len(lines)} 处:")
for lineno, l in lines:
    print(f"  :{lineno} {l[:100]}")
# 找到 thinking 调用点，验证不含多余字段
thinking_calls = [(lineno, l) for lineno, l in lines if "thinking" in l]
for lineno, call in thinking_calls:
    for bad_field in ["content", "wechat_id", "reply", "text="]:
        if bad_field in call:
            print(f"FAIL: :{lineno} thinking 调用含多余字段 {bad_field!r}")
            exit(1)
print(f"OK: thinking 调用点 {len(thinking_calls)} 处均无多余字段")
EOF
```

**硬阈值**：`_write_event` 调用点 ≥3；thinking 调用不含 content/reply/wechat_id 多余字段。

---

## Step 7：CS_MEMORY_LONGTERM 索引验证（Gate E）

**来源**：`[FROM_PRD]` — Gate E：HK-VPS + MMV 两台 `pg_indexes` 查 `cs_memory_longterm` 含 `idx_cs_memory_longterm_tenant_contact`。

**可观测行为**：`cs_memory_longterm` 表上存在 `(tenant_id, contact)` 联合索引。

**验证命令**：
```bash
# L1-4：cs_memory_longterm 联合索引在数据库存在（psql 断言）
# HK-VPS 侧
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='cs_memory_longterm' AND indexname='idx_cs_memory_longterm_tenant_contact';" | grep -q "idx_cs_memory_longterm_tenant_contact" && echo "OK: HK-VPS 索引存在" || { echo "FAIL: HK-VPS 缺索引 idx_cs_memory_longterm_tenant_contact"; exit 1; }

# MMV 侧（另一台独立 postgres）
psql "$DATABASE_URL_MMV" -c "SELECT indexname FROM pg_indexes WHERE tablename='cs_memory_longterm' AND indexname='idx_cs_memory_longterm_tenant_contact';" | grep -q "idx_cs_memory_longterm_tenant_contact" && echo "OK: MMV 索引存在" || { echo "FAIL: MMV 缺索引"; exit 1; }
```

**硬阈值**：两台 DB 均找到 `idx_cs_memory_longterm_tenant_contact`。

---

## Step 8：line04-ai-overlay-smoke.sh 追加 thinking 断言

**来源**：`[FROM_PRD]` — FR-5（F5.2）：smoke 追加 thinking event 写入断言（grep events.jsonl 含 `"type":"thinking"`）。

**可观测行为**：`line04-ai-overlay-smoke.sh` 含 thinking 事件 grep 断言；L2-1 smoke 链路可验。

**验证命令**：
```bash
# L2-1：smoke 含 thinking grep 断言
SMOKE=".github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh"
grep -q '"type":"thinking"' /workspace/${SMOKE} || grep -q "type.*thinking" /workspace/${SMOKE} && echo "OK: smoke 含 thinking 断言" || { echo "FAIL: smoke 缺 thinking 断言"; exit 1; }
```

**硬阈值**：`line04-ai-overlay-smoke.sh` 含 thinking 事件断言行。

---

## Step 9（Final E2E）：全链路真机验证——L3-1 xian-rog 手动确认

**来源**：`[FROM_PRD]` — L3-1（真机 xian-rog，手动）：发送一条消息全链路——thinking 卡激活（蓝色动画）→ reply_sent 到达 → 「查看画像」按钮可点击 → 浏览器打开 CustomerProfilePage 含 need/budget/concern 三段论数据。

**可观测行为**（L3 手动，不可 CI 自动）：xian-rog 真机上浮窗出现蓝色 thinking 动画；reply_sent 后动画消失；点击「查看画像」默认浏览器打开 `localhost:5174/wechat/crm/<wechat_id>`；页面含 need/budget/concern 三段论字段。

**验证命令**（manual，Gate G 前置）：
```bash
# Gate G 预验证：webbrowser.open 在 Windows 真机可用
python -c "import webbrowser; webbrowser.open('http://localhost:5174/wechat/crm/test')"
# 期望：默认浏览器打开（不抛异常）

# L3 全链路验收清单（手动勾选）
# □ 浮窗启动后 tail_pointer.txt 存在且为整数
# □ 收到消息后蓝色 thinking 动画激活（≤600ms）
# □ reply_sent 后 thinking 动画消失
# □ 画像卡显示 need/budget/concern 三段论字段（非空占位）
# □ 「查看画像」按钮可点击（非置灰状态）
# □ 点击后浏览器打开 localhost:5174/wechat/crm/<wechat_id>
# □ CustomerProfilePage 页面含 need/budget/concern 数据
```

**硬阈值**：L3 上述 7 项手动清单全部打勾；xian-rog 真机确认。

---

## E2E 验收

**journey_type**：user_facing
**target_environment**：windows_cloud

### 9 条断言（L1×5 / L2×3 / L3×1）

| 编号 | 层级 | 断言 | 验证方式 | PASS 标准 |
|------|------|------|---------|---------|
| L1-1 | L1 | tail_pointer 重启后 get_events 不返回旧 event_id | pytest | 全 PASS |
| L1-2 | L1 | thinking event 写入 events.jsonl 不含 PII 字段 | pytest grep | 全 PASS |
| L1-3 | L1 | _write_event 3 处调用点字段无污染 | grep 静态断言 | exit 0 |
| L1-4 | L1 | cs_memory_longterm (tenant_id,contact) 联合索引在 HK-VPS 存在 | psql 断言 | 索引名存在 |
| L1-5 | L1 | open_customer_page mock 调用 webbrowser.open 带正确 URL | pytest monkeypatch | 全 PASS |
| L2-1 | L2 | post_draft_generate 调用前 events.jsonl 出现 "type":"thinking" | smoke grep | grep 命中 |
| L2-2 | L2 | overlay 重启后 tail_pointer.txt 存在且为整数 | smoke cat | 文件存在+整数 |
| L2-3 | L2 | /api/wechat/customer-profile 响应含三段论字段及最近3条消息 | curl JSON assert | 字段全存在 |
| L3-1 | L3 | 全链路真机验证（xian-rog 手动） | 手动 7 项清单 | 全部打勾 |

---

## Workstreams

workstream_count: 4

### Workstream 1：EventTailConsumer tail_pointer.txt 持久化（Gate A）

**范围**：`overlay/overlay_window.py` `EventTailConsumer.__init__` 新增 `_pointer_path`，启动时读取 offset 并 seek；`get_events()` 后写回 `tell()`；损坏归零软失败；pytest 新增 L1-1 测试。
**大小**：S（~40 行改动）
**依赖**：无

**关键 [BEHAVIOR]（≥4，详见 contract-dod.md）**：
- [BEHAVIOR] EventTailConsumer.__init__ 读取 tail_pointer.txt offset 并 seek
- [BEHAVIOR] get_events() 调用后 tail_pointer.txt 内容为当前字节 offset（整数）
- [BEHAVIOR] tail_pointer.txt 损坏/不存在时归零不抛异常
- [BEHAVIOR] pytest L1-1：重启后 get_events 不重放旧 event_id

---

### Workstream 2：thinking 事件写入 + _write_event 扩展（Gate D）

**范围**：`listen_chat.py` 约 :5700 `_gen_draft` 函数内部，`post_draft_generate` 调用前插入 `_write_event("thinking", sender)`；`_write_event` 函数签名向后兼容，`thinking` type 时 `reasoning=None`、`text='思考中...'`；pytest 新增 L1-2/L1-3 测试。
**大小**：S（~20 行改动）
**依赖**：无

**关键 [BEHAVIOR]（≥4，详见 contract-dod.md）**：
- [BEHAVIOR] _gen_draft 调用前 events.jsonl 出现 thinking 事件（L2-1 smoke 可验）
- [BEHAVIOR] thinking 事件不含 PII 字段（无 content/reply/wechat_id）
- [BEHAVIOR] _write_event thinking 调用时 reasoning 参数为 None
- [BEHAVIOR] pytest L1-2：thinking event 写入后 events.jsonl 不含 PII

---

### Workstream 3：cs_memory_longterm 三段论接入 + overlay 渲染（FR-2）

**范围**：中台 `GET /api/wechat/customer-profile` 响应扩展 `portrait.need/budget/concern`（来自 `cs_memory_longterm.summary`）和 `recent_messages[0..2]`（来自 `cs_memory_messages`）；`overlay_window.py renderProfile` 补充三段论字段渲染；vitest 新增 L2-3 测试。
**大小**：M（~80 行改动，涉及中台 API + 前端渲染）
**依赖**：Gate E（索引已就绪）

**关键 [BEHAVIOR]（≥4，详见 contract-dod.md）**：
- [BEHAVIOR] /api/wechat/customer-profile 响应 JSON 含 portrait.need 字段
- [BEHAVIOR] /api/wechat/customer-profile 响应 JSON 含 portrait.budget 字段
- [BEHAVIOR] /api/wechat/customer-profile 响应 JSON 含 portrait.concern 字段
- [BEHAVIOR] 响应含 recent_messages 数组且长度 ≤3

---

### Workstream 4：open_customer_page + 「查看画像」按钮（FR-4 + Gate G）

**范围**：`overlay_window.py OverlayApp` 新增 `open_customer_page(wechat_id)` 方法调用 `webbrowser.open(f"{self._middleware_base_url}/wechat/crm/{wechat_id}")`；HTML 模板新增「查看画像」按钮；无 session 时按钮置灰；pytest 新增 L1-5 monkeypatch 测试。
**大小**：M（~50 行改动）
**依赖**：Gate G（xian-rog 手动验证）

**关键 [BEHAVIOR]（≥4，详见 contract-dod.md）**：
- [BEHAVIOR] OverlayApp 含 open_customer_page 方法
- [BEHAVIOR] open_customer_page 调用 webbrowser.open 且 URL 含 /wechat/crm/
- [BEHAVIOR] HTML 模板含「查看画像」按钮元素
- [BEHAVIOR] pytest L1-5：monkeypatch webbrowser.open 断言调用正确 URL

---

## Test Contract

| Workstream | TDD 红绿测试（Proposer 写） | 预期红证据 |
|---|---|---|
| WS1 | `sprints/07201810-overlay-card-redesign-gp4/tests/test_tail_pointer.py` | WS1 前 EventTailConsumer 无 tail_pointer.txt 逻辑 → pytest 失败 |
| WS2 | `sprints/07201810-overlay-card-redesign-gp4/tests/test_thinking_event.py` | WS2 前 listen_chat.py 无 thinking 写入 → pytest 失败 |
| WS3 | `sprints/07201810-overlay-card-redesign-gp4/tests/test_customer_profile_api.py` | WS3 前 API 响应无 portrait.need/budget/concern → vitest/pytest 失败 |
| WS4 | `sprints/07201810-overlay-card-redesign-gp4/tests/test_open_customer_page.py` | WS4 前 OverlayApp 无 open_customer_page → pytest ENOATTR 失败 |

---

## Risks

| # | Risk | 影响 | Mitigation |
|---|---|---|---|
| R1 | cs_memory_longterm.summary 格式不统一（非结构化文本），need/budget/concern 解析失效 | API 返回空字符串，画像卡三段论空白 | 本刀透出 summary 原文，结构化解析列为加厚阶段；API 降级时返回 `"summary": "<原文>"` 兜底 |
| R2 | webbrowser.open 在 Windows Server（GHA runner）环境无默认浏览器 | Gate G 手动验证无法在 CI 执行 | L1-5 用 monkeypatch 在 CI 验证调用逻辑；Gate G 保持 xian-rog 真机手动验收 |
| R3 | tail_pointer.txt 并发写（多进程重启竞争） | offset 损坏导致重放或跳过事件 | Inv-13：只由 EventTailConsumer 读写；损坏归零软失败；单进程架构无并发写 |
| R4 | _write_event 新增 thinking 调用点影响 heartbeat/reply_sent 现有调用 | 现有事件字段被污染，overlay 状态错误 | Gate D：静态 grep 验证 3 处调用点无多余字段；L1-3 断言防回归 |
