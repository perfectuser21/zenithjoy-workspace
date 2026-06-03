# Agent wechat-rpa 真实脚本接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 启动时自动拉起 `listen_chat.py` 监听微信，并将 `wechat_*` 任务分发到真实 Python 脚本（而非 dryrun 桩），内部运营团队 Windows 机器可直接使用。

**Architecture:** 修改 `wechat-rpa.ts` 的 `resolveScript()` 按 task.type 映射真实脚本路径，新增 `startWechatListener(apiBase)` 函数（Windows 才真启，非 Windows skip）；在 `index.ts` 启动时调用 `startWechatListener`；版本 bump 1.1.76→1.1.77 并重打包。

**Tech Stack:** Node.js/TypeScript（Agent），Python 3（pywinauto wechat-rpa），vitest（测试）

---

### Task 1: 新增 resolveScript 单测（RED）

**Files:**
- Modify: `services/agent/src/handlers/__tests__/wechat-rpa.test.ts`

- [ ] **Step 1: 在现有测试文件末尾追加 resolveScript 路径测试**

打开 `services/agent/src/handlers/__tests__/wechat-rpa.test.ts`，在末尾加：

```typescript
import { resolveScriptForTest } from '../wechat-rpa';
import path from 'path';

describe('resolveScript — 按 task.type 分发真实脚本 [BEHAVIOR]', () => {
  it('wechat_private_chat_send → send_chat.py', () => {
    const p = resolveScriptForTest('wechat_private_chat_send');
    expect(p).toContain('send_chat.py');
    expect(p).toContain('wechat-rpa');
  });

  it('wechat_qr_bind → qr_bind.py', () => {
    const p = resolveScriptForTest('wechat_qr_bind');
    expect(p).toContain('qr_bind.py');
  });

  it('wechat_moments_send → send_moment.py', () => {
    const p = resolveScriptForTest('wechat_moments_send');
    expect(p).toContain('send_moment.py');
  });
});

describe('startWechatListener — 非 Windows skip [BEHAVIOR]', () => {
  it('非 Windows 平台调用后不 throw，console.log 含 skip 字样', () => {
    // CI 跑 Linux，必然触发 skip 分支
    const { startWechatListener } = require('../wechat-rpa');
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    startWechatListener('http://localhost:5200');
    console.log = orig;
    // 非 Windows: 必须 log 含 '跳过' 或 'skip'（大小写不限）
    const joined = logs.join(' ').toLowerCase();
    expect(joined.includes('跳过') || joined.includes('skip') || joined.includes('非 windows')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认 RED（resolveScriptForTest 不存在）**

```bash
cd services/agent && npx vitest run src/handlers/__tests__/wechat-rpa.test.ts 2>&1 | tail -20
```

期望输出：FAIL，含 `resolveScriptForTest is not a function` 或 export not found。

---

### Task 2: 修改 wechat-rpa.ts — resolveScript + REAL_PUBLISH + startWechatListener（GREEN）

**Files:**
- Modify: `services/agent/src/handlers/wechat-rpa.ts`

- [ ] **Step 1: 读当前文件确认结构**

确认 `resolveScript`、`handleWechatRpa`、spawn 调用位置（约第 16-50 行）。

- [ ] **Step 2: 替换 resolveScript，新增 resolveScriptForTest 和 startWechatListener**

将 `wechat-rpa.ts` 改为以下内容（保留原有 interface 定义和 handleWechatRpa，只改 resolveScript 和新增导出）：

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface WechatRpaTask {
  type: 'wechat_qr_bind' | 'wechat_moments_send' | 'wechat_private_chat_send';
  payload: Record<string, unknown>;
  pythonStub?: string;
}

export interface WechatRpaResult {
  ok: boolean;
  receipt?: Record<string, unknown>;
  error?: string;
}

// 测试专用导出：暴露路径解析逻辑（不依赖 task 对象）
export function resolveScriptForTest(type: WechatRpaTask['type']): string {
  const rpaDir = path.resolve(__dirname, '../../wechat-rpa');
  switch (type) {
    case 'wechat_private_chat_send': return path.join(rpaDir, 'send_chat.py');
    case 'wechat_qr_bind':           return path.join(rpaDir, 'qr_bind.py');
    case 'wechat_moments_send':      return path.join(rpaDir, 'send_moment.py');
    default:                         return path.join(rpaDir, 'send_chat.py');
  }
}

function resolveScript(task: WechatRpaTask): string {
  if (task.pythonStub) return task.pythonStub;
  return resolveScriptForTest(task.type);
}

export async function handleWechatRpa(task: WechatRpaTask): Promise<WechatRpaResult> {
  return new Promise((resolve) => {
    const script = resolveScript(task);
    const py = spawn('python3', [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, REAL_PUBLISH: '1' },
    });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => { stdout += d.toString(); });
    py.stderr.on('data', d => { stderr += d.toString(); });

    py.stdin.write(JSON.stringify({ type: task.type, payload: task.payload }) + '\n');
    py.stdin.end();

    py.on('close', code => {
      if (code !== 0) {
        return resolve({ ok: false, error: `python exit ${code}: ${stderr.slice(0, 200)}` });
      }
      try {
        const receipt = JSON.parse(stdout);
        resolve({ ok: true, receipt });
      } catch {
        resolve({ ok: false, error: `receipt parse fail: ${stdout.slice(0, 100)}` });
      }
    });

    py.on('error', e => {
      resolve({ ok: false, error: `spawn fail: ${e.message}` });
    });
  });
}

// Windows only：Agent 启动时自动拉起 listen_chat.py 持续监听微信消息
export function startWechatListener(apiBase: string): void {
  if (process.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  const script = path.resolve(__dirname, '../../wechat-rpa/listen_chat.py');
  spawn('python3', [script, '--middleware-url', apiBase], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  console.log('[wechat-rpa] listen_chat.py 已自启（middleware-url:', apiBase, '）');
}
```

