/**
 * 批量混剪横竖屏选择（GP line05/batch_mashup#step4）：createRun 新增可选的
 * aspectRatio 参数。与 mashup.api.test.ts 同口径（登录态换 X-Upload-Token），
 * 独立成新文件而不是改现有 mashup.api.test.ts——任务铁律只许碰指定文件 + 新建
 * 测试，不动已注册的既有测试文件（那边的 createRun 用例做了严格 body toEqual，
 * 断言不传 aspectRatio 时请求体不多一个字段，两处正好互补验证向后兼容）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../client', () => ({ apiClient: { get, post } }));

import { createRun } from '../mashup.api';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

function mockToken() {
  get.mockImplementation(async (url: string) => {
    if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
    throw new Error('unexpected GET ' + url);
  });
}

describe('createRun — aspectRatio', () => {
  it('传 aspectRatio="portrait"：请求体带上该字段', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { runId: 'run-1', status: 'completed', assignments: [], aspectRatio: 'portrait' } },
    });

    await createRun('tmpl-1', ['mat-1'], 'portrait');

    const call = post.mock.calls.find((c) => c[0] === '/mashup/runs');
    expect(call![1]).toEqual({ templateId: 'tmpl-1', materialIds: ['mat-1'], aspectRatio: 'portrait' });
  });

  it('传 aspectRatio="landscape"：请求体带上该字段', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { runId: 'run-1', status: 'completed', assignments: [], aspectRatio: 'landscape' } },
    });

    await createRun('tmpl-1', ['mat-1'], 'landscape');

    const call = post.mock.calls.find((c) => c[0] === '/mashup/runs');
    expect(call![1]).toEqual({ templateId: 'tmpl-1', materialIds: ['mat-1'], aspectRatio: 'landscape' });
  });

  it('不传第三个参数：请求体不出现 aspectRatio 键（向后兼容旧调用方）', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { runId: 'run-1', status: 'completed', assignments: [] } },
    });

    await createRun('tmpl-1', ['mat-1']);

    const call = post.mock.calls.find((c) => c[0] === '/mashup/runs');
    expect(call![1]).toEqual({ templateId: 'tmpl-1', materialIds: ['mat-1'] });
    expect(Object.prototype.hasOwnProperty.call(call![1], 'aspectRatio')).toBe(false);
  });
});
