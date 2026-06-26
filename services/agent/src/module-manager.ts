// services/agent/src/module-manager.ts
//
// ModuleManager — Core 的按需模块调度中枢（Sprint 06081700）
//
// 职责：
//   1. syncModules：心跳收到 modules 响应后，对比本地已安装版本，按需下载
//   2. downloadModule：从 COS 下载 tar.gz，解压到模块目录
//   3. runModulePreflight：运行模块目录下的 preflight.js，拿到环境预检结果
//   4. activateModule：fork 模块 index.js，建立 IPC，发 {type:'config', agentId, apiBase}
//   5. forwardMessage：把 WebSocket / heartbeat 消息转发给已激活的模块子进程
//   6. getActiveModules：返回已激活模块列表（供 tray 用）
//
// 设计取舍：
//   - Core 不再硬编码任何 Line 逻辑；Line 特有逻辑全部下沉到模块包
//   - 下载/解压/preflight/fork 全部 try/catch，任何失败只记录日志，绝不让 core 崩溃
//   - 非 Windows 环境 graceful fallback（路径切到 ~/.zenithjoy/modules，spawn 失败不崩）
//   - download/fork/preflight 通过 options 注入，便于单测（不打真实网络/不真 spawn）

import {
  fork,
  execFile,
  type ChildProcess,
  type Serializable,
} from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 模块安装路径下的 manifest.json
export interface ModuleManifest {
  lineId: string;
  version: string;
  entry: string; // 例 "index.js"
  platform?: string[]; // 例 ["win32"]
  minMemoryGB?: number;
}

// 心跳 modules 字段里单个模块的描述（可能是裸字符串或对象）
export interface ModuleDescriptorIn {
  status: string; // active / locked / not_purchased
  required_version?: string;
}

// 模块 preflight.js 的输出（与 PrepPRD line04 Preflight 协议对齐）
export interface ModulePreflightResult {
  ok: boolean;
  reason?: string;
  fixGuide?: string;
}

// 模块通过 IPC {type:'status'} 上报的真实健康（listen_chat 进程在不在 / 微信窗口找到没 /
// 最近一次成功送达时间戳）。core 把它纳入 module_status，随心跳上报中台。
export interface ModuleHealth {
  ok: boolean;
  reason?: string;
  // line04 专有：listen_chat 子进程存活态
  listener_alive?: boolean;
  // line04 专有：微信主窗口是否被 UIA 找到
  found_window?: boolean;
  // line04 专有：最近一次出站/回复成功送达的时间戳（ms）
  last_delivery_ts?: number;
}

export interface ModuleManagerOptions {
  // 模块安装根目录；不传则按平台推导
  modulesRoot?: string;
  // COS 模块包基地址；不传用默认
  cosBase?: string;
  agentId?: string;
  apiBase?: string;
  machineId?: string;
  // ↓↓ 以下为单测注入点，生产留空走真实实现 ↓↓
  downloadImpl?: (
    lineId: string,
    version: string,
    cosUrl: string,
    destDir: string,
  ) => Promise<void>;
  preflightImpl?: (lineId: string, moduleDir: string) => Promise<ModulePreflightResult>;
  execFileImpl?: (cmd: string, args: string[], opts: { cwd: string; windowsHide: boolean; timeout: number; env: Record<string, string | undefined> }, cb: (err: Error | null, stdout: string, stderr: string) => void) => void;
  forkImpl?: (entryPath: string, opts: { cwd: string }) => ChildProcess;
  // 模块子进程发来消息时回调（core 用它转发 draft_reply 等给中台）
  onModuleMessage?: (lineId: string, msg: unknown) => void;
  // preflight 失败时回调（core 用它本地弹窗 + 心跳上报）
  onPreflightFail?: (lineId: string, result: ModulePreflightResult) => void;
  // 自愈件1：受监管模块崩溃次数超上限时回调（core 用它本地告警 + 心跳上报，让管理员看到"修不动了"）
  onModuleAlert?: (lineId: string, reason: string) => void;
  logger?: (msg: string) => void;

