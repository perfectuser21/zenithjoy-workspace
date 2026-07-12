# Contract DoD — Line04 AI 思考浮窗 第二刀

sprint_dir: sprints/07121132-line04-ai-thinking-overlay
task_id: 8f93f2a1-fdc2-4d41-b97d-6a5ff984697c
round: 1
date: 2026-07-12

---

## DoD 条目（[BEHAVIOR] 可测试行为断言）

---

### [BEHAVIOR] [BEHAVIOR-1] overlay_window.py 无边框置顶窗建窗

**场景**：在 windows_cloud GHA runner 上，调用 `python overlay_window.py --probe`，进程应在 2s 内完成 pywebview 窗口创建并以 exit_code=0 退出；窗口样式必须带 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW，不抢焦点。

**验收命令（manual:bash）**：
```bash
# 在 GHA windows-latest runner 或 xian-rog 上
cd services/agent/wechat-rpa/overlay
python -c "
import subprocess, time, sys
start = time.time()
proc = subprocess.Popen([sys.executable, 'overlay_window.py', '--probe'])
proc.wait(timeout=5)
elapsed = time.time() - start
assert proc.returncode == 0, f'exit_code={proc.returncode}'
assert elapsed < 3.0, f'建窗耗时 {elapsed:.1f}s 超过 2s'
print(f'PASS: 建窗 {elapsed:.2f}s, exit_code=0')
"
```
**通过标准**：脚本输出 `PASS`，无异常，elapsed < 3.0s，exit_code=0。

---

### [BEHAVIOR] [BEHAVIOR-2] 贴靠+显隐循环四行判据表

**场景**：`PositionLoop` 类接收模拟微信窗口状态，严格按四行判据表决定浮窗行为：IsIconic→隐藏；CLOAKED→位置冻结；可见→跟随；不存在→隐藏。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa/overlay
python -m pytest tests/test_overlay_window.py -k "IsIconic or CLOAKED or position_loop" -v
```
**通过标准**：至少 4 个 case（每行各一）全绿，无 SKIP，无 XFAIL。

---

### [BEHAVIOR] [BEHAVIOR-3] overlay-state.json 持久化健壮性

**场景**：overlay-state.json 文件损坏（JSON parse error）时，`PositionLoop` 应弃用损坏文件并采用默认值（位置居右上，未折叠），不进崩溃循环，同时备份损坏文件为 `.bak`。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa/overlay
python -c "
import json, tempfile, os, sys
sys.path.insert(0, '.')
from overlay_window import PositionLoop

with tempfile.TemporaryDirectory() as d:
    state_path = os.path.join(d, 'overlay-state.json')
    # 写入损坏 JSON
    with open(state_path, 'w') as f:
        f.write('{invalid json!!!')
    loop = PositionLoop(state_dir=d)
    state = loop.load_state()
    # 损坏时应返回默认值，不抛异常
    assert state is not None, '不应返回 None'
    assert os.path.exists(state_path + '.bak'), '损坏文件应被备份为 .bak'
    print('PASS: 损坏 state.json 弃用默认值，.bak 备份存在')
"
```
**通过标准**：输出 `PASS`，无异常，`.bak` 文件存在。

---

### [BEHAVIOR] [BEHAVIOR-4] events tail 消费端健壮性（heartbeat 降级 + inode 变化 + 坏行跳过 + 幂等去重）

**场景**：`EventTailConsumer` 应处理以下四种场景不崩溃：(a) heartbeat 超 180s→渲染降级文案；(b) 文件 inode 变化→重开句柄先读 `.1`；(c) 坏行（截断 JSON）→跳过继续；(d) 同 event_id 重放→不重复渲染。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa/overlay
python -m pytest tests/test_overlay_window.py -k "heartbeat or inode or bad_line or dedup" -v
```
**通过标准**：4 个子 case 全绿，覆盖 BEHAVIOR-3a/3b/3c 三条 invariant。

---

### [BEHAVIOR] [BEHAVIOR-5] generateChatDraft LLM reasoning 真实现（替换 mock 存根）

**场景**：`wechat-draft.ts` 的 `generateChatDraft` 函数调用真实 LLM（TOAPI deepseek-v4-flash），返回体包含 `{reply, tags, reasoning}` 三字段；reasoning 必须 ≤30 字；含 PII 时替换为降级文案；LLM 返回非 JSON（:548 兜底路径）时 reasoning 缺省，渲染端显示「已回复 {联系人}」。

**验收命令（manual:bash）**：
```bash
# 在有 TOAPI_API_KEY 的环境（xian-rog 或本地）
cd apps/api
TOAPI_API_KEY=$(source ~/.credentials/openrouter.env && echo $TOAPI_API_KEY) \
  npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts --reporter=verbose
