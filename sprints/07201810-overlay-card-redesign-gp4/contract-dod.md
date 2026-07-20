---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — GP-4 Overlay 画像卡重画（三痛点修复）

task_id: 757c6ab8-985c-415d-8e4f-9749bd0709fc
sprint_dir: sprints/07201810-overlay-card-redesign-gp4
date: 2026-07-20

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/wechat-rpa/overlay/overlay_window.py` EventTailConsumer 含 `_pointer_path` 字段及 tail_pointer.txt 读写逻辑
  Test: `python3 -c "src=open('/workspace/services/agent/wechat-rpa/overlay/overlay_window.py').read();assert '_pointer_path' in src or 'tail_pointer.txt' in src,'FAIL';print('OK')"`

- [ ] [ARTIFACT] `services/agent/wechat-rpa/listen_chat.py` 在 `_gen_draft` 函数内含 `_write_event("thinking"` 调用
  Test: `python3 -c "src=open('/workspace/services/agent/wechat-rpa/listen_chat.py').read();assert '_write_event(\"thinking\"' in src or \"_write_event('thinking'\" in src,'FAIL: 缺 thinking 写入';print('OK')"`

- [ ] [ARTIFACT] `services/agent/wechat-rpa/overlay/overlay_window.py` OverlayApp 含 `open_customer_page` 方法及 `webbrowser.open` 调用
  Test: `python3 -c "src=open('/workspace/services/agent/wechat-rpa/overlay/overlay_window.py').read();assert 'open_customer_page' in src,'FAIL: 缺方法';assert 'webbrowser.open' in src,'FAIL: 缺 webbrowser.open';print('OK')"`

- [ ] [ARTIFACT] 中台 API `/api/wechat/customer-profile` 响应扩展含 `portrait.need/budget/concern` 及 `recent_messages`
  Test: `curl -s "http://localhost:5200/api/wechat/customer-profile?wechat_id=test" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d.get('data',d);p=b.get('portrait',{});[__import__('sys').exit(1) for f in ['need','budget','concern'] if f not in p];print('OK portrait fields exist')"`

- [ ] [ARTIFACT] Gate E：`cs_memory_longterm` 索引在 HK-VPS + MMV 两台 postgres 均存在
  Test: `psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='cs_memory_longterm' AND indexname='idx_cs_memory_longterm_tenant_contact';" | grep -q "idx_cs_memory_longterm_tenant_contact" && echo "OK: HK-VPS 索引存在" || { echo "FAIL: HK-VPS 缺索引"; exit 1; } && psql "$DATABASE_URL_MMV" -c "SELECT indexname FROM pg_indexes WHERE tablename='cs_memory_longterm' AND indexname='idx_cs_memory_longterm_tenant_contact';" | grep -q "idx_cs_memory_longterm_tenant_contact" && echo "OK: MMV 索引存在" || { echo "FAIL: MMV 缺索引"; exit 1; }`

---

## BEHAVIOR 条目（内嵌 manual:bash 验收命令）

### WS1：tail_pointer.txt 持久化

- [ ] [BEHAVIOR] EventTailConsumer 启动时读取 tail_pointer.txt 中的字节 offset 并 seek 到该位置
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
events_path = os.path.join(tmpdir, "events.jsonl")
# 写入两条事件，第一条是旧的
with open(events_path, "w") as f:
    f.write(json.dumps({"v":1,"event_id":"old-id-001","type":"heartbeat","contact":"","ts":time.time()-100}) + "\n")
old_offset = os.path.getsize(events_path)
# 写入 tail_pointer.txt 指向旧事件之后的位置
ptr_path = os.path.join(tmpdir, "tail_pointer.txt")
with open(ptr_path, "w") as f:
    f.write(str(old_offset))
# 追加新事件
with open(events_path, "a") as f:
    f.write(json.dumps({"v":1,"event_id":"new-id-001","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
c = EventTailConsumer(tmpdir)
events = c.get_events()
ids = [e.get("event_id") for e in events]
assert "old-id-001" not in ids, f"FAIL: 重放了旧 event_id: {ids}"
assert "new-id-001" in ids, f"FAIL: 未消费新事件: {ids}"
print("OK: tail_pointer seek 生效，旧事件未重放")
EOF'
  期望: OK: tail_pointer seek 生效，旧事件未重放

- [ ] [BEHAVIOR] get_events() 调用后 tail_pointer.txt 内容更新为当前字节 offset（整数字符串）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
events_path = os.path.join(tmpdir, "events.jsonl")
with open(events_path, "w") as f:
    f.write(json.dumps({"v":1,"event_id":"evt-001","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
c = EventTailConsumer(tmpdir)
c.get_events()
ptr_path = os.path.join(tmpdir, "tail_pointer.txt")
assert os.path.exists(ptr_path), "FAIL: tail_pointer.txt 不存在"
content = open(ptr_path).read().strip()
assert content.isdigit(), f"FAIL: tail_pointer.txt 内容非整数: {content!r}"
assert int(content) > 0, f"FAIL: offset 为 0，期望 >0"
print(f"OK: tail_pointer.txt 更新为 offset={content}")
EOF'
  期望: OK: tail_pointer.txt 更新为 offset=<正整数>

- [ ] [BEHAVIOR] tail_pointer.txt 损坏（非整数内容）时 EventTailConsumer 归零不抛异常
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
events_path = os.path.join(tmpdir, "events.jsonl")
with open(events_path, "w") as f:
    f.write(json.dumps({"v":1,"event_id":"evt-001","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
ptr_path = os.path.join(tmpdir, "tail_pointer.txt")
with open(ptr_path, "w") as f:
    f.write("CORRUPTED_VALUE_NOT_INT")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
try:
    c = EventTailConsumer(tmpdir)
    events = c.get_events()
    print(f"OK: 损坏时不抛异常，events 返回 {len(events)} 条")
except Exception as e:
    print(f"FAIL: 损坏时抛出异常: {e}")
    sys.exit(1)
EOF'
  期望: OK: 损坏时不抛异常

- [ ] [BEHAVIOR] tail_pointer.txt 不存在时 EventTailConsumer 从头读取（归零行为）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
events_path = os.path.join(tmpdir, "events.jsonl")
with open(events_path, "w") as f:
    f.write(json.dumps({"v":1,"event_id":"evt-init","type":"heartbeat","contact":"","ts":time.time()}) + "\n")
# 不创建 tail_pointer.txt
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
from overlay.overlay_window import EventTailConsumer
c = EventTailConsumer(tmpdir)
events = c.get_events()
ids = [e.get("event_id") for e in events]
assert "evt-init" in ids, f"FAIL: 应从头读取但未返回 evt-init: {ids}"
print("OK: 无 tail_pointer.txt 时从头读取")
EOF'
  期望: OK: 无 tail_pointer.txt 时从头读取

---

### WS2：thinking 事件写入

- [ ] [BEHAVIOR] listen_chat.py 在 _gen_draft 函数内 post_draft_generate 调用前存在 _write_event("thinking", ...) 调用点
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import ast, sys
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py").read()
# 检查 thinking 写入点
has_thinking = '"_write_event(\"thinking\"" in src or "_write_event('"'"'thinking'"'"'" in src'
assert eval(has_thinking), "FAIL: 缺 _write_event(thinking) 调用点"
# 检查位于 _gen_draft 函数附近（:5700 区域）
lines = src.splitlines()
gen_draft_lineno = None
thinking_lineno = None
for i, line in enumerate(lines, 1):
    if "def _gen_draft" in line:
        gen_draft_lineno = i
    if "_write_event" in line and "thinking" in line and not line.strip().startswith("#"):
        thinking_lineno = i
assert gen_draft_lineno, "FAIL: 未找到 _gen_draft 函数"
assert thinking_lineno, "FAIL: 未找到 thinking 写入点"
# thinking 写入点应在 _gen_draft 之后合理范围内
assert abs(thinking_lineno - gen_draft_lineno) < 30, f"WARN: thinking 写入点(:{ thinking_lineno}) 与 _gen_draft(:{ gen_draft_lineno}) 距离 >{abs(thinking_lineno - gen_draft_lineno)} 行"
print(f"OK: thinking 写入点在 :{thinking_lineno}，_gen_draft 在 :{gen_draft_lineno}")
EOF'
  期望: OK: thinking 写入点存在且位于 _gen_draft 附近

- [ ] [BEHAVIOR] thinking 事件写入 events.jsonl 时不含 PII 字段（无 content/reply/wechat_id 真实内容）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile, unittest.mock
tmpdir = tempfile.mkdtemp()
os.environ["ZJ_STATE_DIR"] = tmpdir
events_path = os.path.join(tmpdir, "events.jsonl")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
import listen_chat as lc
lc._write_event("thinking", "test_sender")
with open(events_path) as f:
    lines = [json.loads(l) for l in f if l.strip()]
thinking_events = [e for e in lines if e.get("type") == "thinking"]
assert thinking_events, "FAIL: 未写入 thinking 事件"
ev = thinking_events[-1]
for pii_field in ["content", "reply", "wechat_id"]:
    assert pii_field not in ev or ev.get(pii_field) is None, f"FAIL: thinking 事件含 PII 字段 {pii_field}={ev.get(pii_field)!r}"
assert ev.get("reasoning") is None, f"FAIL: thinking 事件 reasoning 非 None: {ev.get('reasoning')!r}"
print(f"OK: thinking 事件无 PII 字段 keys={list(ev.keys())}")
EOF'
  期望: OK: thinking 事件无 PII 字段

- [ ] [BEHAVIOR] _write_event 在 thinking 调用时 reasoning 参数为 None（不传入推理内容）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, os, json, time, tempfile
tmpdir = tempfile.mkdtemp()
os.environ["ZJ_STATE_DIR"] = tmpdir
events_path = os.path.join(tmpdir, "events.jsonl")
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
import listen_chat as lc
lc._write_event("thinking", "wx_test_001")
with open(events_path) as f:
    events = [json.loads(l) for l in f if l.strip()]
thinking = [e for e in events if e.get("type") == "thinking"]
assert thinking, "FAIL: 未写入 thinking 事件"
ev = thinking[-1]
assert ev.get("reasoning") is None, f"FAIL: reasoning 非 None: {ev.get('reasoning')!r}"
assert ev.get("contact") == "wx_test_001", f"FAIL: contact 字段错误: {ev.get('contact')!r}"
print(f"OK: thinking 事件 reasoning=None contact=wx_test_001")
EOF'
  期望: OK: thinking 事件 reasoning=None

- [ ] [BEHAVIOR] _write_event 三处调用点（heartbeat/thinking/reply_sent）字段无相互污染（静态断言）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py").read()
lines = [(i+1, l.strip()) for i, l in enumerate(src.splitlines()) if "_write_event(" in l and not l.strip().startswith("#")]
print(f"_write_event 调用点 {len(lines)} 处:")
for lineno, l in lines:
    print(f"  :{lineno} {l[:100]}")
assert len(lines) >= 3, f"FAIL: 期望 ≥3 处调用点，实际 {len(lines)}"
# 验证 thinking 调用不含污染字段
for lineno, call in [(lineno, l) for lineno, l in lines if "thinking" in l]:
    for bad in ["content", "wechat_id", "reply"]:
        assert bad not in call, f"FAIL: :{lineno} thinking 调用含 {bad!r}"
print(f"OK: {len(lines)} 处调用点无字段污染")
EOF'
  期望: OK: N 处调用点无字段污染（N≥3）

---

### WS3：cs_memory_longterm 三段论接入

- [ ] [BEHAVIOR] GET /api/wechat/customer-profile 响应 JSON 含 portrait.need 字段（来自 cs_memory_longterm.summary）
  Test: manual:bash -c 'curl -sf "http://localhost:5200/api/wechat/customer-profile?wechat_id=test_wx_001" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d.get('"'"'data'"'"',d);p=b.get('"'"'portrait'"'"',{});assert '"'"'need'"'"' in p,f'"'"'FAIL: portrait 缺 need 字段 keys={list(p.keys())}'"'"';print(f'"'"'OK portrait.need={p['"'"'need'"'"']!r}'"'"')" || { echo "FAIL: API 请求失败或字段缺失"; exit 1; }'
  期望: OK portrait.need=<值>

- [ ] [BEHAVIOR] GET /api/wechat/customer-profile 响应 JSON 含 portrait.budget 字段
  Test: manual:bash -c 'curl -sf "http://localhost:5200/api/wechat/customer-profile?wechat_id=test_wx_001" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d.get('"'"'data'"'"',d);p=b.get('"'"'portrait'"'"',{});assert '"'"'budget'"'"' in p,f'"'"'FAIL: portrait 缺 budget 字段'"'"';print(f'"'"'OK portrait.budget={p['"'"'budget'"'"']!r}'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK portrait.budget=<值>

- [ ] [BEHAVIOR] GET /api/wechat/customer-profile 响应 JSON 含 portrait.concern 字段
  Test: manual:bash -c 'curl -sf "http://localhost:5200/api/wechat/customer-profile?wechat_id=test_wx_001" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d.get('"'"'data'"'"',d);p=b.get('"'"'portrait'"'"',{});assert '"'"'concern'"'"' in p,f'"'"'FAIL: portrait 缺 concern 字段'"'"';print(f'"'"'OK portrait.concern={p['"'"'concern'"'"']!r}'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK portrait.concern=<值>

- [ ] [BEHAVIOR] GET /api/wechat/customer-profile 响应含 recent_messages 数组且长度 ≤3
  Test: manual:bash -c 'curl -sf "http://localhost:5200/api/wechat/customer-profile?wechat_id=test_wx_001" | python3 -c "import sys,json;d=json.load(sys.stdin);b=d.get('"'"'data'"'"',d);msgs=b.get('"'"'recent_messages'"'"',[]);assert isinstance(msgs,list),f'"'"'FAIL: recent_messages 非列表'"'"';assert len(msgs)<=3,f'"'"'FAIL: recent_messages 超 3 条={len(msgs)}'"'"';print(f'"'"'OK recent_messages count={len(msgs)}'"'"')" || { echo "FAIL"; exit 1; }'
  期望: OK recent_messages count=<0-3>

- [ ] [BEHAVIOR] overlay_window.py renderProfile 或 __updateCustomerCard 处理三段论字段（need/budget/concern）
  Test: manual:bash -c 'python3 -c "src=open('"'"'/workspace/services/agent/wechat-rpa/overlay/overlay_window.py'"'"').read();assert '"'"'need'"'"' in src and '"'"'budget'"'"' in src and '"'"'concern'"'"' in src,'"'"'FAIL: overlay 未渲染三段论字段'"'"';print('"'"'OK: overlay 含三段论字段渲染'"'"')"'
  期望: OK: overlay 含三段论字段渲染

---

### WS4：open_customer_page + 「查看画像」按钮

- [ ] [BEHAVIOR] OverlayApp 含 open_customer_page 方法定义（Gate G 前置）
  Test: manual:bash -c 'python3 -c "src=open('"'"'/workspace/services/agent/wechat-rpa/overlay/overlay_window.py'"'"').read();assert '"'"'def open_customer_page'"'"' in src,'"'"'FAIL: 缺 open_customer_page 方法'"'"';print('"'"'OK: open_customer_page 方法存在'"'"')"'
  期望: OK: open_customer_page 方法存在

- [ ] [BEHAVIOR] open_customer_page 调用 webbrowser.open 且 URL 含 /wechat/crm/ 路径（Inv-15 合规）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
import sys, unittest.mock
sys.path.insert(0, "/workspace/services/agent/wechat-rpa")
with unittest.mock.patch("webbrowser.open") as mock_open:
    from overlay.overlay_window import OverlayApp
    app = OverlayApp.__new__(OverlayApp)
    app._middleware_base_url = "http://localhost:5174"
    app._current_wechat_id = "wx_test_001"
    app.open_customer_page("wx_test_001")
    assert mock_open.called, "FAIL: webbrowser.open 未被调用"
    called_url = mock_open.call_args[0][0]
    assert "/wechat/crm/" in called_url, f"FAIL: URL 不含 /wechat/crm/: {called_url!r}"
    assert "wx_test_001" in called_url, f"FAIL: URL 不含 wechat_id: {called_url!r}"
    print(f"OK: webbrowser.open({called_url!r})")
EOF'
  期望: OK: webbrowser.open(http://localhost:5174/wechat/crm/wx_test_001)

- [ ] [BEHAVIOR] overlay HTML 模板含「查看画像」按钮元素（pywebview.api.open_customer_page 绑定）
  Test: manual:bash -c 'python3 -c "src=open('"'"'/workspace/services/agent/wechat-rpa/overlay/overlay_window.py'"'"').read();assert '"'"'查看画像'"'"' in src or '"'"'open_customer_page'"'"' in src,'"'"'FAIL: 缺查看画像按钮'"'"';assert '"'"'open_customer_page'"'"' in src,'"'"'FAIL: 缺 open_customer_page 绑定'"'"';print('"'"'OK: 查看画像按钮存在且绑定 open_customer_page'"'"')"'
  期望: OK: 查看画像按钮存在且绑定 open_customer_page

- [ ] [BEHAVIOR] 无当前 session（_current_wechat_id 为 None）时「查看画像」按钮置灰（disabled/灰色）
  Test: manual:bash -c 'python3 -c "src=open('"'"'/workspace/services/agent/wechat-rpa/overlay/overlay_window.py'"'"').read();# 验证按钮置灰逻辑存在（disabled 或 classList 操作）;has_disabled = '"'"'disabled'"'"' in src and '"'"'open_customer_page'"'"' in src;has_grey = '"'"'grey'"'"' in src or '"'"'gray'"'"' in src or '"'"'disabled'"'"' in src;assert has_disabled or has_grey,'"'"'FAIL: 缺按钮置灰逻辑'"'"';print('"'"'OK: 按钮置灰逻辑存在'"'"')"'
  期望: OK: 按钮置灰逻辑存在

---

## 不变量自检（Invariant）

- [ ] [INV-13] tail_pointer.txt 只由 EventTailConsumer 读写，单行整数，损坏→归零不崩
  Test: manual:bash -c 'grep -n "tail_pointer" /workspace/services/agent/wechat-rpa/listen_chat.py && echo "WARN: listen_chat.py 含 tail_pointer 读写（违反 Inv-13）" || echo "OK: listen_chat.py 不含 tail_pointer 读写"'
  期望: OK: listen_chat.py 不含 tail_pointer 读写

- [ ] [INV-14] thinking 写入点 = post_draft_generate 调用前，不携带 contact 以外字段（推理字段为 None）
  Test: manual:bash -c 'python3 - <<'"'"'EOF'"'"'
src = open("/workspace/services/agent/wechat-rpa/listen_chat.py").read()
lines = src.splitlines()
# 找 thinking 调用行号
thinking_lines = [(i+1, l.strip()) for i, l in enumerate(lines) if "_write_event" in l and "thinking" in l and not l.strip().startswith("#")]
assert thinking_lines, "FAIL: 未找到 thinking 写入点"
for lineno, l in thinking_lines:
    for bad in ["reasoning=", "text=", "stage="]:
        if bad in l and "None" not in l:
            print(f"WARN: :{lineno} 含 {bad!r}（检查是否传入了非 None 值）")
print(f"OK: thinking 写入点 {len(thinking_lines)} 处，字段检查通过")
EOF'
  期望: OK: thinking 写入点 N 处，字段检查通过

- [ ] [INV-15] open_customer_page 内部 webbrowser.open(url)，不内嵌 iframe，不在浮窗内渲染页面
  Test: manual:bash -c 'python3 -c "src=open('"'"'/workspace/services/agent/wechat-rpa/overlay/overlay_window.py'"'"').read();import re;ctx=src[src.find('"'"'def open_customer_page'"'"'):src.find('"'"'def open_customer_page'"'"')+500] if '"'"'def open_customer_page'"'"' in src else '"'"''"'"';assert '"'"'iframe'"'"' not in ctx.lower(),'"'"'FAIL: open_customer_page 含 iframe（违反 Inv-15）'"'"';assert '"'"'webbrowser.open'"'"' in ctx,'"'"'FAIL: open_customer_page 缺 webbrowser.open'"'"';print('"'"'OK: open_customer_page 无 iframe，只调 webbrowser.open'"'"')"'
  期望: OK: open_customer_page 无 iframe，只调 webbrowser.open

- [ ] [SCOPE-GUARD] thinking 事件写入点不含 stream/chunk/delta 字段
  Test: manual:bash -c 'python3 -c "src=open(\"/workspace/services/agent/wechat-rpa/listen_chat.py\").read();import re;m=re.findall(r\"thinking.*?(stream|chunk|delta)\",src,re.DOTALL);assert not m,f\"FAIL: thinking 含禁止字段 {m}\";print(\"OK: thinking 无 streaming 字段\")"'
  期望: OK: thinking 无 streaming 字段

- [ ] [SCOPE-GUARD] thinking 事件覆盖语义（同 contact 新 thinking 覆盖旧值，不排队）
  说明: 仅文字约束，不需 CI 断言。overlay 端同一 contact 的 thinking 状态以最新写入为准（overlay_window.py setThinking 直接赋值不 append）。

---

## 假绿自查

| 场景 | 实现前预期结果 | 说明 |
|------|------------|------|
| WS1 前 EventTailConsumer 无 tail_pointer 逻辑 | `_pointer_path` 关键字断言 → FAIL | 真红 |
| WS2 前 listen_chat.py 无 thinking 写入 | `_write_event("thinking"` 断言 → FAIL | 真红 |
| WS3 前 API 无 portrait.need 字段 | curl JSON assert → FAIL | 真红（API 未实现时 curl 也会 404） |
| WS4 前 OverlayApp 无 open_customer_page | `def open_customer_page` 断言 → FAIL | 真红 |
| thinking 事件含 reasoning 明文 | PII 字段检查 → FAIL | 防 reasoning leak |
| webbrowser.open URL 含 iframe 参数 | Inv-15 检查 → WARN | 设计边界保护 |
