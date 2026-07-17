# agent 启动归零 startup-reset 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent core 启动第零阶段扩展 5 项归零能力（孤儿 RPA python 清理 / 微信顶层树归一 / 环境自检 / 残骸清理 / checklist 心跳上报），CI plan-only 护栏。

**Architecture:** 全部落在现有 `services/agent/src/bootstrap-convergence.ts` 三段结构（纯函数 plan + 采集 gather + 执行 execute）上做增量；checklist 经心跳 `module_status.startup_reset` 伪 key 上报（服务端零改动）。设计文档：`docs/superpowers/specs/2026-07-17-agent-startup-reset-design.md`。

**Tech Stack:** TypeScript (Node 18+)、vitest、Windows PowerShell/schtasks/setx（采集与执行层，全 best-effort）。

## Global Constraints

- 所有输出/注释简体中文；注释风格对齐 bootstrap-convergence.ts 现有密度
- TDD 死律：每个 task 两段 commit——commit-1 失败测试（`test(agent): ...`），commit-2 实现（`fix(agent): ...`）。**禁止 `feat:` 前缀**（触发 lint-feature-has-smoke）
- 收敛纪律不变：任何采集/执行失败不阻断启动；采集失败按"干净"处理（宁可漏杀不误杀）
- 不触碰 `services/agent/modules/**`（模块文件不动 → 不触发 line04 1.0.134 九处 bump）
- 测试命令：`cd services/agent && npx vitest run src/__tests__/<file>`
- worktree 内改代码文件用 Edit/Write 工具（bash-guard 拦 sed/heredoc 直改）

---

### Task 1: 纯逻辑层——判定 helpers + EnvState/Action 扩展 + planConvergence 新分支

**Files:**
- Modify: `services/agent/src/bootstrap-convergence.ts`（类型区 :14-41、planConvergence :44-79）
- Test: `services/agent/src/__tests__/bootstrap-convergence.test.ts`（扩展）
- Modify: `services/agent/src/__tests__/bootstrap-convergence-no-selfkill.test.ts`（仅补 CLEAN fixture 新字段）

**Interfaces:**
- Produces（后续 task 依赖，签名精确）：

```ts
export interface ProcRow { pid: number; ppid: number; name: string }
export const RESIDENT_RPA_SCRIPTS: readonly string[];  // ['listen_chat.py', 'overlay_window.py']
export function classifyOrphanRpaPythons(
  pythonProcs: { pid: number; ppid: number; cmd: string }[],
  livePids: Set<number>,
): { pid: number; script: string }[];
export function listTopLevelWeixinPids(procTable: ProcRow[]): number[];
export function isDebrisFile(fileName: string, mtimeMs: number, nowMs: number): boolean;
export function isStaleLockFile(fileName: string, mtimeMs: number, nowMs: number): boolean;
export function isStaleOnceZjTask(taskName: string, triggerClasses: string[]): boolean;
export function apiPointingConsistent(envUrl: string | null, cfgUrl: string | null): boolean | null;
// EnvState 新增 8 个必填字段（见 Step 3）；ConvergenceAction 新增 6 个类型（见 Step 3）
```

- [ ] **Step 1: 写失败测试**（追加到 `bootstrap-convergence.test.ts`；同时给两个测试文件的现有 fixture 补新字段干净默认值，保证编译）

CLEAN fixture 补丁（两个测试文件里所有 EnvState 字面量都加）：

```ts
  orphanRpaPythons: [],
  weixinTopLevelPids: [500],
  coreDirEnv: { expectedDir: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75', persisted: true },
  pythonEmbeddedPresent: true,
  envConfigConsistent: true,
  debrisFiles: [],
  staleOnceZjTasks: [],
  staleLockFiles: [],
```

新增测试（追加 describe 块）：

