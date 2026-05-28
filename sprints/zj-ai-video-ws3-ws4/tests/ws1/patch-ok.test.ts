import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CONTROLLER_PATH = path.resolve('apps/api/src/controllers/ai-video-pipeline.controller.ts');
const SRC = fs.readFileSync(CONTROLLER_PATH, 'utf8');

const UPDATE_PROGRESS_START = SRC.indexOf('async function updateProgress');
const UPDATE_PROGRESS_END = SRC.indexOf('\nasync function ', UPDATE_PROGRESS_START + 1);
const UPDATE_PROGRESS_FN = SRC.slice(
  UPDATE_PROGRESS_START,
  UPDATE_PROGRESS_END > UPDATE_PROGRESS_START ? UPDATE_PROGRESS_END : UPDATE_PROGRESS_START + 2000,
);

const GET_JOB_START = SRC.indexOf('async function getJob');
const GET_JOB_END = SRC.indexOf('\nasync function ', GET_JOB_START + 1);
const GET_JOB_FN = SRC.slice(
  GET_JOB_START,
  GET_JOB_END > GET_JOB_START ? GET_JOB_END : GET_JOB_START + 500,
);

describe('WS1 — PATCH /progress 返回 {"ok": true} [BEHAVIOR]', () => {
  it('updateProgress 函数返回 res.json({ ok: true })', () => {
    expect(UPDATE_PROGRESS_FN).toMatch(/res\.json\(\s*\{\s*ok\s*:\s*true\s*\}\s*\)/);
  });

  it('updateProgress 响应 keys 集合只有 ["ok"]（不含 id / status / job 字段）', () => {
    const match = UPDATE_PROGRESS_FN.match(/res\.json\(\s*(\{[^}]+\})\s*\)/);
    expect(match).not.toBeNull();
    const obj = match![1].replace(/\s/g, '');
    expect(obj).toBe('{ok:true}');
  });

  it('updateProgress 不含禁用字段名 aspectRatio / aspect: / ratio: / orientation', () => {
    const banned = ['aspectRatio', '"aspect"', '"ratio"', '"orientation"'];
    for (const k of banned) {
      expect(UPDATE_PROGRESS_FN).not.toContain(k);
    }
  });

  it('updateProgress 仍含 404 error path（错误处理未被破坏）', () => {
    expect(UPDATE_PROGRESS_FN).toContain('404');
    expect(UPDATE_PROGRESS_FN).toContain('error');
  });
});

describe('WS1 — GET /api/ai-video/:jobId 返回 {job:{...}} 包装 [BEHAVIOR]', () => {
  it('getJob 返回 res.json({ job: {...} }) 包装（不是 flat spread）', () => {
    // PRD GET Schema: {"job": {"id": "...", "detected_aspect": "9:16", "status": "..."}}
    expect(GET_JOB_FN).toMatch(/res\.json\(\s*\{\s*job\s*:/);
    // 不应含 spread operator（...job 会 flat 化所有 DB 列）
    expect(GET_JOB_FN).not.toMatch(/\.\.\.(job|updated)/);
  });

  it('getJob .job 块显式含 detected_aspect key（snake_case，符合 PRD GET schema）', () => {
    // PRD 禁用变体：detectedAspect（camelCase）
    expect(GET_JOB_FN).toMatch(/job\s*:\s*\{[\s\S]*?detected_aspect/);
    // 禁用 camelCase key
    expect(GET_JOB_FN).not.toMatch(/detectedAspect\s*:/);
  });
});
