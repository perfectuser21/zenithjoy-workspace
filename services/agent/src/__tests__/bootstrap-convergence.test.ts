// services/agent/src/__tests__/bootstrap-convergence.test.ts
//
// 用户定的启动纪律（decision 72740815，2026-07-04）：Agent 启动第零阶段 = 幂等环境收敛。
// 在连中台 / 下载任何东西 / 拉任何模块之前，先把机器收敛回干净状态：
//   ① 清场：杀重复 agent 实例、杀不再活跃版本的僵尸启动循环
//   ② 修自启：计划任务指向已删目录 → 当场改正
//   ③ 验配置：缺 license / 缺 .env → 上报具体缺什么，不静默
//
// planConvergence 是纯函数（状态入 → 动作清单出），CI 可测；执行层只是逐条执行动作。
// proven-to-fire：任何一类脏状态不再产出对应收敛动作 → 断言立即红。

import { describe, it, expect } from 'vitest';
import {
  planConvergence, classifyOrphanRpaPythons, listTopLevelWeixinPids,
  isDebrisFile, isStaleLockFile, isStaleOnceZjTask, apiPointingConsistent,
  executeConvergence, describeAction, gatherEnvState,
  type EnvState, type ProcRow, type ConvergenceAction,
} from '../bootstrap-convergence';

const CLEAN: EnvState = {
  selfPid: 100,
  selfAncestorPids: [999],
  agentProcesses: [{ pid: 100, imageName: 'zenithjoy-agent.exe' }],
  launcherLoops: [{ pid: 200, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.bat' }],
  activeCoreName: 'zenithjoy-agent-v2.0.75',
  scheduledTask: { exists: true, targetPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.vbs', targetExists: true },
  licensePresent: true,
  // ── startup-reset 字段
  orphanRpaPythons: [],
  weixinTopLevelPids: [500],
  coreDirEnv: { expectedDir: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75', persisted: true },
  pythonEmbeddedPresent: true,
  envConfigConsistent: true,
  debrisFiles: [],
  staleOnceZjTasks: [],
  staleLockFiles: [],
};

describe('planConvergence — 幂等环境收敛计划（纯函数）', () => {
  it('干净状态 → 空动作清单（幂等）', () => {
    expect(planConvergence(CLEAN)).toEqual([]);
  });

  it('重复 agent 实例 → 对其它实例产出 kill_duplicate_agent，绝不杀自己', () => {
    const state: EnvState = {
      ...CLEAN,
      agentProcesses: [
        { pid: 100, imageName: 'zenithjoy-agent.exe' },
        { pid: 333, imageName: 'zenithjoy-agent.exe' },
        { pid: 444, imageName: 'zenithjoy-agent.exe' },
      ],
    };
    const actions = planConvergence(state);
    const kills = actions.filter((a) => a.type === 'kill_duplicate_agent');
    expect(kills.map((a) => a.pid).sort()).toEqual([333, 444]);
    expect(kills.some((a) => a.pid === 100)).toBe(false);
  });

  it('僵尸启动循环（bat 路径版本 ≠ activeCore）→ kill_stale_launcher', () => {
    const state: EnvState = {
      ...CLEAN,
      launcherLoops: [
        { pid: 200, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75\\start.bat' },
        { pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' },
        { pid: 202, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.52\\start.bat' },
      ],
    };
    const actions = planConvergence(state);
    const kills = actions.filter((a) => a.type === 'kill_stale_launcher');
    expect(kills.map((a) => a.pid).sort()).toEqual([201, 202]);
  });

  it('计划任务指向已删目录 → reregister_autostart', () => {
    const state: EnvState = {
      ...CLEAN,
      scheduledTask: { exists: true, targetPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.vbs', targetExists: false },
    };
    const actions = planConvergence(state);
    expect(actions.some((a) => a.type === 'reregister_autostart')).toBe(true);
  });

  it('计划任务不存在 → reregister_autostart', () => {
    const state: EnvState = {
      ...CLEAN,
      scheduledTask: { exists: false, targetPath: null, targetExists: false },
    };
    expect(planConvergence(state).some((a) => a.type === 'reregister_autostart')).toBe(true);
  });

  it('缺 license → report_config_gap（上报具体缺什么，不静默）', () => {
    const state: EnvState = { ...CLEAN, licensePresent: false };
    const actions = planConvergence(state);
    const gap = actions.find((a) => a.type === 'report_config_gap');
    expect(gap).toBeDefined();
    expect((gap as { detail: string }).detail).toMatch(/license/i);
  });

  it('多类脏状态并存 → 动作齐全且互不吞并', () => {
    const state: EnvState = {
      selfPid: 100,
      selfAncestorPids: [999],
      agentProcesses: [
        { pid: 100, imageName: 'zenithjoy-agent.exe' },
        { pid: 333, imageName: 'zenithjoy-agent.exe' },
      ],
      launcherLoops: [{ pid: 201, batPath: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.69\\start.bat' }],
      activeCoreName: 'zenithjoy-agent-v2.0.75',
      scheduledTask: { exists: true, targetPath: 'C:\\u\\x\\start.vbs', targetExists: false },
      licensePresent: false,
      orphanRpaPythons: [],
      weixinTopLevelPids: [500],
      coreDirEnv: { expectedDir: 'C:\\u\\Desktop\\zenithjoy-agent-v2.0.75', persisted: true },
      pythonEmbeddedPresent: true,
      envConfigConsistent: true,
      debrisFiles: [],
      staleOnceZjTasks: [],
      staleLockFiles: [],
    };
    const types = planConvergence(state).map((a) => a.type);
    expect(types).toContain('kill_duplicate_agent');
    expect(types).toContain('kill_stale_launcher');
    expect(types).toContain('reregister_autostart');
    expect(types).toContain('report_config_gap');
  });
});

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
  it('混合触发器（TimeTrigger + LogonTrigger）→ 非纯一次性，保守不删', () => {
    expect(isStaleOnceZjTask('ZJDbg0708', ['MSFT_TaskTimeTrigger', 'MSFT_TaskLogonTrigger'])).toBe(false);
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
