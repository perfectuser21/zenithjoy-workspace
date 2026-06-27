// services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts
//
// Sprint cp-06261900 — douyin-dm-outreach 改用共享 playwright-launcher（playwright-core 优先）
//
// createRealDmPage 旧版内联 `new Function('m','return import(m)')` 加载 'playwright'（完整包，
// pkg 没打进 → 真机报「playwright 未安装」）。改后走共享 loadChromium（playwright-core 优先）。
// 编排逻辑（sent/limited/failed 三态）走注入 DmPage，不触真实浏览器。

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { handleDouyinDmOutreach, mapDmStatusToFeishu, resolveDmOutreachScript } from '../douyin-dm-outreach';

const HANDLER_PATH = path.resolve(__dirname, '../douyin-dm-outreach.ts');

function fakePage(over: Partial<Record<string, any>> = {}) {
  return {
    url: () => 'https://www.douyin.com/user/x',
    goto: vi.fn().mockResolvedValue(undefined),
    clickDmButton: vi.fn().mockResolvedValue(true),
    typeMessage: vi.fn().mockResolvedValue(undefined),
    pressEnter: vi.fn().mockResolvedValue(undefined),
    hasMessageBubble: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

describe('douyin-dm-outreach — 共享 launcher + 三态 [BEHAVIOR]', () => {
  it('源码生产路径 spawn 外部 .cjs，删除 createRealDmPage 内联 playwright', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/spawn/);
    expect(src).toMatch(/douyin-dm-outreach\.cjs/);
    // createRealDmPage 已删（真机逻辑搬进 .cjs），不再 binary 内 loadChromium
    expect(src).not.toMatch(/loadChromium/);
    expect(src).not.toMatch(/createRealDmPage/);
  });

  it('可点私信 + 气泡出现 → sent', async () => {
    const page = fakePage();
    const r = await handleDouyinDmOutreach(
      { profile_url: 'https://www.douyin.com/user/x', message: '你好', account_label: 'b1' },
      { page: page as any },
    );
    expect(r).toMatchObject({ ok: true, status: 'sent' });
  });

  it('私信按钮不可点 → limited（禁止假 sent）', async () => {
    const page = fakePage({ clickDmButton: vi.fn().mockResolvedValue(false) });
    const r = await handleDouyinDmOutreach(
      { profile_url: 'https://www.douyin.com/user/x', message: '你好', account_label: 'b1' },
      { page: page as any },
    );
    expect(r).toMatchObject({ ok: false, status: 'limited' });
    expect(page.typeMessage).not.toHaveBeenCalled();
  });

  it('发送后无气泡 → failed (NO_BUBBLE)', async () => {
    const page = fakePage({ hasMessageBubble: vi.fn().mockResolvedValue(false) });
    const r = await handleDouyinDmOutreach(
      { profile_url: 'https://www.douyin.com/user/x', message: '你好', account_label: 'b1' },
      { page: page as any },
    );
    expect(r).toMatchObject({ ok: false, status: 'failed', error_code: 'NO_BUBBLE' });
  });

  it('mapDmStatusToFeishu：limited 绝不写「已私信」', () => {
    expect(mapDmStatusToFeishu('sent')).toBe('已私信');
    expect(mapDmStatusToFeishu('limited')).toBe('未送达-仅互关');
    expect(mapDmStatusToFeishu('failed')).toBe('失败');
  });
});

describe('douyin-dm-outreach — spawn 外部 .cjs（生产）[BEHAVIOR]', () => {
  it('resolveDmOutreachScript 指向 publishers/douyin-dm-outreach.cjs', () => {
    expect(resolveDmOutreachScript()).toMatch(/[\\/]publishers[\\/]douyin-dm-outreach\.cjs$/);
  });

  it('publishers/douyin-dm-outreach.cjs 文件真实存在', () => {
    expect(fs.existsSync(resolveDmOutreachScript())).toBe(true);
  });
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('douyin-dm-outreach — spawn 路径 argv [BEHAVIOR]', () => {
  function makeFakeProc(stdoutLine: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => { proc.stdout.emit('data', Buffer.from(stdoutLine + '\n')); proc.emit('close', 0); }, 0);
    return proc;
  }

  it('未注入 page → spawn .cjs，argv=[脚本,profile,message,label,udd]，返回末行 JSON', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc(JSON.stringify({ ok: true, status: 'sent', account_label: 'b1', profile_url: 'https://www.douyin.com/user/x' })) as unknown as ReturnType<typeof spawn>,
    );

    const r = await handleDouyinDmOutreach({ profile_url: 'https://www.douyin.com/user/x', message: '你好', account_label: 'b1' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [nodeExe, argv] = spawnMock.mock.calls[0];
    expect(nodeExe).toBeTruthy();
    expect(argv![0]).toMatch(/douyin-dm-outreach\.cjs$/);
    expect(argv![1]).toBe('https://www.douyin.com/user/x');
    expect(argv![2]).toBe('你好');
    expect(argv![3]).toBe('b1');
    expect(r).toMatchObject({ ok: true, status: 'sent' });
  });
});
