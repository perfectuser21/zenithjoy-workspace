// services/agent/src/__tests__/startup-reset.test.ts
//
// TDD commit-1: 先行 failing tests —— planStartupReset + executeStartupReset checklist 验证。
// proven-to-fire 守卫：任何一类脏状态不再产出动作 → 断言立即红。
// CI 护栏：isCI=true 时 kill/delete 类动作降级为 plan-only（actionsExecuted=0）。

import { describe, it, expect, vi } from 'vitest';
import {
  planStartupReset,
  executeStartupReset,
  type StartupResetState,
  type StartupResetAction,
} from '../startup-reset';

const CLEAN: StartupResetState = {
  selfPid: 100,
  isCI: false,
  orphanRpaProcs: [],
  weixinTopLevelCount: 1,
  pythonEmbeddedExists: true,
  configConsistencyOk: true,
  configConsistencyDetail: '',
  wreckageFiles: [],
  staleScheduledTasks: [],
  staleLockFiles: [],
};

// ─── planStartupReset 纯函数测试 ────────────────────────────────────────────

describe('planStartupReset — 启动归零计划（纯函数，proven-to-fire）', () => {
  it('干净状态 → 空动作清单（幂等）', () => {
    expect(planStartupReset(CLEAN)).toEqual([]);
  });

  // ① 进程归零 — 孤儿 RPA
  it('① 孤儿 RPA python 进程 → kill_orphan_rpa，含 pid 和 cmdline', () => {
    const state: StartupResetState = {
      ...CLEAN,
      orphanRpaProcs: [
        { pid: 1234, cmdline: 'python listen_chat.py' },
        { pid: 5678, cmdline: 'python overlay_window.py --mode=silent' },
      ],
    };
    const actions = planStartupReset(state);
    const kills = actions.filter((a) => a.type === 'kill_orphan_rpa') as Extract<StartupResetAction, { type: 'kill_orphan_rpa' }>[];
    expect(kills).toHaveLength(2);
    expect(kills.map((a) => a.pid).sort()).toEqual([1234, 5678]);
    expect(kills.find((a) => a.pid === 1234)?.cmdline).toMatch(/listen_chat/);
  });

  it('① 无孤儿 RPA → 不产出 kill_orphan_rpa', () => {
    const actions = planStartupReset(CLEAN);
    expect(actions.some((a) => a.type === 'kill_orphan_rpa')).toBe(false);
  });

  // ② 微信归一
  it('② 微信顶层树 > 1 → kill_extra_weixin_tree', () => {
    const state: StartupResetState = { ...CLEAN, weixinTopLevelCount: 4 };
    const actions = planStartupReset(state);
    expect(actions.some((a) => a.type === 'kill_extra_weixin_tree')).toBe(true);
  });

  it('② 微信顶层树 = 1（正常）→ 不产出 kill_extra_weixin_tree', () => {
    const actions = planStartupReset({ ...CLEAN, weixinTopLevelCount: 1 });
    expect(actions.some((a) => a.type === 'kill_extra_weixin_tree')).toBe(false);
  });

  it('② 微信顶层树 = 0（未启动）→ 不产出 kill_extra_weixin_tree', () => {
    const actions = planStartupReset({ ...CLEAN, weixinTopLevelCount: 0 });
    expect(actions.some((a) => a.type === 'kill_extra_weixin_tree')).toBe(false);
  });

  // ③ 环境自检
  it('③ python-embedded 不存在 → report_env_gap，gaps 含 "python-embedded"', () => {
    const state: StartupResetState = { ...CLEAN, pythonEmbeddedExists: false };
    const actions = planStartupReset(state);
    const gap = actions.find((a) => a.type === 'report_env_gap') as Extract<StartupResetAction, { type: 'report_env_gap' }> | undefined;
    expect(gap).toBeDefined();
    expect(gap!.gaps.some((g) => /python-embedded/i.test(g))).toBe(true);
  });

  it('③ config apiUrl 不一致 → report_env_gap，gaps 含 detail', () => {
    const state: StartupResetState = {
      ...CLEAN,
      configConsistencyOk: false,
      configConsistencyDetail: 'apiUrl mismatch: .env=ws://a config.json=ws://b',
    };
    const actions = planStartupReset(state);
    const gap = actions.find((a) => a.type === 'report_env_gap') as Extract<StartupResetAction, { type: 'report_env_gap' }> | undefined;
    expect(gap).toBeDefined();
    expect(gap!.gaps.some((g) => /mismatch/i.test(g))).toBe(true);
  });

  it('③ python-embedded 缺 + config 不一致 → 单 report_env_gap 含两项 gap', () => {
    const state: StartupResetState = {
      ...CLEAN,
      pythonEmbeddedExists: false,
      configConsistencyOk: false,
      configConsistencyDetail: 'apiUrl mismatch',
    };
    const actions = planStartupReset(state);
    const gaps = actions.filter((a) => a.type === 'report_env_gap');
    expect(gaps).toHaveLength(1);
    const gap = gaps[0] as Extract<StartupResetAction, { type: 'report_env_gap' }>;
    expect(gap.gaps.length).toBeGreaterThanOrEqual(2);
  });

  it('③ 环境干净 → 不产出 report_env_gap', () => {
    const actions = planStartupReset(CLEAN);
    expect(actions.some((a) => a.type === 'report_env_gap')).toBe(false);
  });

  // ④ 残骸清理
  it('④ Public 下残骸文件 → delete_wreckage_file 每文件一条', () => {
    const state: StartupResetState = {
      ...CLEAN,
      wreckageFiles: [
        'C:\\Users\\Public\\zj-debug-1.txt',
        'C:\\Users\\Public\\zj-debug-2.txt',
        'C:\\Users\\Public\\test_click_result.txt',
      ],
    };
    const actions = planStartupReset(state);
    const dels = actions.filter((a) => a.type === 'delete_wreckage_file') as Extract<StartupResetAction, { type: 'delete_wreckage_file' }>[];
    expect(dels).toHaveLength(3);
    expect(dels.map((a) => a.path)).toContain('C:\\Users\\Public\\zj-debug-1.txt');
  });

  it('④ 一次性诊断计划任务 → delete_stale_task 每任务一条', () => {
    const state: StartupResetState = {
      ...CLEAN,
      staleScheduledTasks: ['ZJDbg20240101', 'ZJDiag_abc', 'ZJClick_xyz'],
    };
    const actions = planStartupReset(state);
    const dels = actions.filter((a) => a.type === 'delete_stale_task') as Extract<StartupResetAction, { type: 'delete_stale_task' }>[];
    expect(dels).toHaveLength(3);
    expect(dels.map((a) => a.taskName).sort()).toEqual(['ZJClick_xyz', 'ZJDbg20240101', 'ZJDiag_abc']);
  });

  it('④ 陈旧锁文件（持有 PID 已死）→ delete_stale_lock', () => {
    const state: StartupResetState = {
      ...CLEAN,
      staleLockFiles: ['C:\\Users\\asus\\.zenithjoy-agent\\agent.lock'],
    };
    const actions = planStartupReset(state);
    const dels = actions.filter((a) => a.type === 'delete_stale_lock') as Extract<StartupResetAction, { type: 'delete_stale_lock' }>[];
    expect(dels).toHaveLength(1);
    expect(dels[0].path).toContain('agent.lock');
  });

  // 多类脏状态并存
  it('多类脏状态并存 → 动作齐全互不吞并', () => {
    const state: StartupResetState = {
      selfPid: 100,
      isCI: false,
      orphanRpaProcs: [{ pid: 200, cmdline: 'python listen_chat.py' }],
      weixinTopLevelCount: 3,
      pythonEmbeddedExists: false,
      configConsistencyOk: false,
      configConsistencyDetail: 'apiUrl mismatch',
      wreckageFiles: ['C:\\Users\\Public\\zj-x.txt'],
      staleScheduledTasks: ['ZJDbg001', 'ZJDiag002'],
      staleLockFiles: ['C:\\u\\.zenithjoy-agent\\agent.lock'],
    };
    const types = planStartupReset(state).map((a) => a.type);
    expect(types).toContain('kill_orphan_rpa');
    expect(types).toContain('kill_extra_weixin_tree');
    expect(types).toContain('report_env_gap');
    expect(types).toContain('delete_wreckage_file');
    expect(types).toContain('delete_stale_task');
    expect(types).toContain('delete_stale_lock');
  });
});