```ts
import {
  planConvergence, classifyOrphanRpaPythons, listTopLevelWeixinPids,
  isDebrisFile, isStaleLockFile, isStaleOnceZjTask, apiPointingConsistent,
  type EnvState, type ProcRow,
} from '../bootstrap-convergence';

const DAY = 86_400_000;

describe('classifyOrphanRpaPythons — 孤儿判据=父 PID 已死（decision 9edc14f2）', () => {
  const procs = [
    { pid: 10, ppid: 1000, cmd: 'python.exe C:\\mod\\wechat-rpa\\listen_chat.py' },
    { pid: 11, ppid: 2000, cmd: 'python.exe C:\\mod\\wechat-rpa\\overlay\\overlay_window.py' },
    { pid: 12, ppid: 1000, cmd: 'python.exe C:\\other\\unrelated.py' },
    { pid: 13, ppid: 3000, cmd: 'python.exe listen_chat.py --dryrun' },
  ];
  it('父 PID 死 + 命令行匹配常驻脚本 → 孤儿', () => {
    const live = new Set([2000, 3000]);  // 1000 已死
    expect(classifyOrphanRpaPythons(procs, live)).toEqual([{ pid: 10, script: 'listen_chat.py' }]);
  });
  it('父 PID 活 → 不是孤儿（CI 同机直跑 dryrun 不误杀）', () => {
    const live = new Set([1000, 2000, 3000]);
    expect(classifyOrphanRpaPythons(procs, live)).toEqual([]);
  });
  it('非常驻脚本（send_chat 等短命）永不入列', () => {
    expect(classifyOrphanRpaPythons([{ pid: 20, ppid: 1, cmd: 'python.exe send_chat.py' }], new Set())).toEqual([]);
  });
});

describe('listTopLevelWeixinPids — 顶层树口径（#1358 真机验证）', () => {
  it('父进程非 Weixin.exe 才算顶层；wxocr 等子进程不算', () => {
    const t: ProcRow[] = [
      { pid: 1, ppid: 0, name: 'explorer.exe' },
      { pid: 2, ppid: 1, name: 'Weixin.exe' },
      { pid: 3, ppid: 2, name: 'Weixin.exe' },   // 子进程
      { pid: 4, ppid: 1, name: 'Weixin.exe' },   // 第二个顶层
    ];
    expect(listTopLevelWeixinPids(t).sort()).toEqual([2, 4]);
  });
  it('父进程不在表里（父已死）→ 按顶层算', () => {
    expect(listTopLevelWeixinPids([{ pid: 9, ppid: 777, name: 'Weixin.exe' }])).toEqual([9]);
  });
});

describe('isDebrisFile / isStaleLockFile — 残骸与陈旧锁（decisions 47606e73 / e463d71a）', () => {
  const now = 100 * DAY;
  it('zj-/test_/send_ 前缀 + >7 天 → 残骸', () => {
    expect(isDebrisFile('zj-diag-shot.png', now - 8 * DAY, now)).toBe(true);
    expect(isDebrisFile('test_click.py', now - 8 * DAY, now)).toBe(true);
    expect(isDebrisFile('send_probe.txt', now - 8 * DAY, now)).toBe(true);
  });
  it('7 天内 / 前缀不匹配 / .lock 文件 → 不是残骸', () => {
    expect(isDebrisFile('zj-listener.log', now - 6 * DAY, now)).toBe(false);
    expect(isDebrisFile('normal.txt', now - 30 * DAY, now)).toBe(false);
    expect(isDebrisFile('zj-launch-weixin.lock', now - 30 * DAY, now)).toBe(false); // 锁归 stale-lock 管
  });
  it('zj-*.lock >10 分钟 → 陈旧锁；10 分钟内 → 活锁不碰', () => {
    expect(isStaleLockFile('zj-launch-weixin.lock', now - 11 * 60_000, now)).toBe(true);
    expect(isStaleLockFile('zj-launch-weixin.lock', now - 5 * 60_000, now)).toBe(false);
    expect(isStaleLockFile('agent.lock', now - DAY, now)).toBe(false); // 非 zj- 前缀不碰
  });
});

describe('isStaleOnceZjTask — ZJ 前缀 + 仅 TimeTrigger + ≠ZenithJoyAgent 三重判定（decision b32e83a5）', () => {
  it('三条全中 → 可删', () => {
    expect(isStaleOnceZjTask('ZJDbg0708', ['MSFT_TaskTimeTrigger'])).toBe(true);
  });
  it('正式任务 ZenithJoyAgent 永不删（大小写不敏感）', () => {
    expect(isStaleOnceZjTask('ZenithJoyAgent', ['MSFT_TaskTimeTrigger'])).toBe(false);
    expect(isStaleOnceZjTask('zenithjoyagent', ['MSFT_TaskTimeTrigger'])).toBe(false);
  });
  it('非 ZJ 前缀 / 含非 once 触发器 / 触发器读不到（空）→ 保守不删', () => {
    expect(isStaleOnceZjTask('StartAllBrowsers', ['MSFT_TaskTimeTrigger'])).toBe(false);
    expect(isStaleOnceZjTask('ZJAgent', ['MSFT_TaskLogonTrigger'])).toBe(false);
    expect(isStaleOnceZjTask('ZJDbg0708', [])).toBe(false);
  });
});

describe('apiPointingConsistent — .env 与 config.json 指向一致性', () => {
  it('host 相同 → true；不同 → false', () => {
    expect(apiPointingConsistent('https://api.zenjoymedia.media', 'https://api.zenjoymedia.media/x')).toBe(true);
    expect(apiPointingConsistent('https://staging.zenjoymedia.media', 'https://api.zenjoymedia.media')).toBe(false);
  });
  it('任一缺失或解析失败 → null（不判）', () => {
    expect(apiPointingConsistent(null, 'https://a.b')).toBeNull();
    expect(apiPointingConsistent('not a url', 'https://a.b')).toBeNull();
  });
});

describe('planConvergence — startup-reset 新分支', () => {
  it('孤儿 python → kill_orphan_python 每进程一条', () => {
    const s: EnvState = { ...CLEAN, orphanRpaPythons: [{ pid: 71, script: 'listen_chat.py' }] };
    expect(planConvergence(s)).toContainEqual({ type: 'kill_orphan_python', pid: 71, script: 'listen_chat.py' });
  });
  it('顶层 Weixin >1 → converge_wechat 带全部顶层 pid；=1/0 → 无动作', () => {
    expect(planConvergence({ ...CLEAN, weixinTopLevelPids: [2, 4] }))
      .toContainEqual({ type: 'converge_wechat', pids: [2, 4] });
    expect(planConvergence({ ...CLEAN, weixinTopLevelPids: [2] }).some(a => a.type === 'converge_wechat')).toBe(false);
    expect(planConvergence({ ...CLEAN, weixinTopLevelPids: [] }).some(a => a.type === 'converge_wechat')).toBe(false);
  });
  it('coreDir 未持久化且有期望值 → persist_core_dir_env；expectedDir 为 null → 不动作', () => {
    expect(planConvergence({ ...CLEAN, coreDirEnv: { expectedDir: 'C:\\core', persisted: false } }))
      .toContainEqual({ type: 'persist_core_dir_env', dir: 'C:\\core' });
    expect(planConvergence({ ...CLEAN, coreDirEnv: { expectedDir: null, persisted: false } })
      .some(a => a.type === 'persist_core_dir_env')).toBe(false);
  });
  it('python-embedded 缺失 / env-config 不一致 → report_config_gap（非破坏性）', () => {
    const gaps = planConvergence({ ...CLEAN, pythonEmbeddedPresent: false, envConfigConsistent: false })
      .filter(a => a.type === 'report_config_gap');
    expect(gaps.length).toBe(2);
  });
  it('残骸/一次性任务/陈旧锁 → 各自 delete 动作', () => {
    const s: EnvState = {
      ...CLEAN,
      debrisFiles: ['C:\\Users\\Public\\zj-old.png'],
      staleOnceZjTasks: ['ZJDbg0708'],
      staleLockFiles: ['C:\\Users\\Public\\zj-launch-weixin.lock'],
    };
    const acts = planConvergence(s);
    expect(acts).toContainEqual({ type: 'delete_debris', path: 'C:\\Users\\Public\\zj-old.png' });
    expect(acts).toContainEqual({ type: 'delete_stale_task', taskName: 'ZJDbg0708' });
    expect(acts).toContainEqual({ type: 'delete_stale_lock', path: 'C:\\Users\\Public\\zj-launch-weixin.lock' });
  });
  it('干净状态仍是空清单（幂等不回归）', () => {
    expect(planConvergence(CLEAN)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent && npx vitest run src/__tests__/bootstrap-convergence.test.ts`