- [ ] **Step 3: 运行测试确认 GREEN**

```bash
cd services/agent && npx vitest run src/handlers/__tests__/wechat-rpa.test.ts 2>&1 | tail -20
```

期望：所有测试 PASS（含原有 dryrun qr_bind 测试，它用 `pythonStub` 所以不受路径变更影响）。

- [ ] **Step 4: commit**

```bash
cd services/agent
git add src/handlers/wechat-rpa.ts src/handlers/__tests__/wechat-rpa.test.ts
git commit -m "feat(wechat-rpa): resolveScript 接真实脚本 + startWechatListener（Windows only）

- resolveScript() 按 task.type 分发 send_chat/qr_bind/send_moment.py
- handleWechatRpa spawn 加 REAL_PUBLISH=1 环境变量
- 新增 startWechatListener(apiBase)：Windows 真启 listen_chat.py，非 Windows skip
- resolveScriptForTest 测试导出 + 非 Windows skip 单测"
```

---

### Task 3: index.ts 启动时调用 startWechatListener

**Files:**
- Modify: `services/agent/src/index.ts`

- [ ] **Step 1: 在 import 块里加 startWechatListener**

找到文件顶部 import 区域，找到这行：
```typescript
import { handleWechatRpa, type WechatRpaTask } from './handlers/wechat-rpa';
```
改为：
```typescript
import { handleWechatRpa, startWechatListener, type WechatRpaTask } from './handlers/wechat-rpa';
```

- [ ] **Step 2: 在 startWs1HeartbeatLoop 调用后插入 startWechatListener**

找到文件第 483 行附近：
```typescript
  startWs1HeartbeatLoop(cfg);
```
在其后插入（利用已有的 `deriveHttpApiBase` 函数）：
```typescript
  startWs1HeartbeatLoop(cfg);

  // Path 4 Step 1 — Windows 自启微信监听（pywinauto，非 Windows 自动 skip）
  const _wechatApiBase = deriveHttpApiBase(cfg);
  if (_wechatApiBase) {
    startWechatListener(_wechatApiBase);
  }
```

- [ ] **Step 3: 运行 TypeScript 类型检查确认无报错**

```bash
cd services/agent && npx tsc --noEmit 2>&1 | head -20
```

期望：无 error 输出。

- [ ] **Step 4: commit**

```bash
cd services/agent
git add src/index.ts
git commit -m "feat(agent): 启动时自动调用 startWechatListener（Path 4 Step 1）

Agent 启动后在 startWs1HeartbeatLoop 之后调用 startWechatListener：
- Windows + pywinauto：spawn listen_chat.py --middleware-url <apiBase>
- 非 Windows / 无 apiBase：自动跳过，不影响其他功能"
```

---

### Task 4: 版本 bump + 重打包

**Files:**
- Modify: `services/agent/package.json`

- [ ] **Step 1: 版本从 1.1.76 改为 1.1.77**

打开 `services/agent/package.json`，将：
```json
"version": "1.1.76"
```
改为：
```json
"version": "1.1.77"
```

- [ ] **Step 2: 重新构建 dist**

```bash
cd services/agent && npm run build 2>&1 | tail -10
```