// ─── executeStartupReset checklist 测试 ────────────────────────────────────

describe('executeStartupReset — checklist 执行与上报', () => {
  it('干净状态 → 4 步全 pass，durationMs > 0', () => {
    let t = 0;
    const result = executeStartupReset(CLEAN, { nowMs: () => (t += 10) });
    expect(result.items).toHaveLength(4);
    expect(result.items.every((i) => i.status === 'pass')).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.ciMode).toBe(false);
  });

  it('孤儿 RPA 进程 → step:orphan_rpa actionsPlanned>0，非 CI 下 actionsExecuted>0', () => {
    const killed: number[] = [];
    const state: StartupResetState = {
      ...CLEAN,
      orphanRpaProcs: [{ pid: 999, cmdline: 'python listen_chat.py' }],
    };
    const result = executeStartupReset(state, {
      killPid: (pid) => killed.push(pid),
    });
    const step = result.items.find((i) => i.step === 'orphan_rpa')!;
    expect(step.actionsPlanned).toBe(1);
    expect(step.actionsExecuted).toBe(1);
    expect(killed).toContain(999);
  });

  it('CI 模式下 kill/delete 动作 planned 但不执行（actionsExecuted=0）', () => {
    const killed: number[] = [];
    const deleted: string[] = [];
    const state: StartupResetState = {
      ...CLEAN,
      isCI: true,
      orphanRpaProcs: [{ pid: 777, cmdline: 'python listen_chat.py' }],
      wreckageFiles: ['C:\\Users\\Public\\zj-x.txt'],
      staleScheduledTasks: ['ZJDbg001'],
      staleLockFiles: ['C:\\u\\agent.lock'],
    };
    const result = executeStartupReset(state, {
      killPid: (pid) => killed.push(pid),
      deleteFile: (p) => deleted.push(p),
      deleteScheduledTask: (n) => deleted.push(n),
    });
    expect(result.ciMode).toBe(true);
    expect(killed).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    // planned 仍计数，方便 diag 看脏状态
    const orphanStep = result.items.find((i) => i.step === 'orphan_rpa')!;
    expect(orphanStep.actionsPlanned).toBeGreaterThan(0);
    expect(orphanStep.actionsExecuted).toBe(0);
  });

  it('微信顶层堆积 → step:weixin_converge actionsPlanned=1，非 CI 下 killWeixinTrees 被调用', () => {
    let weixinKillCalled = false;
    const state: StartupResetState = { ...CLEAN, weixinTopLevelCount: 2 };
    const result = executeStartupReset(state, {
      killWeixinTrees: () => { weixinKillCalled = true; },
    });
    const step = result.items.find((i) => i.step === 'weixin_converge')!;
    expect(step.actionsPlanned).toBe(1);
    expect(step.actionsExecuted).toBe(1);
    expect(weixinKillCalled).toBe(true);
  });

  it('env 缺项 → step:env_check status=fail，detail 含缺项名', () => {
    const state: StartupResetState = {
      ...CLEAN,
      pythonEmbeddedExists: false,
      configConsistencyOk: false,
      configConsistencyDetail: 'apiUrl mismatch',
    };
    const result = executeStartupReset(state, {});
    const step = result.items.find((i) => i.step === 'env_check')!;
    expect(step.status).toBe('fail');
    expect(step.detail).toMatch(/python-embedded/i);
  });

  it('残骸清理步骤 — wreckageFiles + staleScheduledTasks + staleLockFiles 各自计入 actionsPlanned', () => {
    const state: StartupResetState = {
      ...CLEAN,
      wreckageFiles: ['f1', 'f2'],
      staleScheduledTasks: ['ZJDbg001'],
      staleLockFiles: ['lock1'],
    };
    const result = executeStartupReset(state, {
      deleteFile: () => {},
      deleteScheduledTask: () => {},
    });
    const step = result.items.find((i) => i.step === 'wreckage_cleanup')!;
    expect(step.actionsPlanned).toBe(4); // 2 files + 1 task + 1 lock
    expect(step.actionsExecuted).toBe(4);
  });

  it('dep 抛错 → 该 step status=fail，其它 step 不受影响', () => {
    const state: StartupResetState = {
      ...CLEAN,
      orphanRpaProcs: [{ pid: 123, cmdline: 'python listen_chat.py' }],
      wreckageFiles: ['C:\\Users\\Public\\zj-x.txt'],
    };
    const result = executeStartupReset(state, {
      killPid: () => { throw new Error('权限不足'); },
      deleteFile: () => {},
    });
    const orphanStep = result.items.find((i) => i.step === 'orphan_rpa')!;
    expect(orphanStep.status).toBe('fail');
    const wreckageStep = result.items.find((i) => i.step === 'wreckage_cleanup')!;
    expect(wreckageStep.status).toBe('pass');
  });
});
