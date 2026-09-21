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
  previewCandidate,
  getCandidateDetail,
  listRuns,
} from '../mashup.api';

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

describe('listTemplates', () => {
  it('带 X-Upload-Token 调 GET /mashup/templates', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
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
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
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
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
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
  it('POST /mashup/candidates/:id/render，回的是队列态不是终版结果（决策 d6bedf80 并发=1队列）', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { candidateId: 'c1', renderStatus: 'queued', queuePosition: 1, contentId: null } },
    });

    const result = await renderCandidate('c1');
    expect(result.renderStatus).toBe('queued');
    expect(result.queuePosition).toBe(1);
  });
});

describe('previewCandidate', () => {
  it('POST /mashup/candidates/:id/preview', async () => {
    mockToken();
    post.mockResolvedValue({
      data: { data: { candidateId: 'c1', previewStatus: 'generating', queuePosition: 0, previewUrl: null } },
    });

    const result = await previewCandidate('c1');
    expect(result.previewStatus).toBe('generating');
    const call = post.mock.calls.find((c) => c[0] === '/mashup/candidates/c1/preview');
    expect(call).toBeTruthy();
  });
});

describe('getCandidateDetail', () => {
  it('GET /mashup/candidates/:id，渲染完成时带出 content', async () => {
    mockToken();
    get.mockImplementation(async (url: string) => {
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/candidates/c1') {
        return {
          data: {
            data: {
              id: 'c1', runId: 'run-1', score: 1.5, slotFill: {}, thumbnailUrl: null,
              renderStatus: 'rendered', previewStatus: 'ready', previewUrl: 'https://preview.example/c1.mp4',
              content: { contentId: 'content-1', safetyCheckStatus: 'passed', watermarkCheckStatus: 'passed', exportUrl: 'https://x', downloadUrl: 'https://x' },
            },
          },
        };
      }
      throw new Error('unexpected GET ' + url);
    });

    const detail = await getCandidateDetail('c1');
    expect(detail.renderStatus).toBe('rendered');
    expect(detail.content?.exportUrl).toBe('https://x');
  });
});

describe('listRuns', () => {
  it('带 X-Upload-Token 调 GET /mashup/runs 并解包 data.data', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account/me') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/mashup/runs') {
        return {
          data: {
            data: {
              items: [{
                runId: 'run-1', templateId: 'tmpl-1', status: 'completed',
                stage: 'candidates_pending', createdAt: '2026-09-20T10:00:00.000Z',
                candidateCount: 3, thumbnailUrl: null, selectedCandidateId: null,
              }],
              limit: 20, offset: 0, count: 1,
            },
          },
        };
      }
      throw new Error('unexpected GET ' + url);
    });

    const result = await listRuns();

    expect(result.items[0].stage).toBe('candidates_pending');
    const call = get.mock.calls.find((c: unknown[]) => c[0] === '/mashup/runs');
    expect((call?.[1] as { headers: Record<string, string> }).headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
  });
});
