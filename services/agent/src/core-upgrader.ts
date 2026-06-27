// services/agent/src/core-upgrader.ts
//
// CoreUpgrader — Agent 核心运行时本体的自升级中枢（Sprint 06222100）
//
// 根治的根：模块（line04 等）会自动升级（中台心跳发 module required_version → agent 下载激活），
// 但核心 node 运行时本体（package.json version）一直没有自升级机制——核心改了客户机仍跑旧核心，
// 只能人手动重装（真机上很 flaky）。本类照 module-manager 的成熟模式给核心做同样的事：
//   心跳收到 required_agent_version > 自身版本 → 从 COS 下载 zenithjoy-agent-v<ver>.tar.gz
//   → sha/size 校验 → 解压到 extracted/zenithjoy-agent-v<ver> → 拷过 .env/license/已下模块
//   → 写 .active-core 指针（启动器据它选最新核心）→ 优雅退出（计划任务/启动器拉起新核心）。
//
// 设计取舍（与 module-manager 一致）：
//   - download/extract/sha/exit 全部 try/catch，任何失败回滚到旧核心，绝不把客户机搞挂
//   - 校验失败/下载抛错 → 不写指针、不退出（旧核心继续跑，下次心跳再试）
//   - download/verify/exit 通过 options 注入，便于单测（不打真实网络/不真退出）
//   - 自换+重启接缝：本类只写 .active-core 指针 + 退出；真"拉起新核心"是 start.bat（读指针）
//     + 计划任务 ONLOGON 始终拉启动器 → 这部分是接缝，列入接缝清单真机验。

import { execFile, type ChildProcess } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { reportEvent, type EventReporterConfig, type AgentEvent } from './shared/event-reporter';

const DEFAULT_COS_BASE =
  'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack';

// 核心包名前缀：extracted/zenithjoy-agent-v<ver>
const CORE_DIR_PREFIX = 'zenithjoy-agent-v';
// 启动器读取的活动核心指针文件名（写在 extracted 的父目录，即客户机产品根）
export const ACTIVE_CORE_POINTER = '.active-core';

// 校验信息（中台随 required_agent_version 一并下发，防中途篡改/截断）
export interface CoreVerifyInfo {
  sha256?: string;
  size?: number;
}

export interface CoreUpgraderOptions {
  // 当前运行核心版本（= package.json version）
  currentVersion: string;
  // 当前运行核心目录（…/extracted/zenithjoy-agent-v<current>）；不传按 process.execPath 推
  coreDir?: string;
  // 身份统一（cp-06270030）：%APPDATA%/zenithjoy-agent 目录（含 config.json，存 apiUrl/agentUuid）。
  // 不传按 APPDATA / 平台默认推。升级时把 config.json 带到新核心目录，新核心据此拿 apiBase，不回落生产。
  configDir?: string;
  // COS 核心包基地址；不传用默认
  cosBase?: string;
  logger?: (msg: string) => void;
  // ↓↓ 单测注入点，生产留空走真实实现 ↓↓
  // 下载 + 解压到 destDir（真实实现：https 下载 tar.gz 到 tmp → 校验 → tar 解压）
  downloadImpl?: (version: string, cosUrl: string, destDir: string) => Promise<void>;
  // sha/size 校验（真实实现：verifyFile 对下载文件算 sha256 + 比 size）
  verifyImpl?: (filePath: string, info: CoreVerifyInfo) => Promise<boolean>;
  // 优雅退出（真实实现：process.exit(0)，由启动器拉起新核心）
  exitImpl?: () => void;
  // 观测上报配置（apiBase+license+agentId）；不传则不上报（旁路，绝不影响升级主流程）。
  reporter?: EventReporterConfig;
  // 上报实现注入点（单测断言上报调用；不传走真实 reportEvent）。
  reportImpl?: (cfg: EventReporterConfig, event: AgentEvent) => Promise<void>;
}

export interface UpgradeResult {
  upgraded: boolean;
  version?: string;
  reason?: string;
}

// 纯数字段比较：a > b → 正，a == b → 0，a < b → 负。段数不齐按 0 补齐。
// 只接受 X.Y.Z 风格（全数字），任何非法段都让本函数被上层 needsUpgrade 拦在外面。
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10));
  const pb = b.split('.').map((s) => parseInt(s, 10));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// 合法 semver（X.Y[.Z…] 全数字段）才算可比较版本，否则不触发升级（防 'latest' 之类误触发）。
function isValidVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d+(\.\d+)*$/.test(v);
}

export class CoreUpgrader {
  private readonly currentVersion: string;
  private readonly coreDir: string;
  // extracted 目录（核心目录的父）
  private readonly extractedDir: string;
  // 客户机产品根（extracted 的父，.active-core 指针写这里）
  private readonly rootDir: string;
  private readonly cosBase: string;
  // %APPDATA%/zenithjoy-agent 目录（config.json 所在）；carry-over 时从这里把 config.json 带到新核心
  private readonly configDir: string;
  private readonly opts: CoreUpgraderOptions;
  // 升级中标记：同一进程内只升一次（升级中再来心跳不重复下载）
  private upgrading = false;

  constructor(opts: CoreUpgraderOptions) {
    this.opts = opts;
    this.currentVersion = opts.currentVersion;
    // coreDir 不传时按当前可执行文件目录推（pkg 打包后 process.execPath = …/zenithjoy-agent.exe）
    this.coreDir = opts.coreDir ?? path.dirname(process.execPath);
    this.extractedDir = path.dirname(this.coreDir);
    this.rootDir = path.dirname(this.extractedDir);
    this.cosBase = (opts.cosBase ?? DEFAULT_COS_BASE).replace(/\/+$/, '');
    this.configDir = opts.configDir ?? CoreUpgrader.defaultConfigDir();
  }

