import express from 'express';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createVideoToolsRouter } from '../../routes/video-tools';
import { AliVideoProvider, type WanVideoInput } from '../ali-video-provider';

vi.mock('../../auth', () => ({ auth: { api: { getSession: async ({ headers }: { headers: Headers }) => {
  const id = headers.get('cookie')?.match(/user=([^;]+)/)?.[1];
  return id ? { user: { id, email: `${id}@example.com` } } : null;
} } } }));

let directory: string;
const submit = vi.fn<(input: WanVideoInput) => Promise<{taskId: string}>>(async () => ({ taskId: 'paid-task' }));
const signed = vi.fn(async (key: string) => `https://test.cos.ap-guangzhou.myqcloud.com/${key}?renewed=yes`);
function app() {
  const server = express(); server.use(express.json());
  server.use('/api/video-tools', createVideoToolsRouter({ directory,
    storage: { getSignedUrl: signed } as never,
    provider: { getConfiguration: () => ({ wan: { configured: true }, upscale: { configured: true } }),
      submitWan: submit, fetchTask: async () => ({ status: 'succeeded', videoUrl: 'https://result.example.com/video.mp4' }),
      downloadResult: async () => new Response('generated-result') } as never }));
  return server;
}
async function asset(kind: 'image' | 'video', owner = 'alice', age = 0) {
  const id = randomUUID(), folder = join(directory, createHash('sha256').update(owner).digest('hex'), 'assets');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${id}.json`), JSON.stringify({ id, kind, name: kind === 'video' ? 'original.mov' : 'reference.png',
    url: `https://test.cos.ap-guangzhou.myqcloud.com/old/${id}`, width: 720, height: 1280, size: 1024,
    duration: kind === 'video' ? 10 : 0, fps: 30, createdAt: new Date(Date.now() - age).toISOString() }));
  return id;
}
const post = (server: ReturnType<typeof app>, remake: object, clientRequestId = 'remake-request-0001') => request(server)
  .post('/api/video-tools/jobs').set('Cookie', 'user=alice').send({ kind: 'wan', clientRequestId, remake });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wan-remake-')); submit.mockClear(); signed.mockClear();
  vi.stubEnv('STAFF_EMAILS', 'alice@example.com,bob@example.com');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

it('canvas workflow compiles selected edits, preserves image numbering and downloads only the generated result', async () => {
  const server = app();
  const remake = { referenceAssetId: await asset('video'), productMode: 'replace', productAssetId: await asset('image'),
    productDescription: '黑白厚手套', background: true, backgroundAssetId: await asset('image'),
    face: true, facePresence: 'present', faceAssetId: await asset('image') };
  const result = await post(server, remake);
  expect(result.status, JSON.stringify(result.body)).toBe(202);
  const input = submit.mock.calls[0][0];
  expect(input).toMatchObject({ duration: -1, ratio: 'adaptive', audio: false, promptExtend: false });
  expect(input.prompt).toContain('编辑视频1');
  expect(input.prompt).toContain('图片1'); expect(input.prompt).toContain('图片2'); expect(input.prompt).toContain('图片3');
  expect(input.media?.map(m => m.type)).toEqual(['reference_video', 'reference_image', 'reference_image', 'reference_image']);
  expect(result.body.remake).toMatchObject(remake);
  const completed = await request(app()).get(`/api/video-tools/jobs/${result.body.id}`).set('Cookie', 'user=alice');
  expect(completed.body.status).toBe('succeeded');
  const download = await request(app()).get(`/api/video-tools/jobs/${result.body.id}/download`).set('Cookie', 'user=alice');
  expect(download.status).toBe(200); expect(Buffer.from(download.body).toString()).toBe('generated-result');
  expect((await request(server).get(`/api/video-tools/jobs/${result.body.id}`).set('Cookie', 'user=bob')).status).toBe(404);
});

it('background-only preserves the product and face, never includes unselected product/face images', async () => {
  const result = await post(app(), { referenceAssetId: await asset('video'), productMode: 'keep',
    background: true, backgroundDescription: '冬日公园', face: false, productAssetId: randomUUID(), faceAssetId: randomUUID() });
  expect(result.status).toBe(202);
  expect(submit.mock.calls[0][0].media).toHaveLength(1);
  expect(submit.mock.calls[0][0].prompt).toContain('产品的款式、颜色、Logo');
  expect(submit.mock.calls[0][0].prompt).toContain('人物面部保持原样');
});

