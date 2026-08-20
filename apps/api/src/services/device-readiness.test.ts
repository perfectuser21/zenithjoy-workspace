import { describe, expect, it } from 'vitest';
import {
  computeReadinessVerdict,
  isDispatchable,
  normalizeDeviceReadiness,
} from './device-readiness';

/**
 * 设备就绪度：客服要能看到「这台客户手机准备好了没有，没好是卡在哪一项」。
 *
 * 判定点（决策 3a826c45，主理人 2026-08-20 拍板）：**拿不到 readiness 时照派（fail-open）**。
 * 只有设备明确上报「未就绪」才拦。理由：新字段上线初期机队里新旧版本共存，
 * fail-closed 会把一堆正常设备全停掉；现状本来就是全部照派，fail-open 不会更差。
 * 反向的误判后果更重——readiness 链路一旦有 bug，整个机队被判死且无逃生口
 * （对照 0819 acquisition-dispatch.ts:534 风控 fail-open 教训）。
 *
 * 因此判定是**三态**：ready / not_ready / unknown，只有 not_ready 才挡派单。
 */
describe('normalizeDeviceReadiness — 客户端上报内容归一 [BEHAVIOR]', () => {
  it('合法结构原样保留', () => {
    expect(normalizeDeviceReadiness({ accessibility: { ok: true } })).toEqual({
      accessibility: { ok: true },
    });
  });

  it('detail 保留并截断，防客户端塞超长串把库撑爆', () => {
    const long = 'x'.repeat(900);
    const out = normalizeDeviceReadiness({ accessibility: { ok: false, detail: long } });
    expect(out!.accessibility.ok).toBe(false);
    expect(out!.accessibility.detail!.length).toBeLessThanOrEqual(500);
  });

  it('ok 不是布尔的条目整条丢弃，不猜', () => {
    expect(normalizeDeviceReadiness({ a: { ok: 'true' }, b: { ok: false } })).toEqual({
      b: { ok: false },
    });
  });

  it('非对象 / 数组 / null 一律返回 null（表示无可持久化内容）', () => {
    for (const bad of [null, undefined, 'x', 42, [], [{ ok: true }]]) {
      expect(normalizeDeviceReadiness(bad)).toBeNull();
    }
  });

  it('全部条目非法 → null，不写半个空对象进库', () => {
    expect(normalizeDeviceReadiness({ a: 1, b: 'x' })).toBeNull();
  });
});

describe('computeReadinessVerdict — 三态判定 [BEHAVIOR]', () => {
  it('设备没上报 readiness → unknown（不是 not_ready）', () => {
    expect(computeReadinessVerdict({ deviceItems: null, licenseBound: null })).toBe('unknown');
  });

  it('全部条目 ok 且 license 已绑 → ready', () => {
    expect(
      computeReadinessVerdict({
        deviceItems: { accessibility: { ok: true }, screen_capture: { ok: true } },
        licenseBound: true,
      }),
    ).toBe('ready');
  });

  it('任一条目 ok=false → not_ready', () => {
    expect(
      computeReadinessVerdict({
        deviceItems: { accessibility: { ok: false, detail: '被 .e2e 包拿走了' }, screen_capture: { ok: true } },
        licenseBound: true,
      }),
    ).toBe('not_ready');
  });

  // 小白此刻正在发生：每 26 秒被中台拒一次「license 配额已满(1/1)」，license_machines 绑不上。
  // 设备端不知道自己被拒了——只有服务端知道，所以总判定必须由服务端合成。
  it('服务端确知 license 没绑上 → not_ready，哪怕设备端自报一切 ok', () => {
    expect(
      computeReadinessVerdict({
        deviceItems: { accessibility: { ok: true } },
        licenseBound: false,
      }),
    ).toBe('not_ready');
  });

  it('license 绑定状态查不到（null）不算坏消息——不因此判死', () => {
    expect(
      computeReadinessVerdict({ deviceItems: { accessibility: { ok: true } }, licenseBound: null }),
    ).toBe('ready');
  });

  it('license 查不到 且 设备没上报 → 仍是 unknown', () => {
    expect(computeReadinessVerdict({ deviceItems: null, licenseBound: null })).toBe('unknown');
  });

  it('license 明确没绑 且 设备没上报 → not_ready（服务端确知的坏消息压过未知）', () => {
    expect(computeReadinessVerdict({ deviceItems: null, licenseBound: false })).toBe('not_ready');
  });

  it('空 map（设备上报了但一项都没有）→ unknown，不当成 ready', () => {
    expect(computeReadinessVerdict({ deviceItems: {}, licenseBound: true })).toBe('unknown');
  });
});

describe('isDispatchable — fail-open 闸（决策 3a826c45）[REGRESSION]', () => {
  it('只有 not_ready 挡派单，unknown 照派', () => {
    expect(isDispatchable('ready')).toBe(true);
    expect(isDispatchable('unknown')).toBe(true);
    expect(isDispatchable('not_ready')).toBe(false);
  });

  it('unknown 必须照派——改成 fail-closed 会把新字段上线初期的旧版本机队全停掉', () => {
    expect(isDispatchable('unknown')).toBe(true);
  });
});
