/**
 * credit-charge 中间件单元测试 — PR-C
 *
 * 覆盖：
 *   - 余额够 → consume 成功 + next() 调用
 *   - 余额不够 → 402 + INSUFFICIENT_CREDITS + 不调 next
 *   - tenantId 缺失 → 500
 *   - reasonKey 在 CREDIT_COSTS 中查得到对应单价
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCreditCharger } from '../../src/middleware/credit-charge';
import * as creditsService from '../../src/services/credits.service';

vi.mock('../../src/services/credits.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/credits.service')>(
    '../../src/services/credits.service'
  );
  return {
    ...actual,
    consume: vi.fn(),
  };
});

const mockConsume = creditsService.consume as ReturnType<typeof vi.fn>;

function makeReq(tenantId?: string): any {
  return { tenantId };
}
function makeRes(): any {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('middleware/credit-charge', () => {
  it('导出 createCreditCharger 工厂', () => {
    expect(typeof createCreditCharger).toBe('function');
  });

  it('余额够 → 调 consume(tenantId, COSTS[reason], reason) + next()', async () => {
    mockConsume.mockResolvedValueOnce({
      balance: 95,
      total_recharged: 100,
      total_consumed: 5,
    });
    const charger = createCreditCharger('ai_writing');
    const req = makeReq('t-1');
    const res = makeRes();
    const next = vi.fn();
    await charger(req, res, next);
    expect(mockConsume).toHaveBeenCalledWith(
      't-1',
      creditsService.CREDIT_COSTS.ai_writing,
      'ai_writing',
      undefined
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('余额不足 → 402 + INSUFFICIENT_CREDITS payload', async () => {
    mockConsume.mockRejectedValueOnce(
      new creditsService.InsufficientCreditsError(10, 3)
    );
    const charger = createCreditCharger('competitor_research');
    const req = makeReq('t-1');
    const res = makeRes();
    const next = vi.fn();
    await charger(req, res, next);
    expect(res.status).toHaveBeenCalledWith(402);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(body.error.required).toBe(10);
    expect(body.error.current).toBe(3);
    expect(next).not.toHaveBeenCalled();
  });

  it('tenantId 缺失 → 500 NO_TENANT_CONTEXT（中间件应在 tenantContext 之后）', async () => {
    const charger = createCreditCharger('ai_writing');
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();
    await charger(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('NO_TENANT_CONTEXT');
    expect(next).not.toHaveBeenCalled();
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('其他错误（DB 故障等） → 500 CREDITS_INTERNAL_ERROR', async () => {
    mockConsume.mockRejectedValueOnce(new Error('db down'));
    const charger = createCreditCharger('ai_writing');
    const req = makeReq('t-1');
    const res = makeRes();
    const next = vi.fn();
    await charger(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.code).toBe('CREDITS_INTERNAL_ERROR');
  });
});
