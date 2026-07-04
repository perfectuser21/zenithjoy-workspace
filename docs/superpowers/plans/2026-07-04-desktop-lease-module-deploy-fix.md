# Desktop-Lease-Broker 模块部署缺口修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把日志落盘代码（`appendListenChatLog`）真正加到 Line04 真实部署的模块文件 `services/agent/modules/line04/handlers/wechat-rpa.ts`（PR#1096 之前误改了 `services/agent/src/handlers/wechat-rpa.ts`，那份文件已 `@deprecated`，从不参与客户机模块编译），并 bump 三面版本号让客户机真的会重新下载。

**Architecture:** 在模块文件里内联一个自包含的日志落盘函数（不引入跨模块 import），接进现有 `startWechatListener` 的 `child.stderr.on('data', ...)` 回调；同步 bump `modules/line04/manifest.json` + `build-modules/line04/manifest.json` + `walking-skeleton.service.ts` 的 `required_version` 三面一致；重新跑 `build-line-module.sh line04` 生成新编译产物并提交。

**Tech Stack:** Node.js/TypeScript，`node:fs`/`node:path`/`node:os`，Vitest（复用仓库已有的 `_listenerKillFuncs.spawnFn` 注入 mock 模式）。

---

### Task 1: 先写失败的防回归测试

**Files:**
- Test: `services/agent/modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts`（新建）

- [ ] **Step 1: 创建测试文件**

```ts
// modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts
//
// 回归测试 — startWechatListener() 必须把 stderr 内容（含 desktop-lease-broker 的
// [desktop_lease] 诊断日志）落盘，不能只 console.warn。
//
// 背景：PR#1096 把 appendListenChatLog 加进了 services/agent/src/handlers/wechat-rpa.ts
// （@deprecated，Core 不再直接 import），真实客户机运行的是这份独立维护的模块文件，
// 之前完全没有落盘逻辑——这条测试防止未来再次"改对了逻辑但改错了文件"。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _listenerKillFuncs, startWechatListener, appendListenChatLog } from '../handlers/wechat-rpa';

describe('appendListenChatLog（模块内自包含实现）[BEHAVIOR]', () => {
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-module-log-test-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入 chunk 后日志文件包含该内容', () => {
    appendListenChatLog('[desktop_lease] acquire granted lease_id=test-001\n');

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain(
      '[desktop_lease] acquire granted lease_id=test-001',
    );
  });

  it('超过轮转阈值 → 旧内容进 .old，新内容进新文件', () => {
    const logDir = path.join(tmpDir, 'zenithjoy-agent', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    fs.writeFileSync(logFile, 'OLD_CONTENT_MARKER'.repeat(10));

    appendListenChatLog('NEW_LINE_AFTER_ROTATE\n', { maxBytes: 50 });

    const oldFile = path.join(logDir, 'listen-chat.log.old');
    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.readFileSync(oldFile, 'utf-8')).toContain('OLD_CONTENT_MARKER');
    const newContent = fs.readFileSync(logFile, 'utf-8');
    expect(newContent).toContain('NEW_LINE_AFTER_ROTATE');
    expect(newContent).not.toContain('OLD_CONTENT_MARKER');
  });

  it('写入失败（mock fs.appendFileSync 抛异常）不向上抛出', () => {
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    expect(() => appendListenChatLog('irrelevant\n')).not.toThrow();
    spy.mockRestore();
  });
});

describe('startWechatListener — stderr 必须调用 appendListenChatLog（真实部署路径接线）[ARTIFACT 防回归]', () => {
  let origSpawnFn: typeof _listenerKillFuncs.spawnFn;
  let origPlatform: string;
  let origKill: typeof _listenerKillFuncs.killExistingListeners;
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    origSpawnFn = _listenerKillFuncs.spawnFn;
    origPlatform = _listenerKillFuncs.platform;
    origKill = _listenerKillFuncs.killExistingListeners;
    _listenerKillFuncs.platform = 'win32';
    _listenerKillFuncs.killExistingListeners = () => {};

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-module-log-test2-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    _listenerKillFuncs.spawnFn = origSpawnFn;
    _listenerKillFuncs.platform = origPlatform;
    _listenerKillFuncs.killExistingListeners = origKill;
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stderr data 事件触发时，内容被落盘到 listen-chat.log', () => {
    let capturedHandler: ((d: Buffer) => void) | undefined;

    _listenerKillFuncs.spawnFn = vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event: string, handler: (d: Buffer) => void) => {
          if (event === 'data') capturedHandler = handler;
        }),
      },
      on: vi.fn(),
    })) as unknown as typeof _listenerKillFuncs.spawnFn;

    startWechatListener('http://localhost:3000', 'test-agent');

    expect(capturedHandler).toBeDefined();
    capturedHandler!(Buffer.from('[desktop_lease] acquire granted lease_id=abc\n'));

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8')).toContain('[desktop_lease] acquire granted lease_id=abc');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent && npx vitest run modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts`
Expected: 全部 FAIL，报错含 `appendListenChatLog is not a function` 或 import 找不到该导出（函数还不存在）

