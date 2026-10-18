import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), provision: vi.fn(), adapter: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../customer-workspace', () => ({ provisionWorkspace: mocks.provision }));
vi.mock('../customer-workspace-adapters', () => ({ createWorkspaceAdapter: mocks.adapter }));
import { provisionRegisteredWorkspace, startCustomerWorkspaceWorker } from '../customer-workspace-store';
beforeEach(() => { vi.clearAllMocks(); mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release }); delete process.env.NOTION_INTEGRATION_TOKEN; delete process.env.CUSTOMER_WORKSPACE_PROVISIONING_ENABLED; });
describe('外部开户并发与运行恢复', () => {
  it('别的worker占锁时完全不调用外部平台或建库器', async () => {
    mocks.query.mockResolvedValue({ rows: [{ locked: false }] });
    await provisionRegisteredWorkspace('company-a', 'notion');
    expect(mocks.adapter).not.toHaveBeenCalled(); expect(mocks.provision).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledWith(false);
  });
  it('已登记但缺平台凭据变为待核对，不能无限报pending', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : sql.includes('SELECT w.state') ? [{ state: { company_id: 'company-a', platform: 'notion' }, company_name: '甲' }] : [] }));
    await expect(provisionRegisteredWorkspace('company-a', 'notion')).rejects.toThrow('credential missing');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("status='needs_reconciliation'"))).toBe(true);
    expect(mocks.adapter).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledWith(false);
  });
  it('无法释放会话锁时销毁连接，不将持锁连接放回连接池', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) throw Error('connection lost');
      return { rows: sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [] };
    });
    await expect(provisionRegisteredWorkspace('company-a', 'notion')).rejects.toThrow('binding missing');
    expect(mocks.release).toHaveBeenCalledWith(true);
  });
  it('未显式启用时不注册定时器，不触发外部操作', () => {
    expect(startCustomerWorkspaceWorker()).toBeUndefined(); expect(mocks.connect).not.toHaveBeenCalled();
  });
});