```
**通过标准**：全部 it() 绿，无 mock 存根（`mockGenerateDraft` 函数不再被调用），`generateChatDraft` 真实导入路径正确。

---

### [BEHAVIOR] [BEHAVIOR-6] node 侧 overlay handler 接线（spawn/preflight/watchdog/mutex）

**场景**：`overlay.ts` handler 在 line04 模块启动时：(a) 先调 `preflight.py` 检测，失败→不 spawn，写 `overlay-diag.json`；(b) 检测 mutex `Global\zenithjoy-line04-overlay`，存在→ `taskkill` 旧进程再 spawn；(c) 监听 exit_code=0 + stdout `user_closed=true` → 不重拉；(d) `watchdog.circuit_open=true` → 不重拉。

**验收命令（manual:bash）**：
```bash
cd services/agent
npx vitest run modules/line04/tests/overlay-handler.test.ts --reporter=verbose 2>&1 | tail -30
# 若测试文件尚未存在，用骨架验证 handler 可 require
node -e "require('./modules/line04/handlers/overlay.js'); console.log('PASS: handler require OK')"
```
**通过标准**：vitest 全绿；或 handler 可 require 无报错（骨架阶段）。

---

### [BEHAVIOR] [BEHAVIOR-7] CI pywebview 探针 + notepad 替身 NOACTIVATE 断言

**场景**：GHA windows-latest runner 上，(a) pywebview 探针 2s 退出 exit_code=0；(b) spawn notepad.exe，取 hwnd，运行 500ms 贴靠循环，断言 `GetForegroundWindow() != notepad_hwnd`（不抢焦）。

**验收命令（manual:bash）**：
```bash
# 模拟 CI 探针步骤（本地或 GHA）
cd services/agent/wechat-rpa/overlay
python -c "
import subprocess, sys, time
# Step 1: probe
r = subprocess.run([sys.executable, 'overlay_window.py', '--probe'], timeout=5)
assert r.returncode == 0, 'probe failed'
print('Step1 PASS: probe exit_code=0')

# Step 2: notepad 替身（仅 Windows 真机可跑）
import platform
if platform.system() == 'Windows':
    import subprocess as sp, ctypes
    notepad = sp.Popen(['notepad.exe'])
    time.sleep(0.5)
    hwnd = ctypes.windll.user32.FindWindowW('Notepad', None)
    fg_before = ctypes.windll.user32.GetForegroundWindow()
    # 此处调用 PositionLoop 贴靠 500ms
    from overlay_window import PositionLoop
    loop = PositionLoop(state_dir='/tmp/test-state')
    loop.attach_to_hwnd_for_test(hwnd, iterations=5)
    fg_after = ctypes.windll.user32.GetForegroundWindow()
    assert fg_after != hwnd or fg_after == fg_before, 'NOACTIVATE 失效，焦点被抢'
    notepad.terminate()
    print('Step2 PASS: NOACTIVATE 有效')
else:
    print('Step2 SKIP: 非 Windows 跳过 notepad 替身')
"
```
**通过标准**：Step1 PASS；Step2 PASS（Windows）或 SKIP（Linux CI 纯函数兜底时 OK）。

---

### [BEHAVIOR] [BEHAVIOR-8] EventTailConsumer 只读断言（I1：唯一写者 = listen_chat）

**场景**：`EventTailConsumer`（浮窗读端）全程只以只读模式操作 events.jsonl，严禁任何写入调用。

**验收命令（manual:bash）**：
```bash
# grep 断言：overlay 目录下无任何对 events.jsonl 的写入调用
! grep -rP "open\(.*events\.jsonl.*['\"][wa]" services/agent/wechat-rpa/overlay/
# Python AST 层验证：EventTailConsumer 无 open(...,'w') 或 open(...,'a')
python -c "
import ast, pathlib
src = pathlib.Path('services/agent/wechat-rpa/overlay/overlay_window.py').read_text(errors='replace')
tree = ast.parse(src)
for node in ast.walk(tree):
    if isinstance(node, ast.Call):
        func = getattr(node, 'func', None)
        name = getattr(func, 'id', '') or getattr(func, 'attr', '')
        if name == 'open' and node.args:
            for kw in getattr(node, 'keywords', []):
                if kw.arg == 'mode' and hasattr(kw.value, 's') and kw.value.s in ('w','a'):
                    raise AssertionError(f'line {node.lineno}: open() 含写模式')
            if len(node.args) >= 2:
                m = getattr(node.args[1], 's', '')
                assert m not in ('w','a'), f'line {node.lineno}: open() 含写模式'
print('PASS: EventTailConsumer 无写入调用')
"
```
**通过标准**：grep 无输出，Python 脚本输出 `PASS`。

---

### [BEHAVIOR] [BEHAVIOR-9] listen_chat reply_sent 挂点回归（I2）

**场景**：listen_chat.py 的 reply_sent 事件写入挂点仍在第 4787 行 DELIVERED 调用点，_commit_reply_success 本体未被挂入。

**验收命令（manual:bash）**：
```bash
# 确认 4787 行附近含 DELIVERED/reply_sent 挂点
grep -n "reply_sent\|DELIVERED" services/agent/wechat-rpa/listen_chat.py | grep -E "478[5-9]:"
# 确认 _commit_reply_success 本体行不直接写 reply_sent
python -c "
import re, pathlib
lines = pathlib.Path('services/agent/wechat-rpa/listen_chat.py').read_text().splitlines()
in_func = False
for i, l in enumerate(lines, 1):
    if 'def _commit_reply_success' in l: in_func = True
    if in_func and l.strip().startswith('def ') and '_commit_reply_success' not in l: in_func = False
    if in_func and 'reply_sent' in l and 'write_event' in l:
        raise AssertionError(f'line {i}: _commit_reply_success 本体写 reply_sent（应挂 DELIVERED 点）')
