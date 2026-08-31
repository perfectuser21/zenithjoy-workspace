// services/agent/src/handlers/desktop-frame-source.ts
//
// Windows 桌面画面捕获（工作机控制塔第二刀·件3）。
//
// 形态：起**一个常驻** PowerShell 子进程，它自己按帧率循环截屏 → JPEG → base64 一行写
// stdout；Node 侧读行解码成帧。不是每帧 spawn 一次 —— 进程启动开销数百毫秒，8fps 下
// 每秒起 8 个进程，机器直接废掉。
//
// ── 为什么是 PowerShell 而不是原生模块 ────────────────────────────────────
// agent 打包成 pkg 单 exe（package:win），塞原生 .node / 第三方截屏 exe 都会让分发变脆，
// 而且第三方截屏二进制本身就常被 Defender 拦。System.Drawing 是 Windows 自带的。
//
// ── AMSI：真机实测的边界（2026-08-31 xian-rog）────────────────────────────
// Defender 的 AMSI 会在**脚本内容**层面拦截，实测二分结果：
//   · 截屏 + MemoryStream + Write-Output（本文件的形态）  → 放行
//   · 只写盘、不截屏                                      → 放行
//   · 截屏 + 把图字节写盘（WriteAllBytes / Set-Content）   → ScriptContainedMaliciousContent 拦死
// 认的是「截屏后把图落盘」这个窃屏木马组合。所以本脚本：
//   1. **一个字节都不落盘**，帧只走 stdout（有测试守着，见 desktop-frame-source.test.ts）
//   2. 走 `-Command` 内联，不写 .ps1 文件（pkg 单 exe 也没地方放）
// 另一条实测教训：用 `[Convert]::FromBase64String(...)` 往磁盘投放脚本同样被 AMSI 拦
// （经典 dropper 特征）—— 分发脚本不要用这条路。
//
// ── session 0 / session 1 ────────────────────────────────────────────────
// CopyFromScreen 在 session 0（服务/SSH 上下文）拿不到桌面句柄，会抛 Win32Exception
// 「句柄无效」。agent 本身跑在用户交互会话里，正常；若被装成服务跑，桌面上墙就取不到帧，
// 表现为持续没有帧回调，不是崩溃。
//
// 真机实测（rog，1707x1067 缩到 720 长边，JPEG q≈默认）：26ms/帧、约 32KB/帧 —— 8fps 有富余。

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

/** 125ms ≈ 8fps：够看出屏幕在动，又不至于把客户带宽和 CPU 打爆。 */
export const DEFAULT_CAPTURE_INTERVAL_MS = 125;

/** 缩放后长边像素。真机实测 720 长边 ≈ 32KB/帧，远低于服务端 120KB 上限。 */
export const DEFAULT_MAX_LONG_SIDE_PX = 720;

/** 单行上限：正常帧 base64 后约 45KB，256KB 已经远超任何合法帧。 */
const DEFAULT_MAX_LINE_BYTES = 256 * 1024;

/**
 * 生成喂给 `powershell -Command` 的截屏脚本（单行，无换行）。
 *
 * ⚠️ 改这个脚本前先读文件头的 AMSI 段：**任何把图字节写盘的语句都会让整个功能在客户机上
 * 被 Defender 静默拦死**。调试请把内容打到 stderr，不要存图。
 */
export function buildCaptureScript(opts: {
  intervalMs: number;
  maxLongSidePx: number;
}): string {
  const { intervalMs, maxLongSidePx } = opts;
  // 每句之间用 ';' 连成一行：pkg 出来的 exe 走 spawn 传参，不经 cmd 解析，无需再转义。
  return [
    `Add-Type -AssemblyName System.Drawing`,
    `Add-Type -AssemblyName System.Windows.Forms`,
    `$ErrorActionPreference='Continue'`,
    `$b=[System.Windows.Forms.SystemInformation]::VirtualScreen`,
    `$full=New-Object System.Drawing.Bitmap $b.Width,$b.Height`,
    `$g=[System.Drawing.Graphics]::FromImage($full)`,
    `$long=[Math]::Max($b.Width,$b.Height)`,
    `$scale=1.0`,
    `if($long -gt ${maxLongSidePx}){ $scale=${maxLongSidePx}.0/$long }`,
    `$nw=[int]($b.Width*$scale)`,
    `$nh=[int]($b.Height*$scale)`,
    `$small=New-Object System.Drawing.Bitmap $nw,$nh`,
    `$g2=[System.Drawing.Graphics]::FromImage($small)`,
    `while($true){`,
    `try{`,
    `$g.CopyFromScreen($b.X,$b.Y,0,0,$full.Size)`,
    `$g2.DrawImage($full,0,0,$nw,$nh)`,
    `$ms=New-Object System.IO.MemoryStream`,
    `$small.Save($ms,[System.Drawing.Imaging.ImageFormat]::Jpeg)`,
    `[Console]::Out.WriteLine([Convert]::ToBase64String($ms.ToArray()))`,
    `$ms.Dispose()`,
    `}catch{ [Console]::Error.WriteLine('capture: ' + $_.Exception.Message) }`,
    `Start-Sleep -Milliseconds ${intervalMs}`,
    `}`,
  ].join('; ');
}