- [ ] **Step 3: Commit（Red）**

```bash
git add services/agent/modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts
git commit -m "test(line04): desktop-lease-broker 日志落盘补进真实模块文件（Red）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 实现 `appendListenChatLog` + 接线到真实模块文件

**Files:**
- Modify: `services/agent/modules/line04/handlers/wechat-rpa.ts`

- [ ] **Step 1: 在文件顶部 import 区（第 7-10 行附近）加一行**

原文：
```ts
import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
```
改为：
```ts
import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
```

- [ ] **Step 2: 在 `startWechatListener` 定义之前插入新函数**

找到：
```ts
// Windows only：模块激活时自动拉起 listen_chat.py 持续监听微信消息。
```
在这行**之前**插入：

```ts
// Sprint 0703-line04-desktop-lease-broker（部署缺口修复）：
// listen_chat.py stderr（含 desktop-lease-broker 的 [desktop_lease] 诊断行）此前只
// console.warn，没有任何地方落盘，无法观测。本函数把同一份内容旁路落盘到
// <AppData>/zenithjoy-agent/logs/listen-chat.log。不 import core 的 config-loader.ts
// （build-line-module.sh 只编译 modules/line04 下的文件，没有到 core src 的模块解析
// 路径），内联一份自包含的最小实现，跟本文件"模块目录/客户机路径自解析"的既有约定一致。
const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

function getAgentLogDir(): string {
  const base = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'zenithjoy-agent')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'zenithjoy-agent');
  return path.join(base, 'logs');
}

export function appendListenChatLog(
  chunk: string,
  opts?: { maxBytes?: number },
): void {
  try {
    const logDir = getAgentLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    const maxBytes = opts?.maxBytes ?? DEFAULT_LOG_MAX_BYTES;

    if (fs.existsSync(logFile) && fs.statSync(logFile).size > maxBytes) {
      fs.renameSync(logFile, path.join(logDir, 'listen-chat.log.old'));
    }
    fs.appendFileSync(logFile, chunk);
  } catch {
    // 磁盘满/权限问题绝不能让 listen_chat 崩溃——console.warn 已有兜底可见性。
  }
}

```

- [ ] **Step 3: 修改 `startWechatListener` 内的 stderr 回调**

找到（`startWechatListener` 函数体内，`spawnOnce` 里）：
```ts
    child.stderr!.on('data', (d: Buffer) => {
      console.warn('[listen_chat stderr]', d.toString().trim());
    });
```
改为：
```ts
    child.stderr!.on('data', (d: Buffer) => {
      const text = d.toString();
      console.warn('[listen_chat stderr]', text.trim());
      appendListenChatLog(text);
    });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd services/agent && npx vitest run modules/line04/__tests__/wechat-rpa-desktop-lease-log.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 跑模块现有全部测试确认无回归**

Run: `cd services/agent && npx vitest run modules/line04/__tests__/`
Expected: 全部 PASS（不应因为新增函数/import 破坏 `wechat-rpa-listener-stdout.test.ts` 等现有测试）

- [ ] **Step 6: Commit（Green）**

```bash
git add services/agent/modules/line04/handlers/wechat-rpa.ts
git commit -m "fix(line04): desktop-lease-broker 日志落盘补进真实部署的模块文件（Green）

PR#1096 把日志落盘代码加进了 services/agent/src/handlers/wechat-rpa.ts，
这个文件文件头标注 @deprecated，Core 不再直接 import；真实被
build-line-module.sh 编译进客户机安装包、实际运行 startWechatListener
的是这份独立维护的模块文件（sprint 06081700 模块化拆包时分叉）。之前
的修复完全没有到达真实部署路径——本 commit 把 appendListenChatLog
真正加到这里，接进 stderr 回调，日志落盘到
<AppData>/zenithjoy-agent/logs/listen-chat.log。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: bump 三面版本号

**Files:**
- Modify: `services/agent/modules/line04/manifest.json:3`
- Modify: `services/agent/build-modules/line04/manifest.json:3`
- Modify: `apps/api/src/services/walking-skeleton.service.ts:74`

- [ ] **Step 1: 改 `services/agent/modules/line04/manifest.json`**

原文（第 3 行）：
```json
  "version": "1.0.106",