  // %APPDATA%/zenithjoy-agent（与 config-loader.getConfigDir 同口径），供 carry-over config.json
  private static defaultConfigDir(): string {
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, 'zenithjoy-agent');
    }
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Roaming', 'zenithjoy-agent');
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'zenithjoy-agent');
    }
    return path.join(os.homedir(), '.config', 'zenithjoy-agent');
  }

  private log(msg: string): void {
    (this.opts.logger ?? ((m) => console.log(`[core-upgrader] ${m}`)))(msg);
  }

  // 观测旁路：上报升级进度 / 错误到中台。无 reporter 配置则跳过；上报本身失败静默吞（绝不崩升级）。
  private async report(event: AgentEvent): Promise<void> {
    if (!this.opts.reporter) return;
    const impl = this.opts.reportImpl ?? reportEvent;
    try {
      await impl(this.opts.reporter, event);
    } catch {
      // 上报失败绝不影响升级主流程
    }
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  // 运行时注入观测上报配置（index.ts 起 heartbeat-loop 时拿到 apiBase/license/agentId 后回填）。
  setReporter(reporter: EventReporterConfig): void {
    this.opts.reporter = reporter;
  }

  // required > current 且都是合法版本 → 需要升级
  needsUpgrade(requiredVersion: string): boolean {
    if (!isValidVersion(requiredVersion)) return false;
    if (!isValidVersion(this.currentVersion)) return false;
    return compareSemver(requiredVersion, this.currentVersion) > 0;
  }

  // COS 核心包 URL：install-pack/zenithjoy-agent-v<ver>.tar.gz（与发布/打包产物命名一致）
  buildCosUrl(version: string): string {
    return `${this.cosBase}/${CORE_DIR_PREFIX}${version}.tar.gz`;
  }

  // 新核心解压目标目录：…/extracted/zenithjoy-agent-v<ver>
  private newCoreDir(version: string): string {
    return path.join(this.extractedDir, `${CORE_DIR_PREFIX}${version}`);
  }

  // 指针文件路径：…/<root>/.active-core
  private pointerPath(): string {
    return path.join(this.rootDir, ACTIVE_CORE_POINTER);
  }

  // 心跳入口：required <= current → no-op；> current → 下载/校验/解压/拷配置/写指针/退出。
  // 任何环节失败都回滚（不写指针、不退出），旧核心继续跑，绝不把客户机搞挂。
  async upgradeIfNeeded(
    requiredVersion: string,
    verify?: CoreVerifyInfo,
  ): Promise<UpgradeResult> {
    if (!this.needsUpgrade(requiredVersion)) {
      return { upgraded: false, reason: 'up_to_date' };
    }
    if (this.upgrading) {
      return { upgraded: false, reason: 'already_upgrading' };
    }
    this.upgrading = true;
    try {
      const destDir = this.newCoreDir(requiredVersion);
      const cosUrl = this.buildCosUrl(requiredVersion);
      this.log(`核心需升级 ${this.currentVersion} → ${requiredVersion}，下载 ${cosUrl}`);
      await this.report({
        kind: 'upgrade',
        phase: 'download',
        percent: 10,
        message: `核心升级 ${this.currentVersion} → ${requiredVersion}，开始下载`,
        context: { from: this.currentVersion, to: requiredVersion },
      });

      // 1. 下载 + 解压到新核心目录（真实实现内含 sha 校验后才解压；注入实现自定）
      try {
        await this.runDownload(requiredVersion, cosUrl, destDir, verify);
      } catch (err) {
        const reason = `核心包下载/校验失败：${(err as Error).message}`;
        this.log(`${reason}（回滚，保留旧核心 ${this.currentVersion}）`);
        await this.report({ kind: 'upgrade', phase: 'failed', message: reason, context: { to: requiredVersion } });
        await this.report({ kind: 'log', level: 'error', message: reason, context: { to: requiredVersion } });
        this.safeCleanup(destDir);
        return { upgraded: false, reason };
      }
      await this.report({
        kind: 'upgrade',
        phase: 'verify',
        percent: 50,
        message: '核心包下载 + 校验通过',
        context: { to: requiredVersion },
      });

      // 2. 解压产物自检：新核心目录必须有 zenithjoy-agent.exe（缺 = 包损坏 → 回滚）
      if (!fs.existsSync(path.join(destDir, 'zenithjoy-agent.exe'))) {
        const reason = '新核心目录缺 zenithjoy-agent.exe（包损坏），回滚';
        this.log(reason);
        await this.report({ kind: 'upgrade', phase: 'failed', message: reason, context: { to: requiredVersion } });
        await this.report({ kind: 'log', level: 'error', message: reason, context: { to: requiredVersion } });
        this.safeCleanup(destDir);
        return { upgraded: false, reason };
      }
      await this.report({
        kind: 'upgrade',
        phase: 'extract',
        percent: 70,
        message: '新核心解压自检通过',
        context: { to: requiredVersion },
      });

      // 3. 拷过 .env / license / 已下模块（保住客户配置与已安装模块，不让升级丢状态）
      this.carryOverState(destDir);

      // 4. 写 .active-core 指针（启动器据它选最新核心目录）
      try {
        fs.writeFileSync(
          this.pointerPath(),
          `${CORE_DIR_PREFIX}${requiredVersion}\n`,
          'utf-8',
        );
        this.log(`已写 .active-core 指针 → ${CORE_DIR_PREFIX}${requiredVersion}`);
      } catch (err) {
        const reason = `写 .active-core 指针失败：${(err as Error).message}`;
        this.log(`${reason}（回滚，保留旧核心）`);
        await this.report({ kind: 'upgrade', phase: 'failed', message: reason, context: { to: requiredVersion } });
        await this.report({ kind: 'log', level: 'error', message: reason, context: { to: requiredVersion } });
        return { upgraded: false, reason };
      }
      await this.report({
        kind: 'upgrade',
        phase: 'activate',
        percent: 90,
        message: `已写 .active-core 指针 → ${CORE_DIR_PREFIX}${requiredVersion}`,
        context: { to: requiredVersion },
      });

      // 5. 优雅退出 → 计划任务/启动器读指针拉起新核心（自换+重启接缝，真机验）
      this.log(`核心 ${requiredVersion} 已就位，优雅退出由启动器拉起新核心`);
      await this.report({
        kind: 'upgrade',
        phase: 'done',
        percent: 100,
        message: `核心 ${requiredVersion} 已就位，优雅退出由启动器拉起新核心`,
        context: { to: requiredVersion },
      });
      (this.opts.exitImpl ?? (() => process.exit(0)))();
      return { upgraded: true, version: requiredVersion };
    } finally {
      this.upgrading = false;
    }
  }

  // 下载实现分派：注入优先，否则走真实 https 下载 + verifyFile 校验 + tar 解压
  private async runDownload(
    version: string,
    cosUrl: string,
    destDir: string,
    verify?: CoreVerifyInfo,
  ): Promise<void> {
    if (this.opts.downloadImpl) {
      await this.opts.downloadImpl(version, cosUrl, destDir);
      // 注入下载场景下仍走 verifyImpl（若提供）做"校验失败→回滚"语义验证
      if (this.opts.verifyImpl && verify && (verify.sha256 || verify.size)) {
        const ok = await this.opts.verifyImpl(destDir, verify);
        if (!ok) throw new Error('核心包 sha/size 校验未通过');
      }
      return;
    }

    // 真实路径：下载 tar.gz 到 tmp → 校验 → 解压
    const tmpFile = path.join(os.tmpdir(), `zj-core-${version}.tar.gz`);
    await this.httpsDownload(cosUrl, tmpFile);
    try {
      if (verify && (verify.sha256 || verify.size)) {
        const ok = await this.verifyFile(tmpFile, verify);
        if (!ok) throw new Error('核心包 sha/size 校验未通过');
      }
      fs.mkdirSync(destDir, { recursive: true });
      // tar.gz 内含顶层目录 zenithjoy-agent-v<ver>/，--strip-components=1 去掉它直接落 destDir
      await this.extractTarGz(tmpFile, destDir);
    } finally {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {
        // ignore
      }
    }
  }

  // 真实 sha256 + size 校验
  async verifyFile(filePath: string, info: CoreVerifyInfo): Promise<boolean> {
    try {
      if (typeof info.size === 'number') {
        const actual = fs.statSync(filePath).size;
        if (actual !== info.size) {
          this.log(`size 不符：期望 ${info.size}，实际 ${actual}`);
          return false;
        }
      }
      if (info.sha256) {
        const buf = fs.readFileSync(filePath);
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        if (actual.toLowerCase() !== info.sha256.toLowerCase()) {
          this.log(`sha256 不符：期望 ${info.sha256}，实际 ${actual}`);
          return false;
        }
      }
      return true;
    } catch (err) {
      this.log(`verifyFile 失败：${(err as Error).message}`);
      return false;
    }
  }

  // 把旧核心的 .env / license / 已下模块拷到新核心目录（升级不丢客户状态）
  private carryOverState(destDir: string): void {
    const carryFiles = ['.env', 'license.json', 'agent-id.json'];
    for (const f of carryFiles) {
      try {
        const src = path.join(this.coreDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(destDir, f));
          this.log(`carry-over ${f}`);
        }
      } catch (err) {
        this.log(`carry-over ${f} 失败（非致命）：${(err as Error).message}`);
      }
    }
    // 身份统一（cp-06270030）：把 %APPDATA%/zenithjoy-agent/config.json（含 apiUrl + agentUuid + agentId）
    // 带到新核心目录，让新核心拿得到 apiBase / 稳定身份，绝不静默回落生产 / 重新 register 裂身份。
    // 来源优先 configDir（真客户机 SSOT），其次旧核心目录内的 config.json。
    try {
      const candidates = [
        path.join(this.configDir, 'config.json'),
        path.join(this.coreDir, 'config.json'),
      ];
      const srcCfg = candidates.find((p) => fs.existsSync(p));
      if (srcCfg) {
        fs.copyFileSync(srcCfg, path.join(destDir, 'config.json'));
        this.log(`carry-over config.json（来自 ${srcCfg}）`);
      } else {
        this.log('未找到 config.json，跳过 carry-over（新核心可能需重新配置 apiUrl）');
      }
    } catch (err) {
      this.log(`carry-over config.json 失败（非致命）：${(err as Error).message}`);
    }
    // 已下模块若就放在核心目录内（modules/）一并带过去；模块也可放 %APPDATA% 不在核心目录，
    // 那种情况下新核心 module-manager 会按 defaultModulesRoot 复用，无需拷。
    try {
      const modSrc = path.join(this.coreDir, 'modules');
      if (fs.existsSync(modSrc) && fs.statSync(modSrc).isDirectory()) {
        fs.cpSync(modSrc, path.join(destDir, 'modules'), { recursive: true });
        this.log('carry-over modules/');
      }
    } catch (err) {
      this.log(`carry-over modules 失败（非致命）：${(err as Error).message}`);
    }
  }

  // 升级失败时清理半成品新核心目录（防留坏目录被启动器误选）
  private safeCleanup(destDir: string): void {
    try {
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    } catch (err) {
      this.log(`清理 ${destDir} 失败（非致命）：${(err as Error).message}`);
    }
  }

  // Node https 下载到文件（跟随 301/302 重定向）—— 与 module-manager 同写法
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

  // 用系统 tar 解压；--strip-components=1 去掉包内顶层 zenithjoy-agent-v<ver>/ 目录
  private extractTarGz(tarFile: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child: ChildProcess = execFile(
        'tar',
        ['xzf', tarFile, '-C', destDir, '--strip-components=1'],
        { windowsHide: true },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
      child.on('error', reject);
    });
  }
}
