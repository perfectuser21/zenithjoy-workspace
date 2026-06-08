// modules/line04/preflight.ts
//
// line04 微信AI客服模块 — 真实环境预检（自包含，不依赖 core 源码，可独立打包）。
// 三项检测，失败给客户看得懂的中文 fixGuide：
//   1. 微信版本 ≤ 4.1.8.x（Windows 注册表读取；4.1.10+ 砍掉 UIA 控件树，RPA 失效）
//   2. python -c "import pywinauto" 可成功（驱动微信自动化的底层库）
//   3. 可用内存 ≥ 4GB
//
// 非 Windows 平台：所有检测跳过并视为通过（ok:true），不崩溃。

import { execSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 旧版微信 COS 直链下载地址（客户降级用）。
export const WECHAT_DOWNLOAD_URL =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe';

// 受支持的微信版本上限（含）：4.1.8.x。前三段 > 4.1.8 视为不支持。
const MAX_SUPPORTED: readonly number[] = [4, 1, 8];
const MIN_MEMORY_BYTES = 4 * 1024 ** 3;

export interface ModulePreflightResult {
  ok: boolean;
  checks: {
    wechat_version?: boolean;
    pywinauto?: boolean;
    memory?: boolean;
  };
  fixGuide?: string;
}

// ---------- 纯函数：版本解析与比较 ----------

// 把版本字符串拆成数字段（缺失/非法段按 0 处理）。
export function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((n) => {
      const v = parseInt(n, 10);
      return Number.isFinite(v) ? v : 0;
    });
}

// version <= 4.1.8.x 返回 true（受支持）。只比较前三段，build 段忽略。
export function isWechatVersionSupported(version: string): boolean {
  const parts = parseVersionParts(version);
  for (let i = 0; i < MAX_SUPPORTED.length; i++) {
    const p = parts[i] ?? 0;
    if (p < MAX_SUPPORTED[i]) return true;
    if (p > MAX_SUPPORTED[i]) return false;
  }
  return true; // 前三段全等（4.1.8.x）→ 受支持
}

// 微信 REG_DWORD 编码：高字节 = 0x60 + major，其余依次 minor/patch/build。
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

// ---------- 中文修复指引 ----------

export function wechatFixGuide(found: string): string {
  return `微信版本 ${found} 不支持（需 ≤4.1.8）。请从此处下载旧版：${WECHAT_DOWNLOAD_URL}`;
}

export function pywinautoFixGuide(errMessage: string): string {
  return `缺少 pywinauto 依赖（错误：${errMessage}）。请联系技术支持。`;
}

export function memoryFixGuide(): string {
  const gb = (os.totalmem() / 1024 ** 3).toFixed(1);
  return `当前内存 ${gb}GB 不足 4GB，请关闭其他程序后重试。`;
}

// ---------- 单项检测 ----------

interface CheckOutcome {
  ok: boolean;
  found?: string;
  fixGuide?: string;
  skipped?: boolean;
}

// 检测 1：微信版本。非 Windows 跳过（视为通过）。
export function checkWechatVersion(): CheckOutcome {
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
        if (isWechatVersionSupported(v)) return { ok: true, found: v };
        return { ok: false, found: v, fixGuide: wechatFixGuide(v) };
      }
    } catch {
      // 该注册表键不存在，尝试下一个
    }
  }
  return {
    ok: false,
    fixGuide:
      `未检测到受支持的微信安装（需已安装微信桌面版且版本 ≤4.1.8）。` +
      `如需安装旧版：${WECHAT_DOWNLOAD_URL}`,
  };
}

// 检测 2：pywinauto 可 import。spawn python -c "import pywinauto"，退出码 0 = 通过。
export function checkPywinauto(pythonPath: string): Promise<CheckOutcome> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: true, skipped: true });
  }
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
      return resolve({ ok: false, fixGuide: pywinautoFixGuide((e as Error).message) });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      done({ ok: false, fixGuide: pywinautoFixGuide('检测超时（Python 环境可能异常）') });
    }, 15_000);
    child.on('error', (err) => {
      done({ ok: false, fixGuide: pywinautoFixGuide(err.message) });
    });
    child.on('close', (code) => {
      if (code === 0) {
        done({ ok: true });
      } else {
        done({ ok: false, fixGuide: pywinautoFixGuide(`python -c "import pywinauto" 退出码 ${code}`) });
      }
    });
  });
}

// 检测 3：内存 ≥ 4GB。非 Windows 跳过（视为通过）。
export function checkMemory(): CheckOutcome {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true };
  }
  if (os.totalmem() >= MIN_MEMORY_BYTES) return { ok: true };
  return { ok: false, fixGuide: memoryFixGuide() };
}

// 解析模块自带的 python-embedded/python.exe，否则回退系统 python3。
export function getModulePython(moduleDir: string): string {
  const embedded = path.join(moduleDir, 'python-embedded', 'python.exe');
  return fs.existsSync(embedded) ? embedded : 'python3';
}

// 模块入口：core 在 fork 前调用，三项全过才激活。
export async function runPreflight(moduleDir: string): Promise<ModulePreflightResult> {
  const python = getModulePython(moduleDir);

  const wechat = checkWechatVersion();
  const pyw = await checkPywinauto(python);
  const mem = checkMemory();

  const checks = {
    wechat_version: wechat.ok,
    pywinauto: pyw.ok,
    memory: mem.ok,
  };
  const ok = wechat.ok && pyw.ok && mem.ok;

  if (ok) {
    return { ok: true, checks };
  }
  const fixGuide = [wechat, pyw, mem]
    .filter((c) => !c.ok && c.fixGuide)
    .map((c) => c.fixGuide)
    .join('\n');
  return { ok: false, checks, fixGuide };
}
