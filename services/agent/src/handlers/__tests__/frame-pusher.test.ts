// services/agent/src/handlers/__tests__/frame-pusher.test.ts
//
// 桌面帧上墙推送（件3 的 Node 侧）。与安卓端 FramePushLoop 同一套契约：
// POST /api/workers/<agentUuid>/frame + X-Agent-License + image/jpeg 原始字节。
//
// 重点在四种「不发出去」：未配置 / 帧过大 / 上一帧还在途 / 凭据被拒后退避。
// 桌面机网络可能比手机还差，8fps 下一旦没有在途合并，慢链路会攒出无界队列。

import { describe, it, expect, vi } from 'vitest';
import { FramePusher, MAX_FRAME_BYTES, REJECTED_BACKOFF_MS } from '../frame-pusher';

const UUID = '55f42f1e-9966-414d-9fab-475aa69d1396';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);

function okFetch(status = 202) {
  return vi.fn(async () => new Response(null, { status }));
}

function makePusher(over: Partial<ConstructorParameters<typeof FramePusher>[0]> = {}) {
  return new FramePusher({
    apiBase: 'https://api.example.com',
    license: 'ZJ-F-A1B2C3D4',
    agentUuid: UUID,
    fetchImpl: okFetch() as unknown as typeof fetch,
    ...over,
  });
}

describe('FramePusher', () => {
  it('推到 /api/workers/<uuid>/frame，带 X-Agent-License 与 image/jpeg 原始字节', async () => {
    const fetchImpl = okFetch();
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await p.push(jpeg)).toBe('pushed');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.example.com/api/workers/${UUID}/frame`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Agent-License']).toBe('ZJ-F-A1B2C3D4');
    expect(headers['Content-Type']).toBe('image/jpeg');
    expect(Buffer.from(init.body as Uint8Array).equals(jpeg)).toBe(true);
  });

  it('agentUuid 不是 uuid 时不发 —— 服务端只会 400', async () => {
    const fetchImpl = okFetch();
    const p = makePusher({ agentUuid: 'xian-rog-agent', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await p.push(jpeg)).toBe('skipped_not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('license 为空时不发', async () => {
    const fetchImpl = okFetch();
    const p = makePusher({ license: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await p.push(jpeg)).toBe('skipped_not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('帧超上限时本地丢，不去换服务端一个 413', async () => {
    const fetchImpl = okFetch();
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await p.push(Buffer.alloc(MAX_FRAME_BYTES + 1))).toBe('skipped_too_large');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(MAX_FRAME_BYTES).toBeLessThan(120 * 1024);
  });

  it('上一帧还在途时丢掉新帧 —— 慢链路不能攒无界队列', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchImpl = vi.fn(async () => { await gate; return new Response(null, { status: 202 }); });
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const first = p.push(jpeg);
    expect(await p.push(jpeg)).toBe('skipped_in_flight');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe('pushed');
    // 在途结束后恢复正常推送
    expect(await p.push(jpeg)).toBe('pushed');
  });

  it.each([401, 403])('%i 归 rejected —— 凭据/租户问题，重试无用', async (status) => {
    const p = makePusher({ fetchImpl: okFetch(status) as unknown as typeof fetch });
    expect(await p.push(jpeg)).toBe('rejected');
  });

  it('被拒后退避期内不再发，退避过了才恢复', async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));
    const p = makePusher({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    expect(await p.push(jpeg)).toBe('rejected');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += REJECTED_BACKOFF_MS - 1;
    expect(await p.push(jpeg)).toBe('skipped_backoff');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2;
    await p.push(jpeg);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('500 归 failed，不当成凭据问题去退避', async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => now });

    expect(await p.push(jpeg)).toBe('failed');
    now += 10;
    expect(await p.push(jpeg)).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('网络异常归 failed，绝不抛进事件循环', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(p.push(jpeg)).resolves.toBe('failed');
  });

  it('空帧不发', async () => {
    const fetchImpl = okFetch();
    const p = makePusher({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await p.push(Buffer.alloc(0))).toBe('skipped_no_frame');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