  // ── 自愈件1：长驻模块进程保活（supervise）配置 ──
  // 需要保活的 lineId 列表（如 line04-wechat-cs：宿主 listen_chat 长驻监听微信）。
  // 受监管模块子进程退出/崩溃 → 自动重启（指数退避 + 上限），不靠外部 watchdog / 计划任务。
  superviseLines?: string[];
  // 重启退避基数（首次重启延迟），默认 5s
  restartBaseDelayMs?: number;
  // 重启退避上限（指数增长封顶），默认 5min
  restartMaxDelayMs?: number;
  // 连续崩溃重启次数上限，超过则停止重启并 onModuleAlert，默认 8 次
  restartMaxRetries?: number;
  // 测试注入点：替换 setTimeout（生产留空走真实 setTimeout）
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

const DEFAULT_COS_BASE =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules';

// 模块安装路径：
//   Windows： %APPDATA%\zenithjoy\modules\
//   其他：    ~/.zenithjoy/modules/
export function defaultModulesRoot(): string {
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'zenithjoy', 'modules');
  }
  return path.join(os.homedir(), '.zenithjoy', 'modules');
}

export class ModuleManager {
  private readonly modulesRoot: string;
  private readonly cosBase: string;
  private agentId?: string;
  private apiBase?: string;
  private machineId?: string;
  private readonly opts: ModuleManagerOptions;

  // 已 fork 激活的模块子进程
  private readonly active = new Map<string, ChildProcess>();
  // 各模块「实际已激活的版本」（activateModule 时写、子进程退出时删）。
  // 自检守卫用它核对 activated == required，发现自升级没真正完成（卡旧版）。
  private readonly activeVersion = new Map<string, string>();
  // 正在下载中的模块（去重 + 供 tray/调试观测）
  private readonly downloading = new Set<string>();
  // 最近一次各模块 preflight 结果（供心跳上报）
  private readonly statusReport = new Map<string, ModulePreflightResult>();
  // 正在运行 preflight 的模块（并发保护：WeChat 安装耗时 2-5 分钟，心跳 30s 间隔会并发触发）
  private readonly preflightRunning = new Set<string>();

  // ── 自愈件1：supervise 状态 ──
  // 受监管的 lineId 集合
  private readonly superviseLines: Set<string>;
  // 各模块连续崩溃重启计数（成功稳定运行会被 syncModules 重新激活时清零）
  private readonly restartCount = new Map<string, number>();
  // 升级时主动 kill 的模块（其 exit 是 intentional，不触发自愈重启）
  private readonly intentionalKill = new Set<string>();
  private readonly restartBaseDelayMs: number;
  private readonly restartMaxDelayMs: number;
  private readonly restartMaxRetries: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  // ── 自愈件4：模块 IPC 上报的真实健康（覆盖 preflight 结果，给管理员看模块"实际健康"）──
  private readonly healthReport = new Map<string, ModuleHealth>();

  constructor(opts: ModuleManagerOptions = {}) {
    this.opts = opts;
    this.modulesRoot = opts.modulesRoot ?? defaultModulesRoot();
    this.cosBase = (opts.cosBase ?? DEFAULT_COS_BASE).replace(/\/+$/, '');
    this.agentId = opts.agentId;
    this.apiBase = opts.apiBase;
    this.machineId = opts.machineId;
    this.superviseLines = new Set(opts.superviseLines ?? []);
    this.restartBaseDelayMs = opts.restartBaseDelayMs ?? 5_000;
    this.restartMaxDelayMs = opts.restartMaxDelayMs ?? 300_000;
    this.restartMaxRetries = opts.restartMaxRetries ?? 8;
    this.setTimeoutFn = opts.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
  }

  private log(msg: string): void {
    (this.opts.logger ?? ((m) => console.log(`[module-manager] ${m}`)))(msg);
  }

  // 由 index.ts 在 register/连接后写入，activateModule 时随 config 消息下发
  setIdentity(
    agentId: string | undefined,
    apiBase: string | undefined,
    machineId?: string | undefined,
  ): void {
    if (agentId) this.agentId = agentId;
    if (apiBase) this.apiBase = apiBase;
    if (machineId) this.machineId = machineId;
  }

  getModulesRoot(): string {
    return this.modulesRoot;
  }

  getModuleDir(lineId: string, version: string): string {
    return path.join(this.modulesRoot, `${lineId}-${version}`);
  }

  // 一个模块版本目录是否「完整可用」= 含 manifest.json。
  // 核心防线（修卡 1.0.62 真因）：下载/解压失败（COS 跨境抖动常见）会留下空/残缺目录；
  // 若把这种残缺目录当「已安装」，getInstalledVersion 返回它 → needsDownload 永久 false 不再重试
  // + preflight 永久 fail 永不激活 → 卡旧版。只认含 manifest 的完整目录，残缺目录视为未安装（自愈重下）。
  // 注：不强求 entry 文件存在（manifest 坏时 activateModule 会回退 index.js，保留既有容错语义）。
  private isModuleDirComplete(moduleDir: string): boolean {
    try {
      return fs.existsSync(path.join(moduleDir, 'manifest.json'));
    } catch {
      return false;
    }
  }

