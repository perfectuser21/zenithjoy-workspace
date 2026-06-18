import { describe, it, expect, vi, beforeEach } from 'vitest';

// feishu-docx 是纯 I/O 编排（axios + pool + getValidToken）；真行为由 contract-dod.md
// [BEHAVIOR] Step0/Step1（rebuild 回填 doc_token / expand 读文档）作 evaluator oracle。
// 本配套 unit（lint-test-pairing）mock 三个边界，断言建/读 docx 的关键行为。
vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('./feishu-token', () => ({ getValidToken: vi.fn().mockResolvedValue('tok') }));
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));

import pool from '../db/connection';
import axios from 'axios';
import { createEnterpriseDoc, readEnterpriseDocText } from './feishu-docx';

const mPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mAxios = axios as unknown as { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mPool.query.mockReset();
  mAxios.post.mockReset();
  mAxios.get.mockReset();
});

describe('createEnterpriseDoc', () => {
  it('建 docx 成功 → 回填 enterprise_doc_token + 返回 token', async () => {
    mAxios.post.mockResolvedValue({ data: { code: 0, data: { document: { document_id: 'doccn_42' } } } });
    mPool.query.mockResolvedValue({ rows: [] });
    const tok = await createEnterpriseDoc('tenant-1', 'tok');
    expect(tok).toBe('doccn_42');
    const sql = mPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('enterprise_doc_token');
    expect(mPool.query.mock.calls[0][1]).toEqual(['tenant-1', 'doccn_42']);
  });

  it('飞书返回 code!=0 → 抛错且不回填', async () => {
    mAxios.post.mockResolvedValue({ data: { code: 99991663, msg: 'auth' } });
    await expect(createEnterpriseDoc('tenant-1', 'tok')).rejects.toThrow(/createEnterpriseDoc failed/);
    expect(mPool.query).not.toHaveBeenCalled();
  });
});

describe('readEnterpriseDocText', () => {
  it('无 doc_token → 返 null（不发 HTTP）', async () => {
    mPool.query.mockResolvedValue({ rows: [{ enterprise_doc_token: null }] });
    const text = await readEnterpriseDocText('tenant-1');
    expect(text).toBeNull();
    expect(mAxios.get).not.toHaveBeenCalled();
  });

  it('有 doc_token → 读 raw_content 返纯文本', async () => {
    mPool.query.mockResolvedValue({ rows: [{ enterprise_doc_token: 'doccn_9' }] });
    mAxios.get.mockResolvedValue({ data: { code: 0, data: { content: '行业:家装 受众:业主' } } });
    const text = await readEnterpriseDocText('tenant-1');
    expect(text).toBe('行业:家装 受众:业主');
  });
});
