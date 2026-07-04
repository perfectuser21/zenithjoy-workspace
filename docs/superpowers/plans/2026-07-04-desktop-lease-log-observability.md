# Desktop-Lease-Broker 日志落盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `listen_chat.py` stderr（含 desktop-lease-broker 的 `[desktop_lease] acquire/release` 诊断日志）从"只 console.warn 到没人读的 pipe"改成"同时落盘到可查文件"，让真实生产流量下这套仲裁机制是否真的运行有据可查。

**Architecture:** 导出现有 `config-loader.ts` 的 `getConfigDir()`；在 `wechat-rpa.ts` 新增一个纯函数 `appendListenChatLog(chunk, opts?)`，在 stderr 回调里追加调用；写入失败/超限走 try/catch + 简单大小轮转，不影响原有行为。

**Tech Stack:** Node.js/TypeScript，`node:fs`/`node:path`，Vitest（用 `process.env.APPDATA` 做临时目录测试隔离，沿用 `config-loader.ts` 现有约定）。

---

### Task 1: 导出 `getConfigDir()`

**Files:**
- Modify: `services/agent/src/config-loader.ts:27`

- [ ] **Step 1: 改动**

第 27 行原文：
```ts
function getConfigDir(): string {
```
改为：
```ts
export function getConfigDir(): string {
```

- [ ] **Step 2: 确认 typecheck 不报错**

Run: `cd services/agent && npx tsc --noEmit -p . 2>&1 | grep -v "import.meta"`
Expected: 无新增错误（只可能出现已知的 `import.meta` 测试文件警告，忽略）

- [ ] **Step 3: Commit**

```bash
git add services/agent/src/config-loader.ts
git commit -m "refactor(agent): 导出 getConfigDir 供 wechat-rpa 日志落盘复用

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 新增 `appendListenChatLog` + 单测（TDD）

**Files:**
- Modify: `services/agent/src/handlers/wechat-rpa.ts`
- Test: `services/agent/src/handlers/__tests__/wechat-rpa-log.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `services/agent/src/handlers/__tests__/wechat-rpa-log.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('appendListenChatLog [BEHAVIOR]', () => {
  let tmpDir: string;
  let origAppData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-log-test-'));
    origAppData = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (origAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = origAppData;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入 chunk 后日志文件包含该内容', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    appendListenChatLog('[desktop_lease] acquire granted lease_id=test-001\n');

    const logFile = path.join(tmpDir, 'zenithjoy-agent', 'logs', 'listen-chat.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('[desktop_lease] acquire granted lease_id=test-001');
  });

  it('超过轮转阈值 → 旧内容进 .old，新内容进新文件', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    const logDir = path.join(tmpDir, 'zenithjoy-agent', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    // 预先写入一段超过阈值（用小阈值参数化，避免真写 5MB 拖慢测试）
    fs.writeFileSync(logFile, 'OLD_CONTENT_MARKER'.repeat(10));

    appendListenChatLog('NEW_LINE_AFTER_ROTATE\n', { maxBytes: 50 });

    const oldFile = path.join(logDir, 'listen-chat.log.old');
    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.readFileSync(oldFile, 'utf-8')).toContain('OLD_CONTENT_MARKER');

    const newContent = fs.readFileSync(logFile, 'utf-8');
    expect(newContent).toContain('NEW_LINE_AFTER_ROTATE');
    expect(newContent).not.toContain('OLD_CONTENT_MARKER');
  });

  it('写入失败（mock fs.appendFileSync 抛异常）不向上抛出', async () => {
    const { appendListenChatLog } = await import('../wechat-rpa');
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    expect(() => appendListenChatLog('irrelevant\n')).not.toThrow();

    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/wechat-rpa-log.test.ts`
Expected: 3 个测试全部 FAIL，报错含 `appendListenChatLog is not a function` 或类似（函数还不存在）

- [ ] **Step 3: 写最小实现**

在 `services/agent/src/handlers/wechat-rpa.ts` 顶部 import 区（第 8-12 行附近）加一行：
```ts
import { getConfigDir } from '../config-loader.js';
```

在文件里找到 `export function startWechatListener` 定义之前（约第 240 行之前的空白处）插入：

```ts
// Sprint 0703-line04-desktop-lease-broker（可观测性补线）：
// listen_chat.py stderr（含 desktop-lease-broker 的 [desktop_lease] 诊断行）此前只
// console.warn，module-manager fork 子进程时不监听其 stdout/stderr，这些输出写进了
// 没人读的 pipe，不落盘、不进 Brain，无法观测。本函数把同一份内容旁路落盘，供排障翻查。
const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

export function appendListenChatLog(
  chunk: string,
  opts?: { maxBytes?: number },
): void {
  try {
    const logDir = path.join(getConfigDir(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'listen-chat.log');
    const maxBytes = opts?.maxBytes ?? DEFAULT_LOG_MAX_BYTES;

    if (fs.existsSync(logFile) && fs.statSync(logFile).size > maxBytes) {
      const oldFile = path.join(logDir, 'listen-chat.log.old');
      fs.renameSync(logFile, oldFile);
    }
    fs.appendFileSync(logFile, chunk);
  } catch {
    // 磁盘满/权限问题绝不能让 listen_chat 崩溃——console.warn 已有兜底可见性。
  }
}
```

然后在 `startWechatListener` 内部的 `child.stderr!.on('data', ...)` 回调（现有代码）追加调用：

原文：
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

Run: `cd services/agent && npx vitest run src/handlers/__tests__/wechat-rpa-log.test.ts`
Expected: 3 个测试全部 PASS