Expected: FAIL（新导出不存在 / EnvState 缺字段编译错）

- [ ] **Step 3: commit-1**

```bash
git add services/agent/src/__tests__/bootstrap-convergence.test.ts services/agent/src/__tests__/bootstrap-convergence-no-selfkill.test.ts
git commit -m "test(agent): startup-reset 纯逻辑层失败测试先行（孤儿判定/顶层树/残骸/ZJ任务/一致性/plan新分支）"
```

- [ ] **Step 4: 最小实现**（bootstrap-convergence.ts 类型区 + 纯函数区）

```ts
// ── startup-reset 纯判定层（decision 391063ef；判定点 9edc14f2/590031ea/e463d71a/47606e73/b32e83a5）──

export interface ProcRow { pid: number; ppid: number; name: string }

// 常驻 RPA 脚本（会成孤儿的候选）；短命脚本（send_chat 等）不入列——run-to-exit 自然回收
export const RESIDENT_RPA_SCRIPTS = ['listen_chat.py', 'overlay_window.py'] as const;

// 孤儿判据 = 父 PID 已死（不在存活进程表）。父活的一律不碰：
// CI job2 在同机直跑 listen_chat --dryrun（父=bash 活着）；活重复实例的 listener
// 由 kill_duplicate_agent 的 taskkill /t 树杀顺带回收，无需在此判。
export function classifyOrphanRpaPythons(
  pythonProcs: { pid: number; ppid: number; cmd: string }[],
  livePids: Set<number>,
): { pid: number; script: string }[] {
  const out: { pid: number; script: string }[] = [];
  for (const p of pythonProcs) {
    const cmd = (p.cmd || '').toLowerCase();
    const script = RESIDENT_RPA_SCRIPTS.find((s) => cmd.includes(s));
    if (script && !livePids.has(p.ppid)) out.push({ pid: p.pid, script });
  }
  return out;
}

// 顶层 Weixin = 父进程不是 Weixin.exe（父不在表=父死，也按顶层算）；wxocr 等子进程不算
export function listTopLevelWeixinPids(procTable: ProcRow[]): number[] {
  const nameOf = new Map(procTable.map((r) => [r.pid, r.name.toLowerCase()]));
  return procTable
    .filter((r) => r.name.toLowerCase() === 'weixin.exe' && nameOf.get(r.ppid) !== 'weixin.exe')
    .map((r) => r.pid);
}

const DEBRIS_MAX_AGE_MS = 7 * 86_400_000;
const LOCK_STALE_MS = 10 * 60_000; // 两把锁（agent.lock/zj-launch-weixin.lock）持有均为秒级，10min 必为崩溃遗留

export function isDebrisFile(fileName: string, mtimeMs: number, nowMs: number): boolean {
  const n = fileName.toLowerCase();
  if (n.endsWith('.lock')) return false; // 锁文件归 isStaleLockFile 管
  if (!/^(zj-|test_|send_)/.test(n)) return false;
  return nowMs - mtimeMs > DEBRIS_MAX_AGE_MS;
}

export function isStaleLockFile(fileName: string, mtimeMs: number, nowMs: number): boolean {
  const n = fileName.toLowerCase();
  if (!/^zj-.*\.lock$/.test(n)) return false; // agent.lock 由 single-instance 自愈，不碰
  return nowMs - mtimeMs > LOCK_STALE_MS;
}

// 三重判定缺一不删：ZJ 前缀 + 全部触发器为一次性 TimeTrigger（读不到=保守不删）+ 非正式任务名
export function isStaleOnceZjTask(taskName: string, triggerClasses: string[]): boolean {
  const n = taskName.toLowerCase();
  if (!n.startsWith('zj')) return false;
  if (n === 'zenithjoyagent') return false;
  if (triggerClasses.length === 0) return false;
  return triggerClasses.every((c) => c === 'MSFT_TaskTimeTrigger');
}

export function apiPointingConsistent(envUrl: string | null, cfgUrl: string | null): boolean | null {
  if (!envUrl || !cfgUrl) return null;
  try {
    return new URL(envUrl).host.toLowerCase() === new URL(cfgUrl).host.toLowerCase();
  } catch {
    return null;
  }
}
```

EnvState 新增字段（接在 licensePresent 后）：

```ts
  // ── startup-reset（decision 391063ef）──
  orphanRpaPythons: { pid: number; script: string }[];
  weixinTopLevelPids: number[];
  coreDirEnv: { expectedDir: string | null; persisted: boolean };
  pythonEmbeddedPresent: boolean;
  envConfigConsistent: boolean | null; // null = 判不了（缺一端/解析失败），不产生动作
  debrisFiles: string[];
  staleOnceZjTasks: string[];
  staleLockFiles: string[];
```

ConvergenceAction 新增：

```ts
  | { type: 'kill_orphan_python'; pid: number; script: string }
  | { type: 'converge_wechat'; pids: number[] }
  | { type: 'persist_core_dir_env'; dir: string }
  | { type: 'delete_debris'; path: string }
  | { type: 'delete_stale_task'; taskName: string }
  | { type: 'delete_stale_lock'; path: string };
```

planConvergence 追加（license 检查之后、return 之前）：

