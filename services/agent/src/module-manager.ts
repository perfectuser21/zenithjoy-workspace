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

export interface ModuleManagerOptions {
  // 模块安装根目录；不传则按平台推导
  modulesRoot?: string;
  // COS 模块包基地址；不传用默认
  cosBase?: string;
  agentId?: string;
  apiBase?: string;
  // ↓↓ 以下为单测注入点，生产留空走真实实现 ↓↓
  downloadImpl?: (
    lineId: string,
    version: string,
    cosUrl: string,
    destDir: string,
  ) => Promise<void>;
  preflightImpl?: (lineId: string, moduleDir: string) => Promise<ModulePreflightResult>;
  forkImpl?: (entryPath: string, opts: { cwd: string }) => ChildProcess;
  // 模块子进程发来消息时回调（core 用它转发 draft_reply 等给中台）
  onModuleMessage?: (lineId: string, msg: unknown) => void;
  // preflight 失败时回调（core 用它本地弹窗 + 心跳上报）
  onPreflightFail?: (lineId: string, result: ModulePreflightResult) => void;
  logger?: (msg: string) => void;
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
  private readonly opts: ModuleManagerOptions;

  // 已 fork 激活的模块子进程
  private readonly active = new Map<string, ChildProcess>();
  // 正在下载中的模块（去重 + 供 tray/调试观测）
  private readonly downloading = new Set<string>();
  // 最近一次各模块 preflight 结果（供心跳上报）
  private readonly statusReport = new Map<string, ModulePreflightResult>();

  constructor(opts: ModuleManagerOptions = {}) {
    this.opts = opts;
    this.modulesRoot = opts.modulesRoot ?? defaultModulesRoot();
    this.cosBase = (opts.cosBase ?? DEFAULT_COS_BASE).replace(/\/+$/, '');
    this.agentId = opts.agentId;
    this.apiBase = opts.apiBase;
  }

  private log(msg: string): void {
    (this.opts.logger ?? ((m) => console.log(`[module-manager] ${m}`)))(msg);
  }

  // 由 index.ts 在 register/连接后写入，activateModule 时随 config 消息下发
  setIdentity(agentId: string | undefined, apiBase: string | undefined): void {
    if (agentId) this.agentId = agentId;
    if (apiBase) this.apiBase = apiBase;
  }

  getModulesRoot(): string {
    return this.modulesRoot;
  }

  getModuleDir(lineId: string, version: string): string {
    return path.join(this.modulesRoot, `${lineId}-${version}`);
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
            fs.statSync(path.join(this.modulesRoot, d)).isDirectory(),
        );
      if (dirs.length === 0) return null;
      dirs.sort();
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
        if (this.needsDownload(lineId, requiredVersion)) {
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
            await this.activateModule(lineId);
          }
        } else {
          this.log(`${lineId} preflight 未通过：${pf.reason ?? pf.fixGuide ?? ''}`);
          this.opts.onPreflightFail?.(lineId, pf);
        }
      } catch (err) {
        const reason = `模块同步失败：${(err as Error).message}`;
        this.log(`${lineId} ${reason}`);
        this.statusReport.set(lineId, { ok: false, reason });
      }
    }
  }

  // 从 COS 下载 tar.gz，解压到模块目录
  async downloadModule(
    lineId: string,
    version: string,
    cosUrl: string,
  ): Promise<void> {
    const destDir = this.getModuleDir(lineId, version);
    if (this.opts.downloadImpl) {
      await this.opts.downloadImpl(lineId, version, cosUrl, destDir);
      return;
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `zj-module-${lineId}-${version}.tar.gz`,
    );
    this.log(`下载 ${lineId} v${version}：${cosUrl}`);
    await this.httpsDownload(cosUrl, tmpFile);
    fs.mkdirSync(destDir, { recursive: true });
    await this.extractTarGz(tmpFile, destDir);
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // ignore
    }
    this.log(`${lineId} v${version} 解压到 ${destDir}`);
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
  async runModulePreflight(lineId: string): Promise<ModulePreflightResult> {
    const version = this.getInstalledVersion(lineId);
    if (!version) {
      return { ok: false, reason: 'module_not_installed' };
    }
    const moduleDir = this.getModuleDir(lineId, version);

    if (this.opts.preflightImpl) {
      return this.opts.preflightImpl(lineId, moduleDir);
    }

    const preflightJs = path.join(moduleDir, 'preflight.js');
    if (!fs.existsSync(preflightJs)) {
      return { ok: false, reason: 'module_not_installed' };
    }

    return new Promise<ModulePreflightResult>((resolve) => {
      execFile(
        process.execPath,
        [preflightJs],
        { cwd: moduleDir, windowsHide: true, timeout: 60_000 },
        (err, stdout, stderr) => {
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

    const child = (this.opts.forkImpl ?? fork)(entryPath, { cwd: moduleDir });
    this.active.set(lineId, child);

    child.on('message', (msg: unknown) => {
      this.opts.onModuleMessage?.(lineId, msg);
    });
    child.on('exit', (code) => {
      this.log(`module ${lineId} 子进程退出 code=${code}`);
      this.active.delete(lineId);
    });
    child.on('error', (err: Error) => {
      this.log(`module ${lineId} 子进程错误：${err.message}`);
      this.active.delete(lineId);
    });

    try {
      child.send?.({
        type: 'config',
        agentId: this.agentId,
        apiBase: this.apiBase,
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

  // 各模块最近 preflight 结果（供心跳 module_status 上报）
  getModuleStatusReport(): Record<string, { ok: boolean; reason?: string }> {
    const out: Record<string, { ok: boolean; reason?: string }> = {};
    for (const [lineId, r] of this.statusReport.entries()) {
      out[lineId] = { ok: r.ok, reason: r.reason ?? r.fixGuide };
    }
    return out;
  }
}
