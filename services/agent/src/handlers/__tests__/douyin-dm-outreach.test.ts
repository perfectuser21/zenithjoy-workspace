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
import { handleDouyinDmOutreach, mapDmStatusToFeishu } from '../douyin-dm-outreach';

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
  it('源码改走共享 loadChromium，不再内联 import(playwright)', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/loadChromium/);
    expect(src).toMatch(/playwright-launcher/);
    // 不再裸字符串 'playwright' 走 dynImport（共享 launcher 内部才处理 core/回退）
    expect(src).not.toMatch(/const\s+moduleName\s*=\s*['"]playwright['"]/);
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