期望：无 error，`dist/index.js` 更新时间刷新。

- [ ] **Step 3: 确认 dist/handlers/wechat-rpa.js 含关键字**

```bash
grep -c "send_chat\|resolveScriptForTest\|startWechatListener" services/agent/dist/handlers/wechat-rpa.js
```

期望：输出 >= 3（三处关键字均存在）。

- [ ] **Step 4: commit**

```bash
cd services/agent
git add package.json dist/
git commit -m "chore(agent): bump 1.1.76→1.1.77 + rebuild dist（wechat-rpa 真实脚本接入）"
```

---

### Task 5: smoke test + push

**Files:**
- Create: `.github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh`

- [ ] **Step 1: 写 smoke 脚本（CI 可跑的 dryrun 路径验证）**

创建 `.github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh`：

```bash
#!/usr/bin/env bash
# wechat-rpa-real-agent-smoke.sh — Agent v1.1.77 wechat-rpa 真实脚本接入验证
#
# 验证（CI Linux 环境可跑）：
#   1. dist/handlers/wechat-rpa.js 含 send_chat.py / qr_bind.py / send_moment.py 路径映射
#   2. dist/handlers/wechat-rpa.js 含 REAL_PUBLISH 环境变量注入
#   3. dist/handlers/wechat-rpa.js 含 startWechatListener 导出
#   4. dist/handlers/wechat-rpa.js 含 win32 平台判断
#   5. Agent 版本号 == 1.1.77

set -euo pipefail

AGENT_DIR="services/agent"
DIST="$AGENT_DIR/dist/handlers/wechat-rpa.js"
PKG="$AGENT_DIR/package.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  wechat-rpa-real-agent smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[1] dist 含 send_chat.py 路径映射"
grep -q "send_chat.py" "$DIST" || { echo "FAIL: send_chat.py 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[2] dist 含 qr_bind.py 路径映射"
grep -q "qr_bind.py" "$DIST" || { echo "FAIL: qr_bind.py 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[3] dist 含 send_moment.py 路径映射"
grep -q "send_moment.py" "$DIST" || { echo "FAIL: send_moment.py 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[4] dist 含 REAL_PUBLISH 注入"
grep -q "REAL_PUBLISH" "$DIST" || { echo "FAIL: REAL_PUBLISH 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[5] dist 含 startWechatListener 导出"
grep -q "startWechatListener" "$DIST" || { echo "FAIL: startWechatListener 未找到"; exit 1; }
echo "  ✅ PASS"

echo "[6] dist 含 win32 平台判断"
grep -q "win32" "$DIST" || { echo "FAIL: win32 判断未找到"; exit 1; }
echo "  ✅ PASS"

echo "[7] Agent 版本 == 1.1.77"
VERSION=$(node -e "console.log(require('./$PKG').version)")
[ "$VERSION" = "1.1.77" ] || { echo "FAIL: 版本 $VERSION != 1.1.77"; exit 1; }
echo "  ✅ PASS"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ ALL 7 checks PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

- [ ] **Step 2: 加执行权限**

```bash
chmod +x .github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh
```

- [ ] **Step 3: 本地跑 smoke 验证**

```bash
bash .github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh
```

期望：`✅ ALL 7 checks PASSED`。

- [ ] **Step 4: 注册 smoke 测试到 test-registry.yaml（Orphan Check 要求）**

打开 `test-registry.yaml`，在末尾追加：

```yaml
  - id: agent-wechat-rpa-real-v1177
    path: .github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh
    type: smoke
    ci: L3
    status: active
    product: 客户私域AI接管
    note: "Agent v1.1.77 wechat-rpa 真实脚本接入验证（7 项静态检查，CI Linux 可跑）"
```

- [ ] **Step 5: commit + push**

```bash
git add .github/workflows/scripts/smoke/wechat-rpa-real-agent-smoke.sh test-registry.yaml
git commit -m "test(wechat-rpa): smoke 7 项静态验证 + test-registry 注册（v1.1.77）"
git push origin cp-0603121857-agent-wechat-rpa-real
```

---

## 完成标准

- [ ] `npx vitest run src/handlers/__tests__/wechat-rpa.test.ts` 全绿（含新增 resolveScript + skip 测试）
- [ ] `npx tsc --noEmit` 无报错
- [ ] `bash smoke/wechat-rpa-real-agent-smoke.sh` 7/7 PASS
- [ ] PR CI 全绿 → 合并
- [ ] Windows 内部机（xian-rog）启动 Agent v1.1.77 → 日志出现 `listen_chat.py 已自启`