- [ ] **Step 5: 跑 wechat-rpa 现有测试确认没有回归**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/wechat-rpa.test.ts src/handlers/__tests__/desktop-lease-broker-wireup.test.ts`
Expected: 全部 PASS（不应因为新 import 或函数插入而破坏现有测试）

- [ ] **Step 6: Commit**

```bash
git add services/agent/src/handlers/wechat-rpa.ts services/agent/src/handlers/__tests__/wechat-rpa-log.test.ts
git commit -m "feat(line04): listen_chat stderr 落盘（desktop-lease-broker 可观测性）

新增 appendListenChatLog：把 stderr 内容（含 [desktop_lease] acquire/
release 诊断行）旁路落盘到 <agent配置目录>/logs/listen-chat.log，5MB
阈值简单轮转，写入失败静默降级不影响 listen_chat 运行。此前这些日志
只 console.warn，module-manager fork 子进程时不监听其输出，实际写进
了没人读的 pipe，真机验证时发现无法观测 desktop-lease-broker 是否真
的在生产里被触发——本 commit 补上这个可观测性缺口。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 注册测试到 test-registry.yaml（CI 门禁要求）

**Files:**
- Modify: `test-registry.yaml`

- [ ] **Step 1: 找到 desktop-lease-broker-wireup 条目附近位置插入新条目**

在 `test-registry.yaml` 里搜索 `id: desktop-lease-broker-wireup`，在该条目之后插入：

```yaml
- id: desktop-lease-broker-log-observability
  path: services/agent/src/handlers/__tests__/wechat-rpa-log.test.ts
  type: unit
  ci: L2
  status: active
  product: 客户私域AI接管
  note: "listen_chat stderr 落盘可观测性：写入/轮转/写入失败静默降级三条 [BEHAVIOR] 单测"
```

- [ ] **Step 2: 确认没有其它遗漏的孤儿测试文件**

Run: `git status --short | grep -E '\.(test|spec)\.(ts|py)$'`
Expected: 只列出 `wechat-rpa-log.test.ts`（本次新增的唯一测试文件），确认已在 Step 1 登记

- [ ] **Step 3: Commit**

```bash
git add test-registry.yaml
git commit -m "chore(ci): 登记 wechat-rpa-log 测试文件到 test-registry.yaml

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: package.json 版本 bump（碰了 services/agent/src 闸门要求）

**Files:**
- Modify: `services/agent/package.json`

- [ ] **Step 1: 查当前 main 上的版本号**

Run: `git show origin/main:services/agent/package.json | grep '"version"'`
Expected: 输出当前版本号，如 `"version": "2.0.74",`（记下这个数字，下一步 bump 最后一位）

- [ ] **Step 2: bump patch 版本**

编辑 `services/agent/package.json`，把 `"version"` 字段最后一位数字加 1（例如 `2.0.74` → `2.0.75`；具体以 Step 1 查到的当前值为准）。

- [ ] **Step 3: Commit**

```bash
git add services/agent/package.json
git commit -m "chore(agent): version bump (碰 services/agent/src 闸门要求)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + Push + PR

**Files:** 无新文件，本任务只跑验证 + 提交流程

- [ ] **Step 1: 跑 agent 全量 vitest，确认无新增失败**

Run: `cd services/agent && npx vitest run 2>&1 | tail -30`
Expected: 失败数与本次改动前一致（已知的 22 个环境预置失败：缺 playwright-core / 旧 sprint TDD-red 遗留 / 硬编码 `/workspace/` 路径——与本次改动无关，不需要修）；新增的 `wechat-rpa-log.test.ts` 3 个测试在通过列表里

- [ ] **Step 2: Push**

```bash
git push origin cp-07041537-desktop-lease-log-observability
```

- [ ] **Step 3: 建 PR**

```bash
gh pr create --repo perfectuser21/zenithjoy-workspace \
  --head cp-07041537-desktop-lease-log-observability --base main \
  --title "feat(line04): desktop-lease-broker stderr 落盘可观测性" \
  --body "$(cat <<'EOF'
## Summary

真机验证 PR#1085（desktop-lease-broker 接线）时发现：`listen_chat.py` 的
`[desktop_lease] acquire/release` 诊断日志只 console.warn，module-manager
fork 子进程时不监听其 stdout/stderr，这些日志实际上写进了没人读的 pipe，
不落盘、不进 Brain，无法观测——没法证明真实客户消息处理时这套仲裁机制
真的被触发。

本 PR 补上这个可观测性缺口：新增 `appendListenChatLog`，把 stderr 内容
旁路落盘到 `<agent配置目录>/logs/listen-chat.log`（5MB 阈值简单轮转，
写入失败静默降级不影响 listen_chat 运行）。不改 DesktopLeaseBroker 状态
机、reply_in_chat_with_lease、registerLeaseBrokerRoutes 任何业务逻辑。

设计文档：`docs/superpowers/specs/2026-07-04-desktop-lease-log-observability-design.md`

**Path 推进声明**：本 PR 推进 Line04（客户私域 AI 接管）"桌面租约仲裁层"
feature 的可观测性，为后续真实流量验证/生产排障提供依据，不涉及新
Golden Path 步骤。

## Test plan
- [x] appendListenChatLog 写入/轮转/写入失败静默降级 3 个单测 PASS
- [x] wechat-rpa 现有测试无回归
- [x] test-registry.yaml 已登记新测试文件
- [x] services/agent/package.json 已 bump
- [ ] CI 全绿

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 记录 PR URL，交给 engine-ship / engine-pr-watchdog 后续流程**

PR 创建后，`gh pr create` 输出的 URL 会被 `post-pr-create.sh` hook 自动接管——按 hook 提示调用 `engine-pr-watchdog` 轮询直到合并。
