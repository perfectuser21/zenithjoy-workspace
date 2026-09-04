// services/agent/src/handlers/__tests__/desktop-frame-source.test.ts
//
// 桌面捕获（件3）的两块纯逻辑：截屏脚本文本 + stdout 帧解码。
//
// AMSI 那条断言不是形式主义 —— 2026-08-31 在 xian-rog 真机二分实测：
//   · 截屏 + 写 MemoryStream + Write-Output      → 放行
//   · 只写盘、不截屏                              → 放行
//   · 截屏 + 把图字节写盘（WriteAllBytes/Set-Content）→ **ScriptContainedMaliciousContent 直接拦死**
// 也就是说 Defender 认的是"截屏后把图落盘"这个组合（窃屏木马特征）。我们的形态天然避开它
// （截完直接 POST，从不落盘），但一旦有人日后往脚本里加一句调试用的存图，整个桌面上墙功能
// 会在客户机上静默死掉 —— 这条断言就是拦这个的。

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildCaptureScript,
  Base64LineDecoder,
  DEFAULT_CAPTURE_INTERVAL_MS,
  DEFAULT_MAX_LONG_SIDE_PX,
} from '../desktop-frame-source';

describe('buildCaptureScript', () => {
  it('截屏走 System.Drawing CopyFromScreen，出 JPEG base64 到 stdout', () => {
    const s = buildCaptureScript({ intervalMs: 125, maxLongSidePx: 720 });
    expect(s).toContain('System.Drawing');
    expect(s).toContain('CopyFromScreen');
    expect(s).toContain('MemoryStream');
    expect(s).toContain('ToBase64String');
  });

  it('绝不把图字节写盘 —— 真机实测这个组合会被 AMSI 拦死（见文件头）', () => {
    const s = buildCaptureScript({ intervalMs: 125, maxLongSidePx: 720 });
    for (const banned of ['WriteAllBytes', 'Set-Content', 'Out-File', 'FileStream', 'WriteAllText']) {
      expect(s, `脚本不得含落盘 API：${banned}`).not.toContain(banned);
    }
  });

  it('帧间隔与缩放长边写进脚本，调用方给多少是多少', () => {
    const s = buildCaptureScript({ intervalMs: 200, maxLongSidePx: 640 });
    expect(s).toContain('200');
    expect(s).toContain('640');
  });

  it('单行能塞进 Windows 命令行长度上限（脚本走 -Command 内联，不落 .ps1）', () => {
    const s = buildCaptureScript({ intervalMs: 125, maxLongSidePx: 720 });
    expect(s.length).toBeLessThan(8000);
    expect(s).not.toContain('\n');
  });

  it('默认值：帧率在 6-15fps 之间，长边不超过 720', () => {
    expect(1000 / DEFAULT_CAPTURE_INTERVAL_MS).toBeGreaterThanOrEqual(6);
    expect(1000 / DEFAULT_CAPTURE_INTERVAL_MS).toBeLessThanOrEqual(15);
    expect(DEFAULT_MAX_LONG_SIDE_PX).toBeLessThanOrEqual(720);
  });
});

describe('Base64LineDecoder', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  it('一个 chunk 里的整行 → 一帧', () => {
    const d = new Base64LineDecoder();
    const out = d.push(Buffer.from(`${b64('frame-1')}\n`));
    expect(out.map((b) => b.toString())).toEqual(['frame-1']);
  });

  it('一帧被拆在两个 chunk 里也能拼回来', () => {
    const d = new Base64LineDecoder();
    const line = `${b64('frame-1')}\n`;
    expect(d.push(Buffer.from(line.slice(0, 4)))).toEqual([]);
    expect(d.push(Buffer.from(line.slice(4))).map((b) => b.toString())).toEqual(['frame-1']);
  });

  it('一个 chunk 里挤了多帧 → 全部还原，顺序不乱', () => {
    const d = new Base64LineDecoder();
    const out = d.push(Buffer.from(`${b64('a')}\n${b64('b')}\n${b64('c')}\n`));
    expect(out.map((x) => x.toString())).toEqual(['a', 'b', 'c']);
  });

  it('CRLF 也吃（PowerShell 默认输出带 \\r）', () => {
    const d = new Base64LineDecoder();
    const out = d.push(Buffer.from(`${b64('frame-1')}\r\n`));
    expect(out.map((b) => b.toString())).toEqual(['frame-1']);
  });

  it('非 base64 的杂行直接丢，不当成帧', () => {
    const d = new Base64LineDecoder();
    // PowerShell 的警告/进度行会混进 stdout，不能把它们当帧推上墙
    const out = d.push(Buffer.from(`WARNING: something\n${b64('ok')}\n`));
    expect(out.map((b) => b.toString())).toEqual(['ok']);
  });

  it('空行忽略', () => {
    const d = new Base64LineDecoder();
    expect(d.push(Buffer.from('\n\n'))).toEqual([]);
  });

  it('单行超上限时丢弃并复位，不让缓冲无限涨', () => {
    const d = new Base64LineDecoder({ maxLineBytes: 64 });
    expect(d.push(Buffer.from('A'.repeat(100)))).toEqual([]);
    // 复位后仍能正常解下一帧，不是就此瘫掉
    const out = d.push(Buffer.from(`\n${b64('after-overflow')}\n`));
    expect(out.map((b) => b.toString())).toEqual(['after-overflow']);
  });
});

describe('DesktopFrameSource', () => {
  it('非 Windows 平台不 spawn —— 桌面捕获只在 Windows 上有意义', async () => {
    const { DesktopFrameSource } = await import('../desktop-frame-source');
    const spawnImpl = vi.fn();
    const src = new DesktopFrameSource({
      onFrame: () => {},
      spawnImpl: spawnImpl as never,
      platform: 'darwin',
    });
    src.start();
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(src.isRunning()).toBe(false);
    src.stop();
  });

  it('Windows 上起一个常驻 powershell —— 不是每帧 spawn 一次', async () => {
    const { DesktopFrameSource } = await import('../desktop-frame-source');
    const child = makeFakeChild();
    const spawnImpl = vi.fn(() => child);
    const src = new DesktopFrameSource({
      onFrame: () => {},
      spawnImpl: spawnImpl as never,
      platform: 'win32',
    });
    src.start();
    src.start(); // 幂等：重复 start 不该起第二个进程（两个 8fps 循环 = 双倍开销）
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnImpl.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toMatch(/powershell/i);
    expect(args).toContain('-NoProfile');
    expect(args.join(' ')).toContain('-Command');
    src.stop();
    expect(src.isRunning()).toBe(false);
  });

  it('stdout 上的 base64 行变成帧回调', async () => {
    const { DesktopFrameSource } = await import('../desktop-frame-source');
    const child = makeFakeChild();
    const frames: Buffer[] = [];
    const src = new DesktopFrameSource({
      onFrame: (f) => frames.push(f),
      spawnImpl: (() => child) as never,
      platform: 'win32',
    });
    src.start();
    child.stdout.emit('data', Buffer.from(`${Buffer.from('jpeg-bytes').toString('base64')}\n`));
    expect(frames.map((f) => f.toString())).toEqual(['jpeg-bytes']);
    src.stop();
  });
});

/** 最小 ChildProcess 替身：只需要 stdout/stderr 的 'data' 与 kill()。 */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}
