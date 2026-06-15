// modules/line04/preflight.ts
//
// line04 微信AI客服模块 — 真实环境预检（自包含，不依赖 core 源码，可独立打包）。
// 三项检测，失败给客户看得懂的中文 fixGuide：
//   1. 微信版本 ≤ 4.1.8.x（Windows 注册表读取；4.1.10+ 砍掉 UIA 控件树，RPA 失效）
//   2. python -c "import pywinauto" 可成功（驱动微信自动化的底层库）
//   3. 可用内存 ≥ 4GB
//
// 非 Windows 平台：所有检测跳过并视为通过（ok:true），不崩溃。

import { execSync, spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';

// 旧版微信 COS 直链下载地址（客户降级用）。
export const WECHAT_DOWNLOAD_URL =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe';

// 受支持微信版本范围：[4.0.0, 4.1.8.x]（含两端）。
// 3.x 使用不同窗口类（WeChatMainWndForPC），无 mmui::MainWindow，RPA 不可用。
const MIN_SUPPORTED: readonly number[] = [4, 0, 0];
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

// version ∈ [4.0.0, 4.1.8.x] 返回 true（受支持）。只比较前三段，build 段忽略。
export function isWechatVersionSupported(version: string): boolean {
  const parts = parseVersionParts(version);
  // 低于 4.0.0（3.x）：无 mmui::MainWindow，RPA 不可用
  if ((parts[0] ?? 0) < MIN_SUPPORTED[0]) return false;
  for (let i = 0; i < MAX_SUPPORTED.length; i++) {
    const p = parts[i] ?? 0;
    if (p < MAX_SUPPORTED[i]) return true;
    if (p > MAX_SUPPORTED[i]) return false;
  }
  return true; // 前三段全等（4.1.8.x）→ 受支持
}

// WeChat/Weixin DWORD 有两种编码：
//   3.x（高字节 = 0x60+major）：4.1.8.107 → 0x6401086b
//   4.x（nibble-packed，byte0 ≥ 0x70）：4.1.8.107 → 0xf254186b
//     byte[1] 低 4 位 = major, byte[2] 高 4 位 = minor, byte[2] 低 4 位 = patch, byte[3] = build
// 实测：xian-rog HKCU\SOFTWARE\Tencent\Weixin Version = 0xf254186b（Weixin 4.1.8.107 安装）
function decodeWechatDword(hex: string): string {
  const num = parseInt(hex, 16) >>> 0;
  const byte0 = (num >> 24) & 0xff;
  if (byte0 >= 0x70) {
    // Weixin 4.x nibble-packed encoding
    const major = (num >> 16) & 0x0f;
    const minor = (num >> 12) & 0x0f;
    const patch = (num >> 8) & 0x0f;
    const build = num & 0xff;
    return `${major}.${minor}.${patch}.${build}`;
  }
  // WeChat 3.x offset encoding: byte0 = major + 0x60
  const major = byte0 - 0x60;
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

// 检测 1：微信版本。MOCK_WECHAT_VERSION env 可在任何平台注入版本号（跳过注册表读取）。
// 非 Windows 且无 MOCK 时跳过（视为通过）。
export function checkWechatVersion(): CheckOutcome {
  const mockVersion = process.env.MOCK_WECHAT_VERSION;
  if (mockVersion) {
    if (isWechatVersionSupported(mockVersion)) return { ok: true, found: mockVersion };
    return { ok: false, found: mockVersion, fixGuide: wechatFixGuide(mockVersion) };
  }
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true };
  }
  // 优先读取 exe 文件版本（比注册表可靠：WeChat 4.1.8 启动后会把注册表版本改写为可用更新版本，
  // 但 exe FileVersion 始终是实际安装版本，不受自动更新检测器影响）。
  const exePaths = [
    'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
    'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
  ];
  for (const exePath of exePaths) {
    try {
      const out = execSync(
        `powershell -NoProfile -NonInteractive -Command "(Get-Item '${exePath}').VersionInfo.FileVersion"`,
        { encoding: 'utf-8', windowsHide: true, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const v = out.trim();
      if (v && /^\d+\.\d+/.test(v)) {
        if (isWechatVersionSupported(v)) return { ok: true, found: v };
        return { ok: false, found: v, fixGuide: wechatFixGuide(v) };
      }
    } catch {
      // exe 不存在或 PowerShell 出错，继续尝试注册表
    }
  }
  const keys = [
    // 4.x（Weixin）— HKCU 下存版本，HKLM WOW6432Node 有时也有
    'HKCU\\SOFTWARE\\Tencent\\Weixin',
    'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\Weixin',
    'HKLM\\SOFTWARE\\Tencent\\Weixin',
    // 3.x（WeChat）
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
      // 该注册表键不存在或无权访问（runner 以 SYSTEM 运行时 HKCU 不可见），尝试下一个
    }
  }
  // 注册表全部查不到，退而检查安装目录下的版本子文件夹。
  // WeChat 3.x → C:\Program Files\Tencent\WeChat\[X.Y.Z.B]\
  // Weixin 4.x → C:\Program Files\Tencent\Weixin\X.Y.Z.B\
  const installDirs = [
    'C:\\Program Files\\Tencent\\Weixin',          // 4.x（Weixin）
    'C:\\Program Files\\Tencent\\WeChat',           // 3.x（WeChat）64-bit
    'C:\\Program Files (x86)\\Tencent\\WeChat',     // 3.x（WeChat）32-bit
  ];
  for (const dir of installDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // 目录名格式：[3.9.12.51] 或直接 3.9.12.51
        const clean = entry.name.replace(/^\[|\]$/g, '');
        if (/^\d+\.\d+\.\d+/.test(clean)) {
          if (isWechatVersionSupported(clean)) return { ok: true, found: clean };
          return { ok: false, found: clean, fixGuide: wechatFixGuide(clean) };
        }
      }
    } catch {
      // 目录无法读取，跳过
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
// MOCK_WECHAT_VERSION 设置时进入 CI mock 模式，跳过此检测（与非 Windows 行为一致）。
export function checkPywinauto(pythonPath: string): Promise<CheckOutcome> {
  if (process.platform !== 'win32' || process.env.MOCK_WECHAT_VERSION || process.env.MOCK_PYWINAUTO_OK) {
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

// 检测 3：内存 ≥ 4GB。非 Windows 跳过（视为通过）。MOCK_WECHAT_VERSION 时也跳过（CI mock 模式）。
export function checkMemory(): CheckOutcome {
  if (process.platform !== 'win32' || process.env.MOCK_WECHAT_VERSION) {
    return { ok: true, skipped: true };
  }
  if (os.totalmem() >= MIN_MEMORY_BYTES) return { ok: true };
  return { ok: false, fixGuide: memoryFixGuide() };
}

// 检测 4（软检测）：微信进程是否在跑。
// WeChat 4.1.8 启动后主进程是 WeChatAppEx.exe（WeChat.exe 是启动器，随即退出）。
// 非 Windows 跳过。ok 始终为 true——未跑只给用户提示，不阻塞模块激活。
export function checkWechatRunning(): CheckOutcome {
  if (process.platform !== 'win32') return { ok: true, skipped: true };
  // 两条命令均为字面量，无模板变量，无命令注入风险。
  const queries: Array<[string, RegExp]> = [
    ['tasklist /FI "IMAGENAME eq WeChat.exe" /FO LIST', /WeChat\.exe/i],
    ['tasklist /FI "IMAGENAME eq WeChatAppEx.exe" /FO LIST', /WeChatAppEx\.exe/i],
  ];
  for (const [cmd, pattern] of queries) {
    try {
      const out = execSync(cmd, {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (pattern.test(out)) return { ok: true };
    } catch {
      // 该进程不存在或无权查询，继续下一个
    }
  }
  return {
    ok: true,
    fixGuide: '微信未运行，请打开微信并登录，Agent 将在 30 秒内自动连接。',
  };
}

// ---------- 自动修复：下载工具 ----------

export function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        res.pipe(file);
        res.on('end', () => file.close(() => resolve()));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// 在 weixinRoot 及其一级子目录中搜索所有 WeixinUpdate.exe（不含 .disabled）。
// 4.x 安装结构：Weixin\<version>\WeixinUpdate.exe，只需两层遍历。
function findWeixinUpdateExe(weixinRoot: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(weixinRoot)) return found;
  // 检查根目录本身
  const rootExe = path.join(weixinRoot, 'WeixinUpdate.exe');
  if (fs.existsSync(rootExe)) found.push(rootExe);
  // 检查一级版本子目录（如 4.1.8.107\WeixinUpdate.exe）
  try {
    for (const entry of fs.readdirSync(weixinRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subExe = path.join(weixinRoot, entry.name, 'WeixinUpdate.exe');
      if (fs.existsSync(subExe)) found.push(subExe);
    }
  } catch {
    // 目录无法读取，跳过
  }
  return found;
}

// ---------- 自动修复：安装微信 ----------

export async function installWeChat(downloadDir: string): Promise<void> {
  const installer = path.join(downloadDir, 'WeChatWin_4.1.8.exe');
  await downloadFile(WECHAT_DOWNLOAD_URL, installer);

  // 终止所有微信相关进程（3.x: WeChat/WeChatAppEx；4.x: Weixin/WeixinUpdate）
  for (const im of ['WeChat.exe', 'WeChatAppEx.exe', 'Weixin.exe', 'WeixinUpdate.exe']) {
    spawnSync('taskkill', ['/F', '/IM', im], { windowsHide: true, stdio: 'ignore' });
  }

  // 卸载已有版本，防止 3.x（WeChat\）和 4.x（Weixin\）并存导致启动用错版本
  const uninstallers = [
    'C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe',        // 3.x 64-bit
    'C:\\Program Files (x86)\\Tencent\\WeChat\\Uninstall.exe',  // 3.x 32-bit
    'C:\\Program Files\\Tencent\\Weixin\\Uninstall.exe',        // 4.x
  ];
  for (const uninst of uninstallers) {
    if (fs.existsSync(uninst)) {
      spawnSync(uninst, ['/S'], { windowsHide: true, timeout: 60_000, stdio: 'ignore' });
    }
  }

  // 腾讯自研包静默参数是 /S（不是 NSIS 的 /VERYSILENT）
  spawnSync(installer, ['/S'], { windowsHide: true, timeout: 120_000 });

  // 安装后立即锁更新：WeixinUpdate.exe 随包部署，不锁会自动升级到 ≥4.1.9 → 反复卸装循环。
  // Python preflight.py check_lock_update() 做四层加固，这里先做 Layer1（改名）阻断首次自启。
  // WeixinUpdate.exe 位于版本子目录（如 Weixin\4.1.8.107\WeixinUpdate.exe），必须递归查找。
  spawnSync('taskkill', ['/F', '/IM', 'WeixinUpdate.exe'], { windowsHide: true, stdio: 'ignore' });
  const weixinRoot = 'C:\\Program Files\\Tencent\\Weixin';
  for (const updateExe of findWeixinUpdateExe(weixinRoot)) {
    try {
      fs.renameSync(updateExe, updateExe + '.disabled');
    } catch {
      // 非管理员权限改名失败不崩溃；Python preflight.py check_lock_update 会补做四层加固
    }
  }
}

// ---------- 自动修复：安装 pywinauto ----------

export const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
export const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/';

export async function installPywinauto(pythonPath: string, downloadDir: string): Promise<void> {
  const getPipScript = path.join(downloadDir, 'get-pip.py');
  await downloadFile(GET_PIP_URL, getPipScript);
  spawnSync(pythonPath, [getPipScript, '--quiet'], { windowsHide: true, timeout: 60_000 });
  spawnSync(
    pythonPath,
    ['-m', 'pip', 'install', 'pywinauto', '--quiet', '--index-url', PIP_INDEX_URL],
    { windowsHide: true, timeout: 120_000 },
  );
}

// ---------- 自动修复：按需调用安装函数 ----------

export interface RepairTargets {
  wechatFailed: boolean;
  pywinautoFailed: boolean;
}

// _repairFuncs 允许测试替换（CJS 直接调用同文件函数无法被 vi.spyOn 拦截）
export const _repairFuncs = {
  installWeChat,
  installPywinauto,
};

export async function autoRepair(
  targets: RepairTargets,
  pythonPath: string,
  downloadDir: string,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (targets.wechatFailed) tasks.push(_repairFuncs.installWeChat(downloadDir));
  if (targets.pywinautoFailed) tasks.push(_repairFuncs.installPywinauto(pythonPath, downloadDir));
  await Promise.all(tasks);
}

// 解析模块自带的 python-embedded/python.exe，否则回退系统 python（Windows 无 python3）。
// 回退顺序：1) 模块自带 python-embedded  2) ZENITHJOY_CORE_DIR/python-embedded  3) 系统 python
export function getModulePython(moduleDir: string): string {
  const embedded = path.join(moduleDir, 'python-embedded', 'python.exe');
  if (fs.existsSync(embedded)) return embedded;
  const coreDir = process.env.ZENITHJOY_CORE_DIR;
  if (coreDir) {
    const coreEmbedded = path.join(coreDir, 'python-embedded', 'python.exe');
    if (fs.existsSync(coreEmbedded)) return coreEmbedded;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

// 模块入口：core 在 fork 前调用，三项全过才激活。
// moduleDir 可选，不传时取本文件所在目录（CLI 直接跑时由 main guard 传入）。
// 两阶段：首轮检测 → Windows 且检测失败则 autoRepair → 修复后重检 → 软检测。
export async function runPreflight(moduleDir?: string): Promise<ModulePreflightResult> {
  const dir = moduleDir ?? __dirname;
  const python = getModulePython(dir);
  const downloadDir = path.join(os.tmpdir(), 'zenithjoy-setup');
  fs.mkdirSync(downloadDir, { recursive: true });

  // 首轮检测
  let wechat = checkWechatVersion();
  let pyw = await checkPywinauto(python);
  const mem = checkMemory();

  // 自动修复（仅 Windows，非 CI mock 模式）
  if (process.platform === 'win32' && !process.env.MOCK_WECHAT_VERSION) {
    const needRepair = !wechat.ok || !pyw.ok;
    if (needRepair) {
      await autoRepair({ wechatFailed: !wechat.ok, pywinautoFailed: !pyw.ok }, python, downloadDir);
      // 修复后重检
      wechat = checkWechatVersion();
      pyw = await checkPywinauto(python);
    }
  }

  // 软检测：微信进程是否在跑（ok 始终 true）
  const running = checkWechatRunning();

  const checks = {
    wechat_version: wechat.ok,
    pywinauto: pyw.ok,
    memory: mem.ok,
  };

  if (wechat.ok && pyw.ok && mem.ok) {
    return {
      ok: true,
      checks,
      ...(running.fixGuide ? { fixGuide: running.fixGuide } : {}),
    };
  }

  const fixGuide = [wechat, pyw, mem]
    .filter((c) => !c.ok && c.fixGuide)
    .map((c) => c.fixGuide)
    .join('\n');
  return { ok: false, checks, fixGuide };
}

// 作为脚本直接执行时（core ModuleManager 用 `node preflight.js`，cwd=moduleDir，不传 argv）：
// 把结果以 JSON 打印为 stdout 最后一行，退出码与 ok 对应。moduleDir 默认取本文件所在目录。
if (require.main === module) {
  const moduleDir = process.argv[2] || __dirname;
  runPreflight(moduleDir)
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((e: Error) => {
      console.log(JSON.stringify({ ok: false, checks: {}, fixGuide: e.message }));
      process.exit(1);
    });
}
