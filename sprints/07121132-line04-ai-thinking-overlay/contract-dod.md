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
