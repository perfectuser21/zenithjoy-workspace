/**
 * judge-video 拒绝真实音频大小的请求体 — [REGRESSION]
 *
 * 2026-07-19 真机排查：音频转写判定的 RECORD_AUDIO 权限/WAV 封装修好（PR #1404）后，
 * 真机首次真实产出音频数据并 POST /judge-video，服务端全部报 500。docker logs 抓到真实
 * 原因：`PayloadTooLargeError: request entity too large`——`express.json()` 默认
 * body 上限只有 100KB（102400 bytes），而 20 秒 16kHz 单声道 16bit PCM 音频裸数据就有
 * 640000 字节，base64 编码后膨胀到约 853KB，随随便便超限 8 倍多。此前从未真被真机撞到，
 * 是因为在这次修复之前 RECORD_AUDIO 权限缺失 → 录音必现 SecurityException → 空数据
 * 直接标 skipped_capture_failed，请求体极小，从未真正测过大音频负载这条路径。
 *
 * commit-1 时 RED（不设置更大 limit，真实大小的请求体被 body-parser 拒绝 413/500）；
 * commit-2 GREEN（app.ts 的 express.json() 加大 limit）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';
import { testPool, createTestTenant } from '../helpers';

let tenantId: string;
let agentId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// 20 秒 16kHz 单声道 16bit PCM = 640000 字节，base64 后约 853KB —— 真机实测同量级负载。
const REALISTIC_AUDIO_BASE64_SIZE_BYTES = 640_000;
const fakeAudioBase64 = Buffer.alloc(REALISTIC_AUDIO_BASE64_SIZE_BYTES, 'A').toString('base64');

beforeAll(async () => {
  const tenant = await createTestTenant(`judge-video-large-payload-test-${RND}`);
  tenantId = tenant.id;

  const aRes = await testPool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, os_type, capabilities, last_heartbeat_at)
     VALUES ($1, $2, 'judge-video-large-payload-host', 'online', 'android', ARRAY['android'], NOW())
     RETURNING id`,
    [tenantId, `judge-video-large-payload-agent-${RND}`],
  );
  agentId = aRes.rows[0].id;
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_videos WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.agents WHERE id = $1', [agentId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('POST /judge-video 真实音频大小请求体 [REGRESSION]', () => {
  it('~850KB级别的音频data_b64不应被body-parser以413/500拒绝', async () => {
    const res = await request(app)
      .post('/api/acquisition/judge-video')
      .set('x-agent-id', `judge-video-large-payload-agent-${RND}`)
      .send({
        video_id: `large-payload-vid-${RND}`,
        capture_type: 'audio',
        data_b64: fakeAudioBase64,
        force_result: 'matched',
      });

    // 413(Payload Too Large)/500(body-parser内部错误) 都代表本次要修的问题复现；
    // 200 才代表请求体本身被正常接受（不代表Gemini真调，走了force_result测试钩子）。
    expect(res.status).not.toBe(413);
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    expect(res.body.data.judgment_status).toBe('matched');
  });
});
