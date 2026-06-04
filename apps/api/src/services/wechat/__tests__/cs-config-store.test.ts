/* eslint-disable @typescript-eslint/no-explicit-any -- 测试注入 mock，容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../../db/connection';
import { loadPersona } from '../persona';
import { loadBusinessKB } from '../business-kb';
import {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
} from '../cs-config-store';
import type { BusinessKB, Persona } from '../types';

/**
 * cs-config-store.ts 单测 —— **mock 掉 db connection + ./persona、./business-kb 的 loader**，
 * 不连真实 DB / 文件系统。
 *
 * 覆盖：
 *  - DB 命中 → 返回 DB 值（不调兜底 loader）
 *  - 无行 → 回落兜底 loader
 *  - DB 抛错 → 回落兜底 loader
 *  - jsonb 字符串值也能解析
 *  - save 发出 upsert SQL（含 ON CONFLICT）且参数为 JSON 字符串
 */

vi.mock('../../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../persona', () => ({
  loadPersona: vi.fn(),
}));

vi.mock('../business-kb', () => ({
  loadBusinessKB: vi.fn(),
}));

const mockedQuery = vi.mocked(pool.query as any);
const mockedLoadPersona = vi.mocked(loadPersona as any);
const mockedLoadKB = vi.mocked(loadBusinessKB as any);

const FALLBACK_PERSONA: Persona = {
  self_name: '兜底',
  address_style: 'x',
  tone: 'x',
  sentence_style: 'x',
  use_emoji: 'x',
  banned_phrases: [],
  few_shot: [],
};

const FALLBACK_KB: BusinessKB = {
  company: { name: '兜底公司', what_we_do: '', value_prop: '', contact: '' },
  products: [],
  audience_segments: [],
  qa_docs: [],
};

const DB_PERSONA: Persona = {
  self_name: 'DB小齐',
  address_style: '叫名字',
  tone: '随和',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: ['亲'],
  few_shot: [{ customer: '在吗', me: '在' }],
};

const DB_KB: BusinessKB = {
  company: { name: 'DB公司', what_we_do: 'AI', value_prop: '快', contact: 'wx123' },
  products: [{ name: 'P1', selling_points: '好' }],
  audience_segments: [{ code: 'A1', label: '宝妈', desc: '...' }],
  qa_docs: [{ q: '多少钱', a: '看版本' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedQuery.mockResolvedValue({ rows: [] });
  mockedLoadPersona.mockReturnValue(FALLBACK_PERSONA);
  mockedLoadKB.mockReturnValue(FALLBACK_KB);
});

// ─── getPersona ────────────────────────────────────────────────────────────────

describe('getPersona', () => {
  it('DB 命中 → 返回 DB 值（不调兜底 loadPersona）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ value: DB_PERSONA }] });

    const result = await getPersona();

    expect(result).toEqual(DB_PERSONA);
    expect(mockedLoadPersona).not.toHaveBeenCalled();
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/SELECT value FROM zenithjoy\.wechat_cs_config/);
    expect(params).toEqual(['persona']);
  });

  it('DB 给字符串形式 jsonb → 也能解析返回', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ value: JSON.stringify(DB_PERSONA) }],
    });

    const result = await getPersona();

    expect(result).toEqual(DB_PERSONA);
    expect(mockedLoadPersona).not.toHaveBeenCalled();
  });

  it('无行 → 回落兜底 loadPersona', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getPersona();

    expect(result).toEqual(FALLBACK_PERSONA);
    expect(mockedLoadPersona).toHaveBeenCalledTimes(1);
  });

  it('DB 抛错 → 回落兜底 loadPersona', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));

    const result = await getPersona();

    expect(result).toEqual(FALLBACK_PERSONA);
    expect(mockedLoadPersona).toHaveBeenCalledTimes(1);
  });

  it('value 解析失败（非法字符串）→ 回落兜底', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ value: 'not-json{' }] });

    const result = await getPersona();

    expect(result).toEqual(FALLBACK_PERSONA);
    expect(mockedLoadPersona).toHaveBeenCalledTimes(1);
  });
});

// ─── savePersona ───────────────────────────────────────────────────────────────

describe('savePersona', () => {
  it('发出 upsert SQL（含 ON CONFLICT），参数为 key + JSON 字符串', async () => {
    await savePersona(DB_PERSONA);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO zenithjoy\.wechat_cs_config/);
    expect(String(sql)).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(String(sql)).toMatch(/\$2::jsonb/);
    expect(params[0]).toBe('persona');
    expect(JSON.parse(params[1])).toEqual(DB_PERSONA);
  });

  it('DB 失败时 console.warn 不抛', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(savePersona(DB_PERSONA)).resolves.toBeUndefined();
  });
});

// ─── getBusinessKB ─────────────────────────────────────────────────────────────

describe('getBusinessKB', () => {
  it('DB 命中 → 返回 DB 值（不调兜底 loadBusinessKB）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ value: DB_KB }] });

    const result = await getBusinessKB();

    expect(result).toEqual(DB_KB);
    expect(mockedLoadKB).not.toHaveBeenCalled();
    const [, params] = mockedQuery.mock.calls[0];
    expect(params).toEqual(['business_kb']);
  });

  it('无行 → 回落兜底 loadBusinessKB', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getBusinessKB();

    expect(result).toEqual(FALLBACK_KB);
    expect(mockedLoadKB).toHaveBeenCalledTimes(1);
  });

  it('DB 抛错 → 回落兜底 loadBusinessKB', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));

    const result = await getBusinessKB();

    expect(result).toEqual(FALLBACK_KB);
    expect(mockedLoadKB).toHaveBeenCalledTimes(1);
  });
});

// ─── saveBusinessKB ────────────────────────────────────────────────────────────

describe('saveBusinessKB', () => {
  it('发出 upsert SQL（含 ON CONFLICT），key=business_kb', async () => {
    await saveBusinessKB(DB_KB);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO zenithjoy\.wechat_cs_config/);
    expect(String(sql)).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(params[0]).toBe('business_kb');
    expect(JSON.parse(params[1])).toEqual(DB_KB);
  });

  it('DB 失败时 console.warn 不抛', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('db down'));
    await expect(saveBusinessKB(DB_KB)).resolves.toBeUndefined();
  });
});
