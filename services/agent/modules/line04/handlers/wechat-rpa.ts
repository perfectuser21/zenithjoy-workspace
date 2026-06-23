// modules/line04/handlers/wechat-rpa.ts
//
// 从 services/agent/src/handlers/wechat-rpa.ts 迁移而来（sprint 06081700 模块化拆包）。
// 与原文件唯一区别：脚本/python 路径基于「模块目录」解析，而非 core.exe 同级目录。
// 模块安装后结构：<moduleDir>/{index.js, handlers/, wechat-rpa/<*.py>, python-embedded/python.exe}

import { spawn, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// 模块根目录：编译后本文件位于 <moduleDir>/handlers/wechat-rpa.js，上一级即模块根。
export function getModuleRoot(): string {
  return path.resolve(__dirname, '..');
}

// 测试用导出：允许注入 baseDir；bundled 模块含 python-embedded/python.exe。
// 若模块目录无 python-embedded，从 ZENITHJOY_CORE_DIR 找 core Agent 的 python-embedded。
export function getPythonExeForTest(baseDir: string): string {
  const embedded = path.join(baseDir, 'python-embedded', 'python.exe');
  if (fs.existsSync(embedded)) return embedded;
  const coreDir = process.env.ZENITHJOY_CORE_DIR;
  if (coreDir) {
    const coreEmbedded = path.join(coreDir, 'python-embedded', 'python.exe');
    if (fs.existsSync(coreEmbedded)) return coreEmbedded;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getPythonExe(): string {
  return getPythonExeForTest(getModuleRoot());
}

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

// 测试专用导出：暴露路径解析逻辑（基于模块根目录的 wechat-rpa/）。
export function resolveScriptForTest(type: WechatRpaTask['type'], rpaDir = path.join(getModuleRoot(), 'wechat-rpa')): string {
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
    const py = spawn(getPythonExe(), [script], {
      windowsHide: true,
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

// listen_chat.py 持久监听一整天（24h）。默认 300s 会让监听 5 分钟后自动退出，
// 客户机无人值守就此停摆 —— 这是 v1.1.80 客户装完"发消息没反应"的根因。
const LISTENER_TIMEOUT_SEC = 86400;
// 监听进程退出/崩溃后重启间隔（崩溃自愈，无需外部 watchdog / 计划任务）
const LISTENER_RESTART_DELAY_MS = 30_000;

// ── 自愈件2：真发开关一处传 ──
// 长驻 listen_chat 出站给关键人真发读的是 REAL_PUBLISH；但 agent/模块配置里用的是
// ZENITHJOY_AGENT_REAL_PUBLISH（与按需 handler handleWechatRpa 注入 REAL_PUBLISH=1 不一致）。
// 这里把两个名归一：任一为 '1' 即视作开启，spawn 时显式注入 REAL_PUBLISH，确保长驻 listener
// 与按需 handler 一样能真发（配合 #821 让 listen_chat 同时兼容两名）。
export function resolveRealPublishEnv(
  env: Record<string, string | undefined> = process.env,
): '0' | '1' {
  const on = env.ZENITHJOY_AGENT_REAL_PUBLISH === '1' || env.REAL_PUBLISH === '1';
  return on ? '1' : '0';
}

// 测试用导出：构造 listen_chat.py 的 spawn 参数（含持久 --timeout，防"5分钟死"回归）。
// agentId 传入时追加 --agent-id，listen_chat.py 用它上报心跳 → Dashboard 显示机器名而非"未知客户端"。
// machineId 传入时追加 --machine-id，listen_chat.py 按它向中台拉「自己那份」每客服配置（决策 143f5d00）。
export function buildListenerSpawnArgs(
  script: string,
  apiBase: string,
  agentId?: string,
  machineId?: string,
): string[] {
  const args = [script, '--middleware-url', apiBase, '--timeout', String(LISTENER_TIMEOUT_SEC)];
  if (agentId) args.push('--agent-id', agentId);
  if (machineId) args.push('--machine-id', machineId);
  return args;
}

// 测试注入点：允许替换 spawnSync / spawn 实现和 platform（CJS 直接调同文件函数无法被 vi.spyOn 拦截）。
// killExistingListeners 在此对象上挂载，方便测试重置。
export const _listenerKillFuncs = {
  spawnFn: spawn as (cmd: string, args: string[], opts: object) => ReturnType<typeof spawn>,
  spawnSyncFn: spawnSync as (cmd: string, args: string[]) => SpawnSyncReturns<string>,
  platform: process.platform as string,

  // 启动新监听前查杀所有已运行的 listen_chat.py，防止多实例导致 Dashboard 出现重复客户端条目。
  // 仅 Windows 有效；wmic 失败时静默跳过（不阻塞启动）。
  killExistingListeners(): void {
    if (this.platform !== 'win32') return;
    try {
      const result = this.spawnSyncFn('wmic', [
        'process',
        'where',
        'CommandLine like "%listen_chat.py%"',
        'get',
        'ProcessId',
        '/FORMAT:LIST',
      ]);
      if (result.status !== 0 || !result.stdout) return;
      for (const line of result.stdout.split(/\r?\n/)) {
        const m = line.match(/^ProcessId=(\d+)/);
        if (!m) continue;
        const pid = m[1];
        try {
          this.spawnSyncFn('taskkill', ['/F', '/PID', pid]);
          console.log(`[wechat-rpa] 已终止旧监听进程 PID ${pid}`);
        } catch {
          // 进程已退出，忽略
        }
      }
    } catch {
      // wmic 不可用，跳过清理
    }
  },
};

// 自愈件4：listen_chat child 存活态追踪（spawn 后置 true，exit/error 置 false），
// 供 index.ts 的健康自检 loop 读取，合成模块真实健康上报 core。
let _listenerAlive = false;
export function isListenerAlive(): boolean {
  return _listenerAlive;
}

// Windows only：模块激活时自动拉起 listen_chat.py 持续监听微信消息。
// 先查杀所有旧 listen_chat.py 实例（防多条心跳/Dashboard 重复客户端），再 spawn 新进程。
// 持久（timeout 86400）+ 崩溃自愈（退出后 30s 自动重启），随模块生命周期常驻。
export function startWechatListener(apiBase: string, agentId?: string, machineId?: string): void {
  if (_listenerKillFuncs.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  const script = path.join(getModuleRoot(), 'wechat-rpa', 'listen_chat.py');

  // 查杀旧监听进程，确保干净环境
  _listenerKillFuncs.killExistingListeners();

  // 自愈件2：一处定真发开关 —— 把 agent 配置的真发态归一注入 REAL_PUBLISH（长驻 listener
  // 与按需 handler 一样能真发），同时保留 ZENITHJOY_AGENT_REAL_PUBLISH（配合 #821 兼容两名）。
  const realPublish = resolveRealPublishEnv(process.env);
  const spawnEnv = {
    ...process.env,
    REAL_PUBLISH: realPublish,
    ZENITHJOY_AGENT_REAL_PUBLISH: realPublish,
  };

  const spawnOnce = (): void => {
    const child = _listenerKillFuncs.spawnFn(getPythonExe(), buildListenerSpawnArgs(script, apiBase, agentId, machineId), {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: spawnEnv,
    });
    _listenerAlive = true;
    child.stdout!.on('data', (d: Buffer) => {
      console.log('[listen_chat]', d.toString().trim());
    });
    child.stderr!.on('data', (d: Buffer) => {
      console.warn('[listen_chat stderr]', d.toString().trim());
    });
    child.on('exit', (code) => {
      _listenerAlive = false;
      console.warn(
        `[wechat-rpa] listen_chat.py 退出(code=${code})，${LISTENER_RESTART_DELAY_MS / 1000}s 后自动重启（崩溃自愈）`,
      );
      setTimeout(() => {
        _listenerKillFuncs.killExistingListeners();
        spawnOnce();
      }, LISTENER_RESTART_DELAY_MS).unref?.();
    });
    child.on('error', (err) => {
      _listenerAlive = false;
      console.warn('[wechat-rpa] listen_chat.py 启动失败:', err);
    });
  };

  spawnOnce();
  console.log(
    '[wechat-rpa] listen_chat.py 持久监听已自启（middleware-url:',
    apiBase,
    '，timeout 86400 + 崩溃自愈）',
  );
}

// ── 自愈件4：自检上报增强（line04 模块侧）──
// listen_chat.py 把扫描诊断写到本地健康文件（found_window / login_present / last_delivery_ts /
// sessions_seen）。模块读它 + 自己持有的 child 进程存活态，合成 listen_chat 真实健康，
// 通过 IPC {type:'status',...} 上报给 core → core 纳入 module_status 随心跳上报中台。

export interface ListenerHealthInput {
  // listen_chat 写的健康文件路径（默认 %PUBLIC%\zj-listener-health.json）
  healthFile?: string;
  // 模块持有的 listen_chat child 进程是否存活
  listenerAlive: boolean;
}

export interface ListenerHealth {
  ok: boolean;
  reason?: string;
  listener_alive: boolean;
  found_window?: boolean;
  last_delivery_ts?: number;
}

// 默认健康文件路径（与 listen_chat.py 约定一致，落 %PUBLIC%）。
export function defaultListenerHealthFile(): string {
  const pub = process.env.PUBLIC || (process.platform === 'win32' ? 'C:\\Users\\Public' : '/tmp');
  return path.join(pub, 'zj-listener-health.json');
}

// 合成 listen_chat 真实健康：进程不在 → ok:false；进程在但微信窗口没找到 → ok:false。
// 健康文件缺失/损坏不抛，按进程存活态给保守结论（found_window 未知则不谎报 true）。
export function collectListenerHealth(input: ListenerHealthInput): ListenerHealth {
  const { listenerAlive } = input;
  let found_window: boolean | undefined;
  let last_delivery_ts: number | undefined;

  const file = input.healthFile ?? defaultListenerHealthFile();
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        found_window?: boolean;
        last_delivery_ts?: number;
      };
      if (typeof raw.found_window === 'boolean') found_window = raw.found_window;
      if (typeof raw.last_delivery_ts === 'number') last_delivery_ts = raw.last_delivery_ts;
    }
  } catch {
    // 健康文件损坏：不抛，按保守结论
  }

  if (!listenerAlive) {
    return {
      ok: false,
      reason: 'listen_chat 进程不在（已退出，等待 supervise 重启）',
      listener_alive: false,
      found_window,
      last_delivery_ts,
    };
  }
  // 进程在但微信主窗口没找到（UIA 没激活/没登录）→ 不健康，但 listener_alive 仍 true
  if (found_window === false) {
    return {
      ok: false,
      reason: '微信主窗口未找到（未登录或 UIA 未就绪）',
      listener_alive: true,
      found_window: false,
      last_delivery_ts,
    };
  }
  return { ok: true, listener_alive: true, found_window, last_delivery_ts };
}

// 把合成健康打包成发给 core 的 IPC status 消息。
export function buildHealthStatusMessage(h: ListenerHealth): {
  type: 'status';
  ok: boolean;
  reason?: string;
  listener_alive: boolean;
  found_window?: boolean;
  last_delivery_ts?: number;
} {
  return {
    type: 'status',
    ok: h.ok,
    reason: h.reason,
    listener_alive: h.listener_alive,
    found_window: h.found_window,
    last_delivery_ts: h.last_delivery_ts,
  };
}