```ts
  // ④ startup-reset：孤儿 RPA python（判据=父死，decision 9edc14f2）
  for (const o of state.orphanRpaPythons) {
    actions.push({ type: 'kill_orphan_python', pid: o.pid, script: o.script });
  }
  // ⑤ 微信归一：顶层树>1 → 全杀，由后续任务经 launch_weixin()（#1358 锁+幂等）按需拉起
  if (state.weixinTopLevelPids.length > 1) {
    actions.push({ type: 'converge_wechat', pids: [...state.weixinTopLevelPids] });
  }
  // ⑥ 环境自检：OS 级 ZENITHJOY_CORE_DIR 幂等自愈（根治 A2 裸 python 弹窗）；缺件只报不修
  if (state.coreDirEnv.expectedDir && !state.coreDirEnv.persisted) {
    actions.push({ type: 'persist_core_dir_env', dir: state.coreDirEnv.expectedDir });
  }
  if (!state.pythonEmbeddedPresent) {
    actions.push({ type: 'report_config_gap', detail: 'python-embedded 缺失（core 目录无 python-embedded/python.exe，RPA 将掉裸 python 兜底弹 MS Store）' });
  }
  if (state.envConfigConsistent === false) {
    actions.push({ type: 'report_config_gap', detail: '.env 与 config.json 的 API 指向不一致（56cacd23 同类病）' });
  }
  // ⑦ 残骸清理
  for (const p of state.debrisFiles) actions.push({ type: 'delete_debris', path: p });
  for (const t of state.staleOnceZjTasks) actions.push({ type: 'delete_stale_task', taskName: t });
  for (const p of state.staleLockFiles) actions.push({ type: 'delete_stale_lock', path: p });
```

同时给 gatherEnvState 的初始 state 与 non-win early-return 补干净默认值（保证编译，win 采集在 Task 3）：

```ts
    orphanRpaPythons: [],
    weixinTopLevelPids: [],
    coreDirEnv: { expectedDir: null, persisted: true },
    pythonEmbeddedPresent: true,
    envConfigConsistent: null,
    debrisFiles: [],
    staleOnceZjTasks: [],
    staleLockFiles: [],
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd services/agent && npx vitest run src/__tests__/bootstrap-convergence.test.ts src/__tests__/bootstrap-convergence-no-selfkill.test.ts`
Expected: PASS 全绿

- [ ] **Step 6: 变异测试（守卫必须见红，feedback_mutation_test_the_guard）**

1. 把 `classifyOrphanRpaPythons` 里 `!livePids.has(p.ppid)` 临时改成 `livePids.has(p.ppid)` → 跑测试 → 必须红（"父活不误杀"用例翻车）→ 改回
2. 把 `isStaleOnceZjTask` 里 `if (n === 'zenithjoyagent') return false;` 临时删掉 → 跑测试 → 必须红 → 改回
3. 改回后再跑一次确认绿

- [ ] **Step 7: commit-2**

```bash
git add services/agent/src/bootstrap-convergence.ts
git commit -m "fix(agent): startup-reset 纯逻辑层——判定 helpers + EnvState/Action 扩展 + plan 新分支"
```

---

### Task 2: 执行层——新动作执行 + planOnly 护栏 + 结果返回

**Files:**
- Modify: `services/agent/src/bootstrap-convergence.ts`（executeConvergence :185-218）
- Test: `services/agent/src/__tests__/bootstrap-convergence.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 ConvergenceAction 全集
- Produces:

```ts
export interface ConvergenceResult { action: ConvergenceAction; executed: boolean; ok: boolean; error?: string }
export function describeAction(a: ConvergenceAction): string;  // 如 'delete_stale_task ZJTestOnce'（e2e 日志 grep 锚点）
export interface ConvergenceDeps {  // 新增可注入项
  killPid?; reregisterAutostart?; reportGap?; log?;
  deleteFile?: (path: string) => void;
  deleteTask?: (taskName: string) => void;
  persistEnv?: (name: string, value: string) => void;
}
export function executeConvergence(actions, deps?: ConvergenceDeps, opts?: { planOnly?: boolean }): ConvergenceResult[];
// planOnly=true：除 report_config_gap 外全部只记日志 '[bootstrap][plan-only] 将执行: <describeAction>' 不执行
```

- [ ] **Step 1: 写失败测试**

```ts
import { executeConvergence, describeAction, type ConvergenceAction } from '../bootstrap-convergence';