it.each(['color', 'logo'])('isolates product %s edits from shape, scene and face', async productMode => {
  const result = await post(app(), { referenceAssetId: await asset('video'), productMode, productAssetId: await asset('image'),
    productDescription: '手套', targetColor: '黑色', background: false, face: false });
  expect(result.status).toBe(202);
  const { prompt } = submit.mock.calls[0][0];
  expect(prompt).toContain(productMode === 'color' ? '只修改' : '只替换');
  expect(prompt).toContain('背景保持原样');
  expect(prompt).toContain('人物面部保持原样');
});

it('color-only works from the original video and target color without requiring a replacement photo', async () => {
  const result = await post(app(), {referenceAssetId: await asset('video'), productMode:'color', targetColor:'深蓝色', background:false, face:false});
  expect(result.status).toBe(202);
  expect(submit.mock.calls[0][0].media).toHaveLength(1);
  expect(submit.mock.calls[0][0].prompt).toContain('深蓝色');
  expect(submit.mock.calls[0][0].prompt).not.toContain('图片');
});

it('deduplicates simultaneous clicks in one mounted router and a later retry after restart', async () => {
  const remake = { referenceAssetId: await asset('video', 'alice', 2 * 86400000), productMode: 'keep',
    background: true, backgroundDescription: '雪地', face: false };
  const server = app(); const results = await Promise.all([1, 2].map(() => post(server, remake)));
  expect(results.map(r => r.status)).toEqual([202, 202]); expect(results[0].body.id).toBe(results[1].body.id);
  expect(submit).toHaveBeenCalledTimes(1);
  expect(signed.mock.calls[0][0]).toMatch(/original|\.mov$/);
  const retry = await post(app(), remake); expect(retry.body.id).toBe(results[0].body.id);
  expect(submit).toHaveBeenCalledTimes(1);
  expect((await post(server, { ...remake, backgroundDescription: '海边' })).status).toBe(409);
});

it.each(['foreign-video', 'wrong-kind', 'no-edits', 'missing-product', 'missing-color', 'unknown-face', 'missing-face', 'absent-face-only'])('rejects %s before submitting to the paid provider', async scenario => {
  const source = await asset('video');
  const body: Record<string, unknown> = { referenceAssetId: source, productMode: 'keep', background: true, backgroundDescription: '雪地', face: false };
  if (scenario === 'foreign-video') body.referenceAssetId = await asset('video', 'bob');
  if (scenario === 'wrong-kind') body.referenceAssetId = await asset('image');
  if (scenario === 'no-edits') body.background = false;
  if (scenario === 'missing-product') body.productMode = 'replace';
  if (scenario === 'missing-color') { body.productMode = 'color'; body.productAssetId = await asset('image'); }
  if (scenario === 'unknown-face') { body.face = true; body.facePresence = 'unknown'; }
  if (scenario === 'missing-face') { body.face = true; body.facePresence = 'present'; }
  if (scenario === 'absent-face-only') { body.background = false; body.face = true; body.facePresence = 'absent'; }
  expect((await post(app(), body)).status).toBe(400); expect(submit).not.toHaveBeenCalled();
});

it('skips the face operation explicitly when the source has no face and another edit is selected', async () => {
  const result = await post(app(), { referenceAssetId: await asset('video'), productMode: 'keep', background: true,
    backgroundDescription: '公园', face: true, facePresence: 'absent' });
  expect(result.status).toBe(202); expect(submit.mock.calls[0][0].media).toHaveLength(1);
  expect(submit.mock.calls[0][0].prompt).toContain('未露脸');
});

it('sends literal preservation settings to the fixed Wan 3.0 provider', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ output: { task_id: 'editing' } })));
  const provider = new AliVideoProvider({ env: { DASHSCOPE_API_KEY: 'test-only' }, fetch: transport });
  await provider.submitWan({ prompt: '编辑视频1，只换背景', duration: -1, ratio: 'adaptive', audio: false, promptExtend: false } as WanVideoInput);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({ model: 'wan3.0-video',
    parameters: { duration: -1, ratio: 'adaptive', audio: false, prompt_extend: false } });
});