```
改为：
```json
  "version": "1.0.107",
```

- [ ] **Step 2: 改 `services/agent/build-modules/line04/manifest.json`**

原文（第 3 行）：
```json
  "version": "1.0.106",
```
改为：
```json
  "version": "1.0.107",
```

- [ ] **Step 3: 改 `apps/api/src/services/walking-skeleton.service.ts`**

原文（第 74 行）：
```ts
  'line04-wechat-cs': { status: 'active', required_version: '1.0.106' },
```
改为：
```ts
  'line04-wechat-cs': { status: 'active', required_version: '1.0.107' },
```

- [ ] **Step 4: 用 CI 同款检查逻辑本地验证三面一致**

Run:
```bash
V_MOD=$(node -e "process.stdout.write(require('./services/agent/modules/line04/manifest.json').version)")
V_BUILD=$(node -e "process.stdout.write(require('./services/agent/build-modules/line04/manifest.json').version)")
V_HB=$(grep -oE "'line04-wechat-cs': \{ status: 'active', required_version: '[0-9.]+' \}" \
       apps/api/src/services/walking-skeleton.service.ts | grep -oE "[0-9]+\.[0-9]+\.[0-9]+")
echo "modules=$V_MOD build-modules=$V_BUILD heartbeat=$V_HB"
[ "$V_MOD" = "$V_BUILD" ] && [ "$V_MOD" = "$V_HB" ] && echo "OK: 三面一致 = $V_MOD" || echo "FAIL: 不一致"
```
Expected: `modules=1.0.107 build-modules=1.0.107 heartbeat=1.0.107` + `OK: 三面一致 = 1.0.107`

- [ ] **Step 5: Commit**

```bash
git add services/agent/modules/line04/manifest.json services/agent/build-modules/line04/manifest.json apps/api/src/services/walking-skeleton.service.ts
git commit -m "chore(line04): bump 三面版本号至 1.0.107（触发客户机真实重新下载）

modules/line04/manifest.json + build-modules/line04/manifest.json +
walking-skeleton.service.ts required_version 三面同步，否则客户机会
一直以为自己是最新版本，永远不会下载这次的 desktop-lease-broker 日志
落盘修复（CI 已有的三面一致闸门，修 #817 同类部署 gap）。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 重新编译 build-modules 并提交编译产物

**Files:**
- Modify: `services/agent/build-modules/line04/handlers/wechat-rpa.js`（编译产物）
- 可能同步变化：`build-modules/line04/index.js`、`build-modules/line04/preflight.js` 等同批编译产物（若 `modules/line04/*.ts` 有连带变化）

- [ ] **Step 1: 跑编译脚本**

Run: `cd services/agent && bash scripts/build-line-module.sh line04`
Expected: 输出 `[build-module] line04-wechat-cs-v1.0.107.tar.gz ready (-> dist-modules/)`，`build-modules/line04/` 目录内容被重新生成

- [ ] **Step 2: 确认编译产物含新代码**

Run: `grep -n "appendListenChatLog" services/agent/build-modules/line04/handlers/wechat-rpa.js`
Expected: 能找到匹配行（编译后的 JS 里应该出现这个函数名）

- [ ] **Step 3: 确认 wechat-rpa Python 源仍然同步（不应该被这次编译动到，只是复查）**

Run: `diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --exclude="*.pyc" --exclude="__pycache__"`
Expected: 无输出（同步）——这条本来就该一直成立，PR#1085 已经处理过，这里只是确认这次重新编译没有意外破坏

- [ ] **Step 4: 查看 git diff 确认改动范围合理**

Run: `git status --short services/agent/build-modules/`
Expected: 只有 `build-modules/line04/` 下的文件被修改（manifest.json 已在 Task 3 提交，这里应该主要是 `handlers/*.js`、`index.js`、`preflight.js`、`cs-config-gate.js` 等编译产物，以及 `wechat-rpa/` 目录如果有 rsync 产生的时间戳变化）