  // 扫描模块根目录，返回该 lineId 已安装的版本（取目录名排序最大者），无则 null
  getInstalledVersion(lineId: string): string | null {
    try {
      if (!fs.existsSync(this.modulesRoot)) return null;
      const prefix = `${lineId}-`;
      const dirs = fs
        .readdirSync(this.modulesRoot)
        .filter(
          (d) =>
            d.startsWith(prefix) &&
            fs.statSync(path.join(this.modulesRoot, d)).isDirectory() &&
            // 残缺目录（无 manifest）不算已安装 → 不毒化升级判定
            this.isModuleDirComplete(path.join(this.modulesRoot, d)),
        );
      if (dirs.length === 0) return null;
      dirs.sort((a, b) => {
        const pa = a.slice(prefix.length).split('.').map(Number);
        const pb = b.slice(prefix.length).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
      return dirs[dirs.length - 1].slice(prefix.length);
    } catch (err) {
      this.log(`getInstalledVersion(${lineId}) 失败：${(err as Error).message}`);
      return null;
    }
  }

  // 本地已安装版本 ≠ 要求版本（含未安装）→ 需要下载
  needsDownload(lineId: string, requiredVersion: string): boolean {
    return this.getInstalledVersion(lineId) !== requiredVersion;
  }

  getDownloading(): string[] {
    return [...this.downloading];
  }

  buildCosUrl(lineId: string, version: string): string {
    return `${this.cosBase}/${lineId}-v${version}.tar.gz`;
  }

  // 读取模块目录下 manifest.json
  private readManifest(moduleDir: string): ModuleManifest | null {
    try {
      const p = path.join(moduleDir, 'manifest.json');
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as ModuleManifest;
    } catch (err) {
      this.log(`readManifest 失败：${(err as Error).message}`);
      return null;
    }
  }

  // 心跳收到 modules 响应后调用：对比本地已安装版本，按需下载 → preflight → 激活
  async syncModules(
    modules: Record<string, string | ModuleDescriptorIn>,
  ): Promise<void> {
    for (const [lineId, desc] of Object.entries(modules)) {
      const status = typeof desc === 'string' ? desc : desc?.status;
      const requiredVersion =
        typeof desc === 'string' ? undefined : desc?.required_version;

      // 仅管理已购买/激活的模块；locked / not_purchased 跳过
      if (status !== 'active') continue;
      if (!requiredVersion) {
        this.log(`${lineId} status=active 但缺 required_version，跳过`);
        continue;
      }

      try {
        const needsUpgrade = this.needsDownload(lineId, requiredVersion);
        if (needsUpgrade) {
          // 有新版本：先 kill 旧模块 fork，再下载，再激活新版
          // 不 kill 则旧 fork 里的 index.js 会在 listen_chat 崩溃时自愈重启旧版本，
          // 导致 syncModules 激活分支永远走不到（active.has = true）
          const oldChild = this.active.get(lineId);
          if (oldChild) {
            this.log(`${lineId} 检测到新版本 ${requiredVersion}，终止旧模块进程`);
            // 标记为主动 kill：其 exit 不应被 supervise 当成崩溃触发自愈重启
            this.intentionalKill.add(lineId);
            oldChild.kill();
            this.active.delete(lineId);
          }
          this.downloading.add(lineId);
          try {
            await this.downloadModule(
              lineId,
              requiredVersion,
              this.buildCosUrl(lineId, requiredVersion),
            );
          } finally {
            this.downloading.delete(lineId);
          }
        }

        const pf = await this.runModulePreflight(lineId);
        this.statusReport.set(lineId, pf);

        if (pf.ok) {
          if (!this.active.has(lineId)) {
            // 经心跳重新激活成功 → 清崩溃计数（让 supervise 重新获得完整退避预算）
            this.restartCount.delete(lineId);
            await this.activateModule(lineId);
          }
        } else {
          this.log(`${lineId} preflight 未通过：${pf.reason ?? pf.fixGuide ?? ''}`);
          this.opts.onPreflightFail?.(lineId, pf);
        }

        // 自检守卫：核对「实际激活的版本 == 要求版本」。不一致 = 自升级没真正完成（卡旧版），
        // 红日志 + 记入 module_status 随心跳上报中台，让管理员看得见。
        // 这是真机环境接缝（CI 测不到客户机自升级）；proven-to-fire：放残缺目录会看它报红。
        const activatedVersion = this.activeVersion.get(lineId);
        if (activatedVersion && activatedVersion !== requiredVersion) {
          const reason = `自升级未完成：实际激活 ${activatedVersion} ≠ 要求 ${requiredVersion}`;
          this.log(`[self-check] ${lineId} ${reason}`);
          const prev = this.statusReport.get(lineId);
          this.statusReport.set(lineId, {
            ok: false,
            reason,
            fixGuide: prev?.fixGuide,
          });
        }
      } catch (err) {
        const reason = `模块同步失败：${(err as Error).message}`;
        this.log(`${lineId} ${reason}`);
        this.statusReport.set(lineId, { ok: false, reason });
      }
    }
  }

  // 从 COS 下载 tar.gz，原子安装到模块目录。
  // 成熟模式（对齐 CoreUpgrader 已验证做法）：下载/解压到 staging 临时目录 → 校验完整（含 manifest）
  //   → 原子 rename 落位（先删正式目录里可能存在的残缺/旧版本）→ 任何失败回滚删 staging。
  // 绝不在正式目录留半成品：半成品会被 getInstalledVersion 误当「已装最新」→ 永不重试 → 卡旧版（修卡 1.0.62 真因）。
  async downloadModule(
    lineId: string,
    version: string,
    cosUrl: string,
  ): Promise<void> {
    const destDir = this.getModuleDir(lineId, version);
    // staging 与正式目录同在 modulesRoot 下（同文件系统 → rename 原子）。
    // 名字用 `.staging-` 前缀，确保不被 getInstalledVersion 的 `${lineId}-` 前缀匹配（否则会被当成一个版本）。
    const stagingDir = path.join(
      this.modulesRoot,
      `.staging-${lineId}-${version}-${process.pid}`,
    );
    // 清掉可能残留的旧 staging
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    try {
      if (this.opts.downloadImpl) {
        // 注入路径（单测）：让实现写到 staging，再统一校验 + 原子落位
        await this.opts.downloadImpl(lineId, version, cosUrl, stagingDir);
      } else {
        const tmpFile = path.join(
          os.tmpdir(),
          `zj-module-${lineId}-${version}.tar.gz`,
        );
        this.log(`下载 ${lineId} v${version}：${cosUrl}`);
        await this.httpsDownload(cosUrl, tmpFile);
        fs.mkdirSync(stagingDir, { recursive: true });
        await this.extractTarGz(tmpFile, stagingDir);
        try {
          fs.rmSync(tmpFile, { force: true });
        } catch {
          // ignore
        }
      }

      // 校验：staging 必须是完整模块目录（含 manifest），否则视为下载失败 → 回滚
      if (!this.isModuleDirComplete(stagingDir)) {
        throw new Error(`下载产物不完整（缺 manifest）：${stagingDir}`);
      }

      // 原子落位：先删正式目录里可能存在的残缺/旧版本，再 rename（同 FS 原子）
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      fs.renameSync(stagingDir, destDir);
      this.log(`${lineId} v${version} 原子安装到 ${destDir}`);
    } catch (err) {
      // 回滚：删 staging，绝不在正式目录留半成品毒化升级判定
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      throw err;
    }
  }

  // Node https 下载到文件（跟随 301/302 重定向）
  private httpsDownload(url: string, destFile: string, redirects = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirects > 5) {
        reject(new Error('too many redirects'));
        return;
      }
      const client = url.startsWith('http://') ? http : https;
      const req = client.get(url, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          this.httpsDownload(res.headers.location, destFile, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`download http ${code}`));
          return;
        }
        const file = fs.createWriteStream(destFile);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', (err) => reject(err));
      });
      req.on('error', (err) => reject(err));
    });
  }

  // 用系统 tar 解压（Windows 10+ / macOS / Linux 自带 tar）
  private extractTarGz(tarFile: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'tar',
        ['xzf', tarFile, '-C', destDir],
        { windowsHide: true },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  // 运行模块目录下的 preflight.js，返回结果
  // 并发保护：同一 lineId 同时只允许一个 preflight 进程运行（WeChat 安装耗时 2-5 分钟）
  async runModulePreflight(lineId: string): Promise<ModulePreflightResult> {
    if (this.preflightRunning.has(lineId)) {
      this.log(`${lineId} preflight 已在运行中，跳过本次（并发保护）`);
      return { ok: false, reason: 'preflight_already_running' };
    }

    const version = this.getInstalledVersion(lineId);
    if (!version) {
      return { ok: false, reason: 'module_not_installed' };
    }
    const moduleDir = this.getModuleDir(lineId, version);

    if (this.opts.preflightImpl) {
      this.preflightRunning.add(lineId);
      try {
        return await this.opts.preflightImpl(lineId, moduleDir);
      } finally {
        this.preflightRunning.delete(lineId);
      }
    }

    const preflightJs = path.join(moduleDir, 'preflight.js');
    if (!fs.existsSync(preflightJs)) {
      return { ok: false, reason: 'module_not_installed' };
    }

    this.preflightRunning.add(lineId);
    const execFn = this.opts.execFileImpl ?? execFile;
    return new Promise<ModulePreflightResult>((resolve) => {
      execFn(
        process.execPath,
        [preflightJs],
        // 660s：WeChat 安装最长 ~5 分钟 + 其他检查 + 缓冲
        // 旧值 60s 会在用户点击 UAC 确认框后、安装完成前把 preflight 进程杀掉
        { cwd: moduleDir, windowsHide: true, timeout: 660_000, env: { ...process.env, ZENITHJOY_CORE_DIR: path.dirname(process.execPath) } },
        (err, stdout, stderr) => {
          this.preflightRunning.delete(lineId);
          if (stderr) this.log(`${lineId} preflight stderr: ${stderr}`);
          try {
            const lines = (stdout || '').trim().split('\n').filter(Boolean);
            const last = lines[lines.length - 1] || '{}';
            const parsed = JSON.parse(last) as ModulePreflightResult;
            resolve({
              ok: !!parsed.ok,
              reason: parsed.reason,
              fixGuide: parsed.fixGuide,
            });
          } catch (parseErr) {
            resolve({
              ok: false,
              reason: `preflight 输出解析失败：${
                (parseErr as Error).message
              }${err ? `（退出码异常：${err.message}）` : ''}`,
            });
          }
        },
      );
    });
  }

  // fork 模块 index.js，建立 IPC，发 {type:'config', agentId, apiBase}
  async activateModule(lineId: string): Promise<ChildProcess> {
    const version = this.getInstalledVersion(lineId);
    if (!version) throw new Error(`module ${lineId} 未安装，无法激活`);
    const moduleDir = this.getModuleDir(lineId, version);
    const manifest = this.readManifest(moduleDir);
    const entry = manifest?.entry || 'index.js';
    const entryPath = path.join(moduleDir, entry);
    if (!this.opts.forkImpl && !fs.existsSync(entryPath)) {
      throw new Error(`module ${lineId} 入口不存在：${entryPath}`);
    }

    const coreDir = path.dirname(process.execPath);
    const child = (this.opts.forkImpl ?? fork)(entryPath, {
      cwd: moduleDir,
      env: { ...process.env, ZENITHJOY_CORE_DIR: coreDir },
    });
    this.active.set(lineId, child);
    // 记录实际激活的版本（自检守卫核对 activated == required）
    this.activeVersion.set(lineId, version);

    child.on('message', (msg: unknown) => {
      // 自愈件4：模块上报的 {type:'status'|'health',...} 纳入健康报告（覆盖 preflight 结果），
      // 让管理员/诊断页看到 listen_chat 真实健康；其余消息（draft_reply 等）原样透传给 core。
      if (this.captureModuleHealth(lineId, msg)) return;
      this.opts.onModuleMessage?.(lineId, msg);
    });
    child.on('exit', (code) => {
      this.log(`module ${lineId} 子进程退出 code=${code}`);
      this.active.delete(lineId);
      this.activeVersion.delete(lineId);
      this.handleModuleExit(lineId);
    });
    child.on('error', (err: Error) => {
      this.log(`module ${lineId} 子进程错误：${err.message}`);
      this.active.delete(lineId);
      this.activeVersion.delete(lineId);
      this.handleModuleExit(lineId);
    });

    try {
      child.send?.({
        type: 'config',
        agentId: this.agentId,
        apiBase: this.apiBase,
        machineId: this.machineId,
      });
    } catch (err) {
      this.log(`module ${lineId} 发送 config 失败：${(err as Error).message}`);
    }

    this.log(`module ${lineId} v${version} 已激活`);
    return child;
  }

  // 转发消息给已激活的模块子进程；未激活则记录日志（不抛）
  forwardMessage(lineId: string, msg: unknown): void {
    const child = this.active.get(lineId);
    if (!child) {
      this.log(`forwardMessage：模块 ${lineId} 未激活，丢弃消息`);
      return;
    }
    try {
      child.send?.(msg as Serializable);
    } catch (err) {
      this.log(`forwardMessage ${lineId} 失败：${(err as Error).message}`);
    }
  }

  // 返回已激活模块列表（供 tray 用）
  getActiveModules(): string[] {
    return [...this.active.keys()];
  }

  // ── 自愈件4：捕获模块 IPC 上报的真实健康 ──
  // 返回 true 表示这是健康消息（已消费，不再透传 onModuleMessage）。
  private captureModuleHealth(lineId: string, msg: unknown): boolean {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as { type?: string } & ModuleHealth;
    if (m.type !== 'status' && m.type !== 'health') return false;
    const health: ModuleHealth = {
      ok: !!m.ok,
      reason: m.reason,
      listener_alive: m.listener_alive,
      found_window: m.found_window,
      last_delivery_ts: m.last_delivery_ts,
    };
    this.healthReport.set(lineId, health);
    this.log(
      `module ${lineId} 健康上报：ok=${health.ok} listener_alive=${health.listener_alive} found_window=${health.found_window}`,
    );
    return true;
  }

  // ── 自愈件1：受监管模块退出 → 自动重启（指数退避 + 上限告警）──
  private handleModuleExit(lineId: string): void {
    // 升级时主动 kill 的退出：消费标记，不触发自愈
    if (this.intentionalKill.has(lineId)) {
      this.intentionalKill.delete(lineId);
      return;
    }
    if (!this.superviseLines.has(lineId)) return;

    const attempts = (this.restartCount.get(lineId) ?? 0) + 1;
    this.restartCount.set(lineId, attempts);

    if (attempts > this.restartMaxRetries) {
      const reason = `module ${lineId} 连续崩溃 ${attempts - 1} 次仍未恢复，已停止自动重启（超过上限 ${this.restartMaxRetries}），需人工介入`;
      this.log(reason);
      // 标记健康为不健康 + 写 module_status，让管理员/诊断页看到"修不动了"
      this.healthReport.set(lineId, { ok: false, reason, listener_alive: false });
      this.statusReport.set(lineId, { ok: false, reason });
      this.opts.onModuleAlert?.(lineId, reason);
      return;
    }

    // 指数退避：base * 2^(attempts-1)，封顶 restartMaxDelayMs
    const delay = Math.min(
      this.restartBaseDelayMs * Math.pow(2, attempts - 1),
      this.restartMaxDelayMs,
    );
    this.log(`module ${lineId} 退出，第 ${attempts} 次自动重启将在 ${delay}ms 后执行（指数退避）`);
    const t = this.setTimeoutFn(() => {
      // 已被别的路径重新激活则跳过
      if (this.active.has(lineId)) return;
      void this.activateModule(lineId).catch((err) => {
        this.log(`module ${lineId} 自动重启失败：${(err as Error).message}`);
        // 重启 fork 本身失败也算一次崩溃，递归交给 exit/error handler 或下次心跳兜底
        this.handleModuleExit(lineId);
      });
    }, delay);
    (t as unknown as { unref?: () => void }).unref?.();
  }

  // 各模块健康状态（供心跳 module_status 上报）。
  // 优先用模块 IPC 上报的真实健康（listen_chat 进程/窗口/送达），无则回退 preflight 结果。
  getModuleStatusReport(): Record<
    string,
    { ok: boolean; reason?: string; listener_alive?: boolean; found_window?: boolean; last_delivery_ts?: number }
  > {
    const out: Record<
      string,
      { ok: boolean; reason?: string; listener_alive?: boolean; found_window?: boolean; last_delivery_ts?: number }
    > = {};
    for (const [lineId, r] of this.statusReport.entries()) {
      out[lineId] = { ok: r.ok, reason: r.reason ?? r.fixGuide };
    }
    // 模块 IPC 上报的真实健康覆盖 preflight 结果（更新鲜、更贴近"实际运行健康"）
    for (const [lineId, h] of this.healthReport.entries()) {
      out[lineId] = {
        ok: h.ok,
        reason: h.reason ?? out[lineId]?.reason,
        listener_alive: h.listener_alive,
        found_window: h.found_window,
        last_delivery_ts: h.last_delivery_ts,
      };
    }
    return out;
  }
}
