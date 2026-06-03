import { describe, it, expect, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe('daily-crm-analysis — Path 4 Step 2', () => {
  it('dry_run=true 时 webhook_sent=false', async () => {
    const { runDailyCrmAnalysis } = await import('../daily-crm-analysis');
    const result = await runDailyCrmAnalysis({ tenant_id: 'test_tenant', dry_run: true });
    expect(result.webhook_sent).toBe(false);
    expect(Array.isArray(result.customers)).toBe(true);
    expect(typeof result.analysis_time).toBe('string');
  });

  it('返回 DailyAnalysisResult 结构', async () => {
    const { runDailyCrmAnalysis } = await import('../daily-crm-analysis');
    const result = await runDailyCrmAnalysis({ tenant_id: 'test_tenant', dry_run: true });
    expect(result).toHaveProperty('customers');
    expect(result).toHaveProperty('webhook_sent');
    expect(result).toHaveProperty('analysis_time');
  });
});