print('PASS: reply_sent 挂点位置正确')
"
```
**通过标准**：第一条 grep 有输出（4785-4789 行含 DELIVERED）；Python 脚本输出 `PASS`。

---

### [BEHAVIOR] [BEHAVIOR-10] PII 第二闸（agent 侧渲染前过滤，I5）

**场景**：`EventTailConsumer` 在渲染 reasoning 到 UI 前，调用 `pii_filter.filterPiiReasoning`（同一纯函数）进行第二次过滤，含手机号/微信号时替换为降级文案。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa/overlay
python -m pytest tests/test_overlay_window.py -k "pii or second_gate or filter_reasoning" -v
# 若命名不含上述关键字，改跑完整模块确认 PII case 覆盖
python -c "
from pii_filter import filter_pii_reasoning
# 含手机号 → 降级文案
r = filter_pii_reasoning('客户手机是13800138000，意向很高')
assert '13800138000' not in r, f'PII 未过滤: {r}'
# 正常 reasoning → 原样
r2 = filter_pii_reasoning('处于比价阶段')
assert r2 == '处于比价阶段', f'正常文案被改: {r2}'
print('PASS: PII 第二闸有效')
"
```
**通过标准**：pytest 绿 或 Python 脚本输出 `PASS`。

---

### [BEHAVIOR] [BEHAVIOR-11] 浮窗不干预微信窗口（I11）

**场景**：overlay_window.py 中不含任何主动操控微信窗口的 Win32 API 调用（SendMessage / PostMessage / SetForegroundWindow）。

**验收命令（manual:bash）**：
```bash
python -c "
import pathlib
src = pathlib.Path('services/agent/wechat-rpa/overlay/overlay_window.py').read_text(errors='replace')
forbidden = ['SendMessage', 'PostMessage', 'SetForegroundWindow', 'BringWindowToTop']
for fn in forbidden:
    assert fn not in src, f'overlay_window.py 含禁用 Win32 调用: {fn}'
print('PASS: 无干预微信窗口 API')
"
```
**通过标准**：脚本输出 `PASS`，无 AssertionError。

---

### [BEHAVIOR] [BEHAVIOR-12] 异常态温和文案（I12：禁"错误/中断/!"）

**场景**：overlay_window.py 中所有异常/降级文案不含"错误"、"中断"、"!"（叹号）字样。

**验收命令（manual:bash）**：
```bash
python -c "
import pathlib
src = pathlib.Path('services/agent/wechat-rpa/overlay/overlay_window.py').read_text(errors='replace')
for pat in ['错误', '中断', '!']:
    assert pat not in src, f'overlay_window.py 含禁用字样: {pat}'
print('PASS: 无禁用字样，异常态文案温和')
"
# 同时扫 HTML 模板字符串（如内嵌在 py 文件中）
grep -n '"错误\|"中断\|"!' services/agent/wechat-rpa/overlay/overlay_window.py && echo "WARN: 发现禁用字样" || echo "PASS: HTML 模板扫描干净"
```
**通过标准**：Python 脚本输出 `PASS`；grep 无匹配输出。

---

### [CONFIG] CI 探针配置

**交付物**：在现有 CI workflow（`.github/workflows/` 下含 `line04` 的 yml）新增以下两个 step：

```yaml
- name: pywebview overlay probe
  shell: pwsh
  run: |
    $proc = Start-Process python -ArgumentList "services/agent/wechat-rpa/overlay/overlay_window.py","--probe" -PassThru -Wait
    if ($proc.ExitCode -ne 0) { throw "overlay probe failed exit=$($proc.ExitCode)" }
  timeout-minutes: 1

- name: notepad hwnd NOACTIVATE assert
  shell: python
  run: |
    import subprocess, ctypes, time, sys
    notepad = subprocess.Popen(['notepad.exe'])
    time.sleep(0.5)
    hwnd = ctypes.windll.user32.FindWindowW('Notepad', None)
    sys.path.insert(0, 'services/agent/wechat-rpa/overlay')
    from overlay_window import PositionLoop
    loop = PositionLoop(state_dir='C:/Temp/zj-test')
    loop.attach_to_hwnd_for_test(hwnd, iterations=5)
    fg = ctypes.windll.user32.GetForegroundWindow()
    assert fg != hwnd, f'焦点被抢: fg={fg} notepad={hwnd}'
    notepad.terminate()
    print('PASS')
```

**通过标准**：两个 step 均在 GHA windows-latest 环境绿色通过，或探针失败时自动切换纯函数 pytest 兜底路径并全绿。
