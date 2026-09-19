/**
 * 批量混剪 API 客户端单测。
 *
 * 与 materials.api.ts 同口径：Dashboard 用登录态、mashup 端点认 X-Upload-Token，
 * 每个函数都必须先换 token 再带 header 调用，否则整页 401。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../client', () => ({ apiClient: { get, post } }));

import {
  listTemplates,
  createRun,
  getRun,
  generateCandidates,
  listCandidates,
  selectCandidate,
  renderCandidate,
} from '../mashup.api';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

function mockToken() {
  get.mockImplementation(async (url: string) => {
    if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
    throw new Error('unexpected GET ' + url);
  });
}

describe('listTemplates', () => {
  it('带 X-Upload-Token 调 GET /mashup/templates', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/templates') return { data: { data: [{ id: 'tmpl-1', name: '标准四槽位', slots: [] }] } };
      throw new Error('unexpected GET ' + url);
    });

    const templates = await listTemplates();

    expect(templates).toHaveLength(1);
    const call = get.mock.calls.find((c) => c[0] === '/mashup/templates');
    expect(call![1].headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
  });
});

describe('createRun', () => {
  it('POST /mashup/runs 带 templateId + materialIds', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { runId: 'run-1', status: 'completed', assignments: [] } },
    });

    const run = await createRun('tmpl-1', ['mat-1', 'mat-2']);

    expect(run.runId).toBe('run-1');
    const call = post.mock.calls.find((c) => c[0] === '/mashup/runs');
    expect(call![1]).toEqual({ templateId: 'tmpl-1', materialIds: ['mat-1', 'mat-2'] });
    expect(call![2].headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
  });
});

describe('getRun', () => {
  it('GET /mashup/runs/:id', async () => {
    mockToken();
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/runs/run-1') return { data: { data: { runId: 'run-1', status: 'completed', assignments: [] } } };
      throw new Error('unexpected GET ' + url);
    });

    const run = await getRun('run-1');
    expect(run.runId).toBe('run-1');
  });
});

describe('generateCandidates', () => {
  it('POST /mashup/runs/:id/candidates', async () => {
    mockToken();
    post.mockResolvedValue({ data: { data: { runId: 'run-1', candidates: [] } } });

    await generateCandidates('run-1');

    const call = post.mock.calls.find((c) => c[0] === '/mashup/runs/run-1/candidates');
    expect(call).toBeTruthy();
  });
});

describe('listCandidates', () => {
  it('GET /mashup/runs/:id/candidates', async () => {
    mockToken();
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/runs/run-1/candidates') return { data: { data: { runId: 'run-1', candidates: [{ id: 'c1', score: 1, slotFill: {} }] } } };
      throw new Error('unexpected GET ' + url);
    });

    const result = await listCandidates('run-1');
    expect(result.candidates).toHaveLength(1);
  });
});

describe('selectCandidate', () => {
  it('POST /mashup/candidates/:id/select', async () => {
    mockToken();
    post.mockResolvedValue({ data: { data: { runId: 'run-1', selectedCandidateId: 'c1' } } });

    const result = await selectCandidate('c1');
    expect(result.selectedCandidateId).toBe('c1');
  });
});

describe('renderCandidate', () => {
  it('POST /mashup/candidates/:id/render', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { contentId: 'content-1', safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed', exportUrl: 'https://x', downloadUrl: 'https://x' } },
    });

    const result = await renderCandidate('c1');
    expect(result.contentId).toBe('content-1');
    expect(result.exportUrl).toBe('https://x');
  });
});
