// modules/line04/__tests__/report-health-once.test.ts
//
// 审查发现 #4：reportHealthOnce（index.ts）里 `process.platform === 'win32' ? ... : undefined`
// 的三元分支此前零测试覆盖——既有测试只覆盖了 buildHealthStatusMessage/collectListenerHealth
// 这两个更底层的纯函数，从没人直接调用过 reportHealthOnce 本体验证 overlay 字段是否真的
// 只在 win32 上被读取并透传（非 win32 必须是 undefined，不能漏传/误传）。
//
// getOverlayHandler 是模块内单例工厂：不引入 vi.mock 重型方案，改为拿到真实单例实例后
// 直接 vi.spyOn 其 getStatus() 方法（getStatus 本身只读一个内部字段，spy 成本极低），
// 跟随仓库既有 Object.defineProperty(process, 'platform', ...) mock 风格
// （见 modules/line04/__tests__/preflight.test.ts）。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportHealthOnce } from '../index';
import { getOverlayHandler, _resetOverlayHandlerForTest } from '../handlers/overlay';

describe('reportHealthOnce — win32 三元分支覆盖（overlay 是否随健康消息一起上报）', () => {
  const origPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    _resetOverlayHandlerForTest();
    vi.restoreAllMocks();
  });

  it('win32 → 消息带 overlay 字段（取自 getOverlayHandler().getStatus()）', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    // 预先拿到单例实例并 spy 其 getStatus，reportHealthOnce 内部再调 getOverlayHandler(...)
    // 拿到的是同一实例（工厂只认第一次调用，后续参数被忽略）。
    const handler = getOverlayHandler('C:\\Users\\Public', '1.0.0');
    vi.spyOn(handler, 'getStatus').mockReturnValue({ ok: false, reason: 'pywebview_missing' });

    const sent: unknown[] = [];
    reportHealthOnce((m) => sent.push(m));

    expect(sent).toHaveLength(1);
    const msg = sent[0] as { overlay?: { ok: boolean; reason?: string } };
    expect(msg.overlay).toEqual({ ok: false, reason: 'pywebview_missing' });
  });

  it('非 win32 → 消息不带 overlay 字段（undefined，不读取 getOverlayHandler）', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const sent: unknown[] = [];
    reportHealthOnce((m) => sent.push(m));

    expect(sent).toHaveLength(1);
    const msg = sent[0] as { overlay?: unknown };
    expect(msg.overlay).toBeUndefined();
  });
});
