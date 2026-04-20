import request from 'supertest';
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const PIPELINE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
// 一张合法 PNG（8x8 透明，base64 → buffer）
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
  'base64'
);

let tmpRoot: string;
const IMAGE_NAME = '龙虾-cover.png';

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'content-images-test-'));
  // 在 cards/ 下放一张真实 PNG
  mkdirSync(join(tmpRoot, 'cards'), { recursive: true });
  writeFileSync(join(tmpRoot, 'cards', IMAGE_NAME), PNG_BYTES);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/content-images/:pipelineId/:filename', () => {
  it('should return image bytes (200 + image/png) when file exists in cards/', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ output_dir: tmpRoot }] });

    const encoded = encodeURIComponent(IMAGE_NAME);
    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/${encoded}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('max-age=86400');
    // 返回的 body 必须和写入的字节完全一致
    expect(Buffer.compare(response.body, PNG_BYTES)).toBe(0);
  });

  it('should return 400 when filename contains ..', async () => {
    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/..%2Fetc%2Fpasswd`);

    expect(response.status).toBe(400);
    // 路径穿越必须被拒，绝不能落到 DB 查询
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should return 400 when filename contains slash after decode', async () => {
    // %2F decode 成 /，会被 express 当成路径分隔符，所以此场景实际走到我们的 handler
    // 的 filename 会是完整编码；直接测编码后的 %2F
    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/sub%2Ffile.png`);

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should return 404 when pipeline does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // pipeline_runs lookup
      .mockResolvedValueOnce({ rows: [] });  // cecelia_events fallback (empty)

    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/any.png`);

    expect(response.status).toBe(404);
  });

  it('should return 404 when file not found in any candidate dir', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ output_dir: tmpRoot, cecelia_task_id: null }] })
      .mockResolvedValueOnce({ rows: [] });  // cecelia_events fallback (empty)

    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/does-not-exist.png`);

    expect(response.status).toBe(404);
  });

  it('should return 404 when pipeline has no output_dir', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ output_dir: null, cecelia_task_id: null }] })
      .mockResolvedValueOnce({ rows: [] });  // cecelia_events fallback (empty)

    const response = await request(app).get(`/api/content-images/${PIPELINE_ID}/anything.png`);

    expect(response.status).toBe(404);
  });
});