- [ ] **Step 5: Commit**

```bash
git add services/agent/build-modules/line04/
git commit -m "build(line04): 重新编译 build-modules（含 desktop-lease-broker 日志落盘）

跑 scripts/build-line-module.sh line04，把 modules/line04/handlers/wechat-rpa.ts
的 appendListenChatLog 编译进 build-modules/line04/handlers/wechat-rpa.js，
这是真正打进 OTA 安装包、发给客户机的产物。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + Push + PR

**Files:** 无新文件，本任务只跑验证 + 提交流程

- [ ] **Step 1: 跑 agent 全量 vitest，确认无新增失败**

Run: `cd services/agent && npx vitest run 2>&1 | tail -30`
Expected: 失败数与改动前一致（已知的环境预置失败：缺 playwright-core / 旧 sprint TDD-red 遗留 / 硬编码 `/workspace/` 路径——与本次改动无关）；新增的 `wechat-rpa-desktop-lease-log.test.ts` 全部 PASS

- [ ] **Step 2: Push**

```bash
git push origin cp-07041629-desktop-lease-module-deploy-fix
```

- [ ] **Step 3: 建 PR**

```bash
gh pr create --repo perfectuser21/zenithjoy-workspace \
  --head cp-07041629-desktop-lease-module-deploy-fix --base main \
  --title "fix(line04): desktop-lease-broker 日志落盘补进真实部署的模块文件" \
  --body "$(cat <<'EOF'
## Summary

PR#1096 把日志落盘代码（`appendListenChatLog`）加进了
`services/agent/src/handlers/wechat-rpa.ts`——这个文件文件头明确标注
`@deprecated`（"Core v2.0.0 不再直接 import 本文件"）。真正被
`build-line-module.sh` 编译进客户机安装包、实际运行 `startWechatListener`
的是独立维护的 `services/agent/modules/line04/handlers/wechat-rpa.ts`
（sprint 06081700 模块化拆包时分叉，此后两份文件独立维护）。日志落盘
代码进了没人在跑的文件，真实客户机从未收到这个修复。

同时发现两个前序 PR（#1085/#1096）都没有触发 line04 模块版本号 bump——
仓库里已有"line04 三个版本面一致（modules/build-modules/中台心跳）"CI
闸门（注释写着"防漂移守卫，修 #817 部署 gap 的根"），本该拦截这类问题
但因为没碰版本号而没触发。

本 PR：
- 把 `appendListenChatLog` 真正加到 `modules/line04/handlers/wechat-rpa.ts`
  （自包含实现，不 import core 的 config-loader，遵循本文件既有的
  "模块自解析路径"约定）
- bump 三面版本号至 1.0.107（`modules/line04/manifest.json` +
  `build-modules/line04/manifest.json` + `walking-skeleton.service.ts`
  `required_version`）
- 重新跑 `build-line-module.sh line04` 生成新编译产物并提交

**已确认不受影响、不需要改的部分**：PR#1085 的 Python 侧修复
（`listen_chat.py` 的 `reply_in_chat_with_lease`）走全局共享 Python 源，
不受 TS 文件分叉影响；`registerLeaseBrokerRoutes` 挂在 core 的
`index.ts` 是正确的架构位置（仲裁层单例）。

**Path 推进声明**：本 PR 修复 Line04（客户私域 AI 接管）"桌面租约仲裁层"
feature 的真实部署缺口，让之前两个 PR 的效果真正能到达客户机。

## Test plan
- [x] 新增 3 个 `appendListenChatLog` 单测（写入/轮转/写入失败降级）PASS
- [x] 新增 1 个"stderr 接线"防回归测试 PASS
- [x] 模块现有测试无回归
- [x] 本地验证三面版本号一致（modules=1.0.107 build-modules=1.0.107 heartbeat=1.0.107）
- [x] build-modules 编译产物含 `appendListenChatLog`
- [ ] CI 全绿（含"line04 三个版本面一致"和"build-modules 与源同步"两条已有闸门）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 记录 PR URL，交给 hook 自动接管的 engine-pr-watchdog 流程**

PR 创建后，`gh pr create` 输出的 URL 会被 `post-pr-create.sh` hook 自动接管——按 hook 提示调用 `engine-pr-watchdog` 轮询直到合并。