/**
 * 把子进程 stdout 的字节流切成一帧一帧。
 *
 * PowerShell 的 stdout 不只有我们的帧 —— 警告/进度行也会混进来，所以非 base64 的行一律丢，
 * 绝不能把 "WARNING: ..." 当成一帧推上墙。
 */
export class Base64LineDecoder {
  private buf = '';
  private readonly maxLineBytes: number;
  private overflowed = false;

  constructor(opts: { maxLineBytes?: number } = {}) {
    this.maxLineBytes = opts.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  push(chunk: Buffer): Buffer[] {
    this.buf += chunk.toString('latin1');
    const frames: Buffer[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, '');
      this.buf = this.buf.slice(idx + 1);
      if (this.overflowed) {
        // 溢出那一行的尾巴，整行作废；从下一行重新开始
        this.overflowed = false;
        continue;
      }
      const frame = decodeBase64Line(line);
      if (frame) frames.push(frame);
    }
    if (this.buf.length > this.maxLineBytes) {
      // 子进程发疯输出无换行的巨串时，别把内存吃光
      this.buf = '';
      this.overflowed = true;
    }
    return frames;
  }
}

const BASE64_LINE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64Line(line: string): Buffer | null {
  const trimmed = line.trim();
  if (!trimmed || !BASE64_LINE.test(trimmed)) return null;
  const buf = Buffer.from(trimmed, 'base64');
  return buf.length > 0 ? buf : null;
}

export interface DesktopFrameSourceOptions {
  onFrame: (jpeg: Buffer) => void;
  onError?: (err: unknown) => void;
  intervalMs?: number;
  maxLongSidePx?: number;
  /** 注入用（测试 / 非 win32 平台短路）。 */
  spawnImpl?: typeof nodeSpawn;
  platform?: NodeJS.Platform;
}

/** 常驻 PowerShell 截屏源。start/stop 幂等。 */
export class DesktopFrameSource {
  private child: ChildProcess | null = null;
  private readonly decoder: Base64LineDecoder;
  private readonly opts: Required<Omit<DesktopFrameSourceOptions, 'onError'>> &
    Pick<DesktopFrameSourceOptions, 'onError'>;

  constructor(options: DesktopFrameSourceOptions) {
    this.opts = {
      intervalMs: DEFAULT_CAPTURE_INTERVAL_MS,
      maxLongSidePx: DEFAULT_MAX_LONG_SIDE_PX,
      spawnImpl: nodeSpawn,
      platform: process.platform,
      ...options,
    };
    this.decoder = new Base64LineDecoder();
  }

  isRunning(): boolean {
    return this.child !== null;
  }

  start(): void {
    if (this.child) return; // 幂等：重复 start 会起第二个 8fps 循环，双倍开销
    if (this.opts.platform !== 'win32') {
      // 桌面捕获目前只做 Windows（客户机形态）。安卓端走 agent-android 的 FramePushLoop。
      return;
    }
    const script = buildCaptureScript({
      intervalMs: this.opts.intervalMs,
      maxLongSidePx: this.opts.maxLongSidePx,
    });
    const child = this.opts.spawnImpl(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const frame of this.decoder.push(chunk)) {
        try {
          this.opts.onFrame(frame);
        } catch (err) {
          this.opts.onError?.(err);
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      // 截屏在 session 0 会持续报「句柄无效」；留日志但不当致命，agent 主链路不受影响
      this.opts.onError?.(new Error(`[desktop-capture] ${chunk.toString().trim()}`));
    });
    child.on('error', (err) => this.opts.onError?.(err));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      // 已退出/句柄失效，忽略
    }
  }
}
