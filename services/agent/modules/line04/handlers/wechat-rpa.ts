// modules/line04/handlers/wechat-rpa.ts
//
// 从 services/agent/src/handlers/wechat-rpa.ts 迁移而来（sprint 06081700 模块化拆包）。
// 与原文件唯一区别：脚本/python 路径基于「模块目录」解析，而非 core.exe 同级目录。
// 模块安装后结构：<moduleDir>/{index.js, handlers/, wechat-rpa/<*.py>, python-embedded/python.exe}

import { spawn } from 'node:child_process';
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

// 测试用导出：构造 listen_chat.py 的 spawn 参数（含持久 --timeout，防"5分钟死"回归）。
// agentId 传入时追加 --agent-id，listen_chat.py 用它上报心跳 → Dashboard 显示机器名而非"未知客户端"。
export function buildListenerSpawnArgs(script: string, apiBase: string, agentId?: string): string[] {
  const args = [script, '--middleware-url', apiBase, '--timeout', String(LISTENER_TIMEOUT_SEC)];
  if (agentId) args.push('--agent-id', agentId);
  return args;
}

// Windows only：模块激活时自动拉起 listen_chat.py 持续监听微信消息。
// 持久（timeout 86400）+ 崩溃自愈（退出后 30s 自动重启），随模块生命周期常驻。
export function startWechatListener(apiBase: string, agentId?: string): void {
  if (process.platform !== 'win32') {
    console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
    return;
  }
  const script = path.join(getModuleRoot(), 'wechat-rpa', 'listen_chat.py');

  const spawnOnce = (): void => {
    const child = spawn(getPythonExe(), buildListenerSpawnArgs(script, apiBase, agentId), {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
      windowsHide: true,
    });
    child.stderr!.on('data', (d: Buffer) => {
      console.warn('[listen_chat stderr]', d.toString().trim());
    });
    child.on('exit', (code) => {
      console.warn(
        `[wechat-rpa] listen_chat.py 退出(code=${code})，${LISTENER_RESTART_DELAY_MS / 1000}s 后自动重启（崩溃自愈）`,
      );
      setTimeout(spawnOnce, LISTENER_RESTART_DELAY_MS).unref?.();
    });
    child.on('error', (err) => {
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