describe('executeConvergence — planOnly 护栏 + 结果返回', () => {
  const calls: string[] = [];
  const deps = {
    killPid: (pid: number) => { calls.push(`kill:${pid}`); },
    deleteFile: (p: string) => { calls.push(`rm:${p}`); },
    deleteTask: (t: string) => { calls.push(`deltask:${t}`); },
    persistEnv: (n: string, v: string) => { calls.push(`setx:${n}=${v}`); },
    reregisterAutostart: () => { calls.push('rereg'); },
    reportGap: (d: string) => { calls.push(`gap:${d}`); },
    log: () => {},
  };
  const ALL: ConvergenceAction[] = [
    { type: 'kill_orphan_python', pid: 7, script: 'listen_chat.py' },
    { type: 'converge_wechat', pids: [2, 4] },
    { type: 'persist_core_dir_env', dir: 'C:\\core' },
    { type: 'delete_debris', path: 'C:\\p\\zj-x.png' },
    { type: 'delete_stale_task', taskName: 'ZJDbg1' },
    { type: 'delete_stale_lock', path: 'C:\\p\\zj-a.lock' },
    { type: 'report_config_gap', detail: 'python-embedded 缺失' },
  ];

  it('正常模式全执行，逐条返回 executed=true ok=true', () => {
    calls.length = 0;
    const rs = executeConvergence(ALL, deps);
    expect(rs.every(r => r.executed && r.ok)).toBe(true);
    expect(calls).toEqual(['kill:7', 'kill:2', 'kill:4', 'setx:ZENITHJOY_CORE_DIR=C:\\core',
      'rm:C:\\p\\zj-x.png', 'deltask:ZJDbg1', 'rm:C:\\p\\zj-a.lock', 'gap:python-embedded 缺失']);
  });

  it('planOnly：破坏性动作零调用（executed=false ok=true），report_config_gap 照常', () => {
    calls.length = 0;
    const logs: string[] = [];
    const rs = executeConvergence(ALL, { ...deps, log: (m: string) => logs.push(m) }, { planOnly: true });
    expect(calls).toEqual(['gap:python-embedded 缺失']);
    expect(rs.filter(r => !r.executed).length).toBe(ALL.length - 1);
    expect(rs.every(r => r.ok)).toBe(true);
    expect(logs.some(l => l.includes('[plan-only] 将执行: delete_stale_task ZJDbg1'))).toBe(true);
  });

  it('单动作抛错 → 该条 ok=false 带 error，其余继续（不阻断）', () => {
    const rs = executeConvergence(ALL, { ...deps, killPid: () => { throw new Error('拒绝访问'); } });
    expect(rs[0]).toMatchObject({ executed: true, ok: false });
    expect(rs[0].error).toContain('拒绝访问');
    expect(rs[rs.length - 1].ok).toBe(true);
  });

  it('describeAction 稳定可 grep', () => {
    expect(describeAction({ type: 'delete_stale_task', taskName: 'ZJTestOnce' })).toBe('delete_stale_task ZJTestOnce');
    expect(describeAction({ type: 'converge_wechat', pids: [2, 4] })).toBe('converge_wechat pids=2,4');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd services/agent && npx vitest run src/__tests__/bootstrap-convergence.test.ts`，Expected: FAIL
- [ ] **Step 3: commit-1** — `git commit -m "test(agent): executeConvergence planOnly 护栏 + 结果返回失败测试"`
- [ ] **Step 4: 实现**（重写 executeConvergence；保持默认 deps 的真实现——killPid 仍 taskkill /f /t；新增默认实现 deleteFile=fs.unlinkSync、deleteTask=schtasks /delete /tn <n> /f、persistEnv=execFileSync('setx',[name,value])，全部 windowsHide+timeout 15s）

```ts
export interface ConvergenceResult { action: ConvergenceAction; executed: boolean; ok: boolean; error?: string }

export function describeAction(a: ConvergenceAction): string {
  switch (a.type) {
    case 'kill_duplicate_agent': return `kill_duplicate_agent pid=${a.pid}`;
    case 'kill_stale_launcher':  return `kill_stale_launcher pid=${a.pid}`;
    case 'reregister_autostart': return 'reregister_autostart';
    case 'report_config_gap':    return `report_config_gap ${a.detail}`;
    case 'kill_orphan_python':   return `kill_orphan_python pid=${a.pid} ${a.script}`;
    case 'converge_wechat':      return `converge_wechat pids=${a.pids.join(',')}`;
    case 'persist_core_dir_env': return `persist_core_dir_env ${a.dir}`;
    case 'delete_debris':        return `delete_debris ${a.path}`;
    case 'delete_stale_task':    return `delete_stale_task ${a.taskName}`;
    case 'delete_stale_lock':    return `delete_stale_lock ${a.path}`;
  }
}

export function executeConvergence(
  actions: ConvergenceAction[],
  deps: ConvergenceDeps = {},
  opts: { planOnly?: boolean } = {},
): ConvergenceResult[] {
  const log = deps.log ?? console.log;
  const killPid = deps.killPid ?? ((pid: number) => {
    execFileSync('taskkill', ['/f', '/t', '/pid', String(pid)], { windowsHide: true, timeout: 15_000 });
  });
  const reregister = deps.reregisterAutostart ?? (() => { /* 原实现原样保留 */ });
  const deleteFile = deps.deleteFile ?? ((p: string) => fs.unlinkSync(p));
  const deleteTask = deps.deleteTask ?? ((t: string) => {
    execFileSync('schtasks', ['/delete', '/tn', t, '/f'], { windowsHide: true, timeout: 15_000 });
  });
  const persistEnv = deps.persistEnv ?? ((name: string, value: string) => {
    execFileSync('setx', [name, value], { windowsHide: true, timeout: 15_000 });
  });

  const results: ConvergenceResult[] = [];
  for (const a of actions) {
    // report_config_gap 是唯一非破坏性动作，plan-only 也照常上报
    if (opts.planOnly && a.type !== 'report_config_gap') {
      log(`[bootstrap][plan-only] 将执行: ${describeAction(a)}`);
      results.push({ action: a, executed: false, ok: true });
      continue;
    }
    try {
      log(`[bootstrap] 收敛：${describeAction(a)}`);
      switch (a.type) {
        case 'kill_duplicate_agent':
        case 'kill_stale_launcher':
        case 'kill_orphan_python':  killPid(a.pid); break;
        case 'converge_wechat':     for (const pid of a.pids) killPid(pid); break;
        case 'reregister_autostart': reregister(); break;
        case 'report_config_gap':   deps.reportGap?.(a.detail); break;
        case 'persist_core_dir_env': persistEnv('ZENITHJOY_CORE_DIR', a.dir); break;
        case 'delete_debris':
        case 'delete_stale_lock':   deleteFile(a.path); break;
        case 'delete_stale_task':   deleteTask(a.taskName); break;
      }
      results.push({ action: a, executed: true, ok: true });
    } catch (e) {
      log(`[bootstrap] 收敛动作失败（继续其余）：${describeAction(a)} ${(e as Error).message}`);
      results.push({ action: a, executed: true, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
```

注意：converge_wechat 逐 pid try——单 pid 失败不吞整组？保持整组一个 result（动作粒度=清单粒度），逐 pid 失败由外层 catch 记 ok=false 即可（第一个失败即记错，可接受——真机验证兜底）。
- [ ] **Step 5: 跑测试确认全绿** — 同 Task 内全部用例 + 既有用例
- [ ] **Step 6: commit-2** — `git commit -m "fix(agent): executeConvergence 新动作执行 + planOnly 护栏 + ConvergenceResult 返回"`

---

### Task 3: 采集层——gatherEnvState 扩展（procTable 提升复用 + 6 类新采集）

**Files:**
- Modify: `services/agent/src/bootstrap-convergence.ts`（gatherEnvState :91-177）
- Test: `services/agent/src/__tests__/bootstrap-convergence.test.ts`（追加 non-win 分支用例）

**Interfaces:**
- Consumes: Task 1 的纯 helpers
- Produces: gatherEnvState opts 扩展（index.ts Task 5 调用）：

```ts
export function gatherEnvState(opts: {
  selfPid: number;
  activeCorePointerPath: string;
  taskName?: string;
  licensePresent: boolean;
  // ── startup-reset 新增（全部可选，默认见实现）──
  envApiBase?: string | null;    // process.env.ZENITHJOY_API_URL || ZENITHJOY_API_BASE
  configApiUrl?: string | null;  // cfg.apiUrl
  publicDir?: string;            // 默认 process.env.PUBLIC || 'C:\\Users\\Public'
  coreDir?: string;              // 默认 path.dirname(process.execPath)
  nowMs?: number;                // 默认 Date.now()
}): EnvState;
```

- [ ] **Step 1: 写失败测试**（non-win 早退分支是唯一可跨平台断言的采集行为）

```ts
describe('gatherEnvState — non-win 早退带齐 startup-reset 干净默认值', () => {
  it('非 Windows 返回全干净（不产生任何动作）', () => {
    if (process.platform === 'win32') return; // 真 Windows CI 上跳过
    const s = gatherEnvState({ selfPid: 1, activeCorePointerPath: '/nope', licensePresent: true });
    expect(s.orphanRpaPythons).toEqual([]);
    expect(s.weixinTopLevelPids).toEqual([]);
    expect(s.coreDirEnv.persisted).toBe(true);
    expect(s.pythonEmbeddedPresent).toBe(true);
    expect(s.envConfigConsistent).toBeNull();
    expect(s.debrisFiles).toEqual([]);
    expect(s.staleOnceZjTasks).toEqual([]);
    expect(s.staleLockFiles).toEqual([]);
    expect(planConvergence(s)).toEqual([]);
  });
});
```

- [ ] **Step 2: 确认失败**（Task 1 已给早退补默认值 → 此用例可能直接绿；若绿则本 task 只做 win 采集实现，跳到 Step 4，不硬造红）
- [ ] **Step 3: commit-1**（若 Step 2 有红）`git commit -m "test(agent): gatherEnvState non-win 早退干净默认值"`；全绿则跳过本步与 Step 6 合并 commit
- [ ] **Step 4: win 采集实现**（要点，逐段写进 gatherEnvState）

1. **procTable 提升**：现有祖先链 try 块里的全进程查询改为同时取 Name——
   `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name)" }`，
   解析成函数作用域 `procTable: ProcRow[]` 与 `parentOf: Map<number,number>`（祖先链逻辑不变），`livePids = new Set(procTable.map(r=>r.pid))`。
2. **孤儿 python**：定向查 `Name='python.exe' OR Name='pythonw.exe'` 带 CommandLine →
   `state.orphanRpaPythons = classifyOrphanRpaPythons(pyProcs, livePids)`。
3. **微信顶层**：`state.weixinTopLevelPids = listTopLevelWeixinPids(procTable)`（procTable 已含全进程，直接复用，不加查询）。
4. **coreDirEnv**：`expectedDir = opts.coreDir ?? path.dirname(process.execPath)`；
   `stored = psList('[Environment]::GetEnvironmentVariable(\'ZENITHJOY_CORE_DIR\',\'User\')').trim()`；
   `persisted = !!stored && stored.toLowerCase() === expectedDir.toLowerCase()`。
5. **pythonEmbeddedPresent**：`fs.existsSync(path.join(expectedDir, 'python-embedded', 'python.exe'))`。
6. **envConfigConsistent**：`apiPointingConsistent(opts.envApiBase ?? null, opts.configApiUrl ?? null)`。
7. **残骸/陈旧锁**：`fs.readdirSync(publicDir)` + `fs.statSync` 逐个 `isDebrisFile`/`isStaleLockFile`（单文件 stat 失败跳过）。
8. **一次性 ZJ 任务**：
   `psList("Get-ScheduledTask | Where-Object { $_.TaskName -like 'ZJ*' } | ForEach-Object { \"$($_.TaskName)|$(($_.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ',')\" }")`，
   逐行 parse → `isStaleOnceZjTask(name, classes)` 过滤。读不到/空输出 → []。
   每段独立 try/catch，失败按"干净"处理（与现有采集纪律一致）。

- [ ] **Step 5: 跑全量 agent 单测** — Run: `cd services/agent && npx vitest run`，Expected: 全绿（tsc 编译过 = 采集签名正确）
- [ ] **Step 6: commit-2** — `git commit -m "fix(agent): gatherEnvState 采集 6 类归零状态——procTable 提升复用+孤儿python+微信顶层+env自检+残骸+ZJ任务"`

---

### Task 4: checklist 汇总纯函数 + moduleStatus 合并 helper

**Files:**
- Modify: `services/agent/src/bootstrap-convergence.ts`（追加两个纯函数）
- Test: `services/agent/src/__tests__/bootstrap-convergence.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 EnvState、Task 2 ConvergenceResult
- Produces（index.ts Task 5 依赖）：

```ts
export interface StartupResetReport { ok: boolean; reason?: string }
export function buildStartupResetReport(state: EnvState, results: ConvergenceResult[], planOnly: boolean): StartupResetReport;
export function mergeStartupReset<T extends Record<string, unknown>>(moduleReport: T, startupReset: StartupResetReport): T & { startup_reset: StartupResetReport };
```

- [ ] **Step 1: 写失败测试**

```ts
import { buildStartupResetReport, mergeStartupReset } from '../bootstrap-convergence';

describe('buildStartupResetReport — 5 项 checklist 汇总', () => {
  it('干净 + 零动作 → ok=true reason=干净', () => {
    const r = buildStartupResetReport(CLEAN, [], false);
    expect(r.ok).toBe(true);
    expect(r.reason).toContain('干净');
  });
  it('动作全成功 → ok=true reason 带动作数', () => {
    const rs = [{ action: { type: 'delete_debris', path: 'x' } as const, executed: true, ok: true }];
    expect(buildStartupResetReport(CLEAN, rs, false)).toMatchObject({ ok: true });
  });
  it('任一动作失败 → ok=false reason 点名 describeAction + 错误', () => {
    const rs = [{ action: { type: 'kill_orphan_python', pid: 7, script: 'listen_chat.py' } as const, executed: true, ok: false, error: '拒绝访问' }];
    const r = buildStartupResetReport(CLEAN, rs, false);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('kill_orphan_python');
    expect(r.reason).toContain('拒绝访问');
  });
  it('python-embedded 缺失 / env 不一致 → ok=false（缺项报红，即使无动作失败）', () => {
    expect(buildStartupResetReport({ ...CLEAN, pythonEmbeddedPresent: false }, [], false).ok).toBe(false);
    expect(buildStartupResetReport({ ...CLEAN, envConfigConsistent: false }, [], false).ok).toBe(false);
  });
  it('planOnly → ok=true reason 前缀 plan-only(ci) 且带计划动作数', () => {
    const rs = [{ action: { type: 'delete_stale_task', taskName: 'ZJTestOnce' } as const, executed: false, ok: true }];
    const r = buildStartupResetReport(CLEAN, rs, true);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/^plan-only\(ci\)/);
  });
  it('reason 超长截断到 400 字符内（服务端 500 上限留余量）', () => {
    const rs = Array.from({ length: 50 }, (_, i) => ({
      action: { type: 'delete_debris', path: `C:\\很长的路径\\zj-file-${i}.png` } as const,
      executed: true, ok: false, error: '占用',
    }));
    expect(buildStartupResetReport(CLEAN, rs, false).reason!.length).toBeLessThanOrEqual(400);
  });
});

describe('mergeStartupReset — 合并不丢真模块 key（覆盖式快照坑）', () => {
  it('真模块 key 原样保留 + startup_reset 注入', () => {
    const merged = mergeStartupReset({ 'line04-wechat-cs': { ok: true } }, { ok: false, reason: 'x' });
    expect(merged['line04-wechat-cs']).toEqual({ ok: true });
    expect(merged.startup_reset).toEqual({ ok: false, reason: 'x' });
  });
});
```

- [ ] **Step 2: 确认失败** → **Step 3: commit-1** `git commit -m "test(agent): startup-reset checklist 汇总与 moduleStatus 合并失败测试"`
- [ ] **Step 4: 实现**

```ts
export interface StartupResetReport { ok: boolean; reason?: string }

// 5 项 checklist：①进程归零(kill_*) ②微信归一(converge_wechat) ③环境自检(persist/gap)
// ④残骸清理(delete_*) ⑤上报（本函数产物随心跳走）。缺项报红（proven-to-fire）。
export function buildStartupResetReport(
  state: EnvState,
  results: ConvergenceResult[],
  planOnly: boolean,
): StartupResetReport {
  const parts: string[] = [];
  const failures = results.filter((r) => !r.ok);
  for (const f of failures) parts.push(`${describeAction(f.action)} 失败:${f.error ?? '?'}`);
  if (!state.pythonEmbeddedPresent) parts.push('python-embedded 缺失');
  if (state.envConfigConsistent === false) parts.push('.env/config.json API 指向不一致');
  const ok = parts.length === 0;
  const prefix = planOnly ? 'plan-only(ci)｜' : '';
  const summary = ok
    ? (results.length === 0 ? '干净' : `归零完成:${results.length}项动作`)
    : parts.join('｜');
  const reason = (prefix + summary).slice(0, 400);
  return ok ? { ok, reason } : { ok, reason };
}

export function mergeStartupReset<T extends Record<string, unknown>>(
  moduleReport: T,
  startupReset: StartupResetReport,
): T & { startup_reset: StartupResetReport } {
  return { ...moduleReport, startup_reset: startupReset };
}
```

- [ ] **Step 5: 确认全绿** → **Step 6: commit-2** `git commit -m "fix(agent): buildStartupResetReport 汇总 + mergeStartupReset 合并 helper"`

---

### Task 5: index.ts 接线 + 版本 bump 2.0.83

**Files:**
- Modify: `services/agent/src/index.ts`（bootstrap 块 :506-522、startWs1HeartbeatLoop 内 loop.start() 前 :1082 附近、syncModulesFromHeartbeat :802-815）
- Modify: `services/agent/package.json`（version 2.0.82 → 2.0.83）

**Interfaces:**
- Consumes: gatherEnvState 新 opts、executeConvergence({planOnly})、buildStartupResetReport、mergeStartupReset、StartupResetReport

- [ ] **Step 1: 接线**（无新单测——逻辑全在已测纯函数里，index.ts 只是搬运；tsc + 既有测试守护）

模块级（import 区之后）：

```ts
// startup-reset checklist（decision 391063ef）：bootstrap 块填充，随心跳 module_status.startup_reset 上报
let startupResetReport: StartupResetReport = { ok: true, reason: 'startup-reset 未执行' };
```

bootstrap 块改造（保持 try/catch 非阻断骨架）：

```ts
  try {
    const rootDir = path.dirname(path.dirname(path.dirname(process.execPath)));
    // CI 护栏：GHA/CI 里破坏性动作 plan-only（纵深防御，windows-latest E2E 断言确定性）
    const planOnly = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
    const envState = gatherEnvState({
      selfPid: process.pid,
      activeCorePointerPath: path.join(rootDir, '.active-core'),
      licensePresent: Boolean(cfg.licenseKey || process.env.ZENITHJOY_LICENSE),
      envApiBase: process.env.ZENITHJOY_API_URL || process.env.ZENITHJOY_API_BASE || null,
      configApiUrl: cfg.apiUrl || null,
    });
    const actions = planConvergence(envState);
    if (actions.length) console.log(`[bootstrap] 环境收敛：${actions.length} 项脏状态待处理${planOnly ? '（plan-only）' : ''}`);
    else console.log('[bootstrap] 环境收敛：干净，无需处理');
    const results = executeConvergence(actions, {}, { planOnly });
    startupResetReport = buildStartupResetReport(envState, results, planOnly);
    console.log(`[bootstrap] startup-reset checklist: ok=${startupResetReport.ok} ${startupResetReport.reason ?? ''}`);
  } catch (e) {
    console.warn('[bootstrap] 环境收敛失败（non-fatal，继续启动）:', e);
    startupResetReport = { ok: false, reason: `startup-reset 异常: ${(e as Error).message}`.slice(0, 400) };
  }
```

import 行扩展：`import { gatherEnvState, planConvergence, executeConvergence, buildStartupResetReport, mergeStartupReset, type StartupResetReport } from './bootstrap-convergence';`

startWs1HeartbeatLoop 内（`loop.start()` 之前插一行——start() 同步 sendOnce 在首个 await 前就读 moduleStatus，放前面首拍即带）：

```ts
  loop.setModuleStatus(mergeStartupReset({}, startupResetReport));
  loop.start();
```

syncModulesFromHeartbeat 合并（替换 :809-812 的 guard 写法）：

```ts
  const report = moduleManager.getModuleStatusReport();
  loop.setModuleStatus(mergeStartupReset(report, startupResetReport));
```

package.json：`"version": "2.0.82"` → `"2.0.83"`（index.ts VERSION require 自动跟随，单一源，全仓无其它 2.0.82 硬编码——已 grep 验证）。

- [ ] **Step 2: 全量验证**

Run: `cd services/agent && npx vitest run && npx tsc --noEmit`
Expected: 测试全绿 + 类型检查过

- [ ] **Step 3: commit**（接线无独立测试文件，单 commit）

```bash
git add services/agent/src/index.ts services/agent/package.json
git commit -m "fix(agent): startup-reset 接线启动序列——CI plan-only + checklist 首拍心跳上报 + core 2.0.83"
```

---

### Task 6: E2E 断言——agent-e2e-video.yml 预埋脏状态 + 日志断言（环境接缝守卫）

**Files:**
- Modify: `.github/workflows/agent-e2e-video.yml`（"Start Agent (background)" :160 前加 seed 步，agent 启动就绪后加断言步）

**Interfaces:**
- Consumes: Task 2 的 describeAction 日志格式（`[bootstrap][plan-only] 将执行: delete_stale_task ZJTestOnce`）

- [ ] **Step 1: 在 "Start Agent (background)" 步之前插入 seed 步**

```yaml
      # startup-reset E2E（decision 391063ef）：预埋脏状态，断言 agent 启动第零阶段在 CI 里 plan-only 识别
      # 真机段等价断言：真删除/真 setx/微信收敛在 windows-latest 不可及，
      # TODO 部署 rog 后人工 proven-to-fire（藏 python-embedded → AdminCustomersPage startup_reset 红行）
      - name: Seed dirty state for startup-reset assertion
        shell: powershell
        run: |
          schtasks /create /tn ZJTestOnce /sc once /st 23:59 /tr "cmd /c echo zj-e2e" /f
          $debris = Join-Path $env:PUBLIC 'zj-e2e-debris.txt'
          Set-Content -Path $debris -Value 'e2e'
          (Get-Item $debris).LastWriteTime = (Get-Date).AddDays(-8)
```

- [ ] **Step 2: 在 agent 启动就绪等待步之后（上传 artifact 步之前）插入断言步**（读 workflow 现有结构定位，agent stdout 已重定向 `$env:RUNNER_TEMP\agent-out.log`）

```yaml
      - name: Assert startup-reset plan-only fired
        shell: powershell
        run: |
          $log = Join-Path $env:RUNNER_TEMP 'agent-out.log'
          $content = Get-Content $log -Raw
          if ($content -notmatch '\[bootstrap\]\[plan-only\] 将执行: delete_stale_task ZJTestOnce') {
            Write-Error "startup-reset 未识别预埋 ZJTestOnce 任务（plan-only 行缺失）"; exit 1
          }
          if ($content -notmatch '\[bootstrap\]\[plan-only\] 将执行: delete_debris .*zj-e2e-debris\.txt') {
            Write-Error "startup-reset 未识别预埋残骸文件"; exit 1
          }
          if ($content -notmatch '\[bootstrap\] startup-reset checklist: ok=') {
            Write-Error "startup-reset checklist 汇总行缺失"; exit 1
          }
          Write-Host "startup-reset plan-only 断言全过 ✅"
```

注意：该 workflow 是 workflow_dispatch 手动触发、测 COS 已发布核心包——断言只在 2.0.83 发包后 dispatch 才有效，与其 release-smoke 性质一致，不做 PR 门禁。

- [ ] **Step 3: YAML 校验** — Run: `npx yaml-lint .github/workflows/agent-e2e-video.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/agent-e2e-video.yml'))"`，Expected: 无报错
- [ ] **Step 4: commit** — `git commit -m "fix(ci): agent-e2e-video 预埋脏状态断言 startup-reset plan-only 开火（真机段等价断言+TODO标注）"`

---

## 收尾（由 finishing/engine-ship 承接，非 task）

- PR 标题：`fix(agent): startup-reset 启动归零——bootstrap-convergence 扩展5项+checklist心跳上报（2.0.83）`
- PR 描述铁律声明：「本 PR 保持 Path 1/2 smoke 全绿」+ Brain task 0f0368cf + decision 391063ef + 判定点 5+1 条
- merge 后：发 2.0.83 包 → 部署 rog → 真机 proven-to-fire（藏 python-embedded 看 startup_reset 红行；残骸/僵尸任务数下降；单 Weixin 顶层树）——记入 handoff 下一步

## Self-Review 已核

- Spec 覆盖：5 项归零全有 task（①Task1/3 ②Task1/3 ③Task1/3/5 ④Task1/2/3 ⑤Task4/5/6）；CI 护栏 Task2/5；变异测试 Task1 Step6；版本 bump Task5 ✅
- 占位符：无 TBD/TODO（Task6 的 TODO 是刻意写进 smoke 的真机段标注，铁律5 要求）✅
- 类型一致性：StartupResetReport/ConvergenceResult/describeAction/mergeStartupReset 各 task 签名互相对齐 ✅
