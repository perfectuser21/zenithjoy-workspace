// services/agent/src/preflight/line04-preflight.ts
//
// Line04 微信AI客服模块 preflight — 三项真实检测：
//   1. 微信版本 ≤ 4.1.8.x（Windows 注册表读取，4.1.10+ 砍掉 UIA 控件树，RPA 失效）
//   2. python -c "import pywinauto" 可成功（驱动微信自动化的底层库）
//   3. 可用内存 ≥ 4GB
//
// 非 Windows 平台：微信版本 + pywinauto 检测 graceful fallback（不崩溃），
// 内存检测在任何平台都工作。

import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import type { CheckOutcome, PreflightResult } from './types';

// 受支持的微信版本上限（含）：4.1.8.x。前三段 > 4.1.8 视为不支持。
const MAX_SUPPORTED: readonly number[] = [4, 1, 8];

// 把版本字符串拆成数字段（缺失段按 0 处理）
export function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((n) => {
      const v = parseInt(n, 10);
      return Number.isFinite(v) ? v : 0;
    });
}

// 纯函数：version <= 4.1.8.x 返回 true（受支持）。只比较前三段，build 段忽略。
export function isWechatVersionSupported(version: string): boolean {
  const parts = parseVersionParts(version);
  for (let i = 0; i < MAX_SUPPORTED.length; i++) {
    const p = parts[i] ?? 0;
    if (p < MAX_SUPPORTED[i]) return true;
    if (p > MAX_SUPPORTED[i]) return false;
  }
  // 前三段全部相等（4.1.8.x）→ 受支持
  return true;
}

// 微信把 Version 存成 REG_DWORD 时的编码：高字节 = 0x60 + major，其余字节依次 minor/patch/build。
// 例：4.1.8.107 → 0x6401086b。
function decodeWechatDword(hex: string): string {
  const num = parseInt(hex, 16) >>> 0;
  const major = ((num >> 24) & 0xff) - 0x60;
  const minor = (num >> 16) & 0xff;
  const patch = (num >> 8) & 0xff;
  const build = num & 0xff;
  return `${major}.${minor}.${patch}.${build}`;
}

// 解析 `reg query ... /v Version` 的 stdout，返回点分版本号；解析不出返回 null。
// 兼容 REG_SZ（字符串）与 REG_DWORD（十六进制编码）两种存法。
export function parseWechatVersionFromRegOutput(output: string): string | null {
  const m = output.match(/Version\s+REG_\w+\s+(\S+)/i);
  if (!m) return null;
  const raw = m[1];
  if (/^0x[0-9a-f]+$/i.test(raw)) {
    return decodeWechatDword(raw);
  }
  return raw;
}

// 检测 1：微信版本。非 Windows 直接跳过（视为通过）。
export async function checkWechatVersion(): Promise<CheckOutcome> {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true };
  }
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat',
    'HKLM\\SOFTWARE\\Tencent\\WeChat',
    'HKCU\\SOFTWARE\\Tencent\\WeChat',
  ];
  for (const key of keys) {
    try {
      const out = execSync(`reg query "${key}" /v Version`, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const v = parseWechatVersionFromRegOutput(out);
      if (v) {
        if (isWechatVersionSupported(v)) return { ok: true };
        return {
          ok: false,
          reason: `微信版本 ${v} 不支持自动化（请降级至 4.1.8 或更低）`,
        };
      }
    } catch {
      // 该注册表键不存在，尝试下一个
    }
  }
  return {
    ok: false,
    reason: '未检测到受支持的微信安装（请确认已安装微信桌面版且版本 ≤ 4.1.8）',
  };
}

// 检测 2：pywinauto 可 import。spawn python -c "import pywinauto"，退出码 0 = 通过。
export async function checkPywinauto(pythonPath: string): Promise<CheckOutcome> {
  return new Promise<CheckOutcome>((resolve) => {
    let settled = false;
    const done = (r: CheckOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child;
    try {
      child = spawn(pythonPath, ['-c', 'import pywinauto; print("ok")'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (e) {
      return resolve({ ok: false, reason: `Python 环境异常：${(e as Error).message}` });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      done({ ok: false, reason: 'pywinauto 检测超时（Python 环境可能异常）' });
    }, 15_000);
    child.on('error', (err) => {
      done({ ok: false, reason: `Python 环境异常，无法运行 pywinauto 检测：${err.message}` });
    });
    child.on('close', (code) => {
      if (code === 0) {
        done({ ok: true });
      } else {
        done({
          ok: false,
          reason: 'pywinauto 模块不可用，无法驱动微信自动化（请运行 pip install pywinauto）',
        });
      }
    });
  });
}

// 检测 3：内存 ≥ 4GB。任何平台都工作。
export function checkMemory(): CheckOutcome {
  const total = os.totalmem();
  const min = 4 * 1024 * 1024 * 1024;
  if (total >= min) return { ok: true };
  const gb = (total / 1024 / 1024 / 1024).toFixed(1);
  return { ok: false, reason: `可用内存不足：当前 ${gb}GB，微信自动化需 ≥ 4GB` };
}

export async function runLine04Preflight(pythonPath: string): Promise<PreflightResult> {
  const wechat = await checkWechatVersion();
  const pyw = await checkPywinauto(pythonPath);
  const mem = checkMemory();

  const checks = {
    wechat_version: wechat.ok,
    pywinauto: pyw.ok,
    memory: mem.ok,
  };
  const ok = wechat.ok && pyw.ok && mem.ok;
  const reason = ok
    ? undefined
    : [wechat, pyw, mem]
        .filter((c) => !c.ok && c.reason)
        .map((c) => c.reason)
        .join('；');
  return { ok, reason, checks };
}
