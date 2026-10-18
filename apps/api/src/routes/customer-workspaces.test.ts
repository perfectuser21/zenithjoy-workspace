import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: mocks.query, connect: mocks.connect } }));
import { customerWorkspacesRouter } from './customer-workspaces';
const app = express(); app.use(express.json()); app.use('/workspaces', customerWorkspacesRouter);
const company = '11111111-1111-4111-8111-111111111111', tenant = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { vi.clearAllMocks(); process.env.ZENITHJOY_INTERNAL_TOKEN = 'test-service'; mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release }); mocks.query.mockResolvedValue({ rows: [], rowCount: 0 }); });
describe('客户工作台内部开户边界', () => {
  it('缺服务token配置失败关闭，任意身份头均无效', async () => {
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    const result = await request(app).get('/workspaces/template').set('x-user-email', 'owner@example.com');
    expect(result.status).toBe(503); expect(mocks.query).not.toHaveBeenCalled();
  });
  it('自报租户和管理员不能取得管理权限', async () => {
    expect((await request(app).get('/workspaces/template').set('x-tenant-id', tenant).set('x-feishu-user-id', 'owner')).status).toBe(401);
  });
  it('有服务凭证才能读取16对象模板', async () => {
    const result = await request(app).get('/workspaces/template?module=leadgen').set('x-internal-token', 'test-service');
    expect(result.status).toBe(200); expect(result.body.data.objects).toHaveLength(16);
  });
  it('绑定必须明确批准parent，不触发隐含授权', async () => {
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', tenant_id: tenant });
    expect(result.status).toBe(400); expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('数据库公司与租户不匹配不登记外部目标', async () => {
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', tenant_id: tenant, approved_parent: true });
    expect(result.status).toBe(404); expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });
  it('连库失败返回503，不遗留未处理异步异常', async () => {
    mocks.connect.mockRejectedValue(Error('offline'));
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', tenant_id: tenant, approved_parent: true });
    expect(result.status).toBe(503);
  });
  it('合法绑定幂等返回已存状态，不把登记当成同步成功', async () => {
    const state = { company_id: company, tenant_id: tenant, platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', modules: ['leadgen'], template_version: 1, status: 'pending', resources: {}, data_sync_status: 'not_connected' };
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT company_id,tenant_id,company_name') ? [{ company_id: company, tenant_id: tenant, company_name: '甲' }] : sql.includes('SELECT state') ? [{ state }] : [] }));
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', tenant_id: tenant, modules: ['leadgen'], approved_parent: true });
    expect(result.status).toBe(202); expect(result.body.data.object_count).toBe(16); expect(result.body.data.data_sync_status).toBe('not_connected');
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('customer_workspace_events'))).toBe(true);
  });
  it('同公司重放不能改写既有parent', async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('SELECT company_id,tenant_id,company_name') ? [{ company_id: company, tenant_id: tenant, company_name: '甲' }] : sql.includes('SELECT state') ? [{ state: { parent_id: 'foreign-parent', modules: [], template_version: 1 } }] : [] }));
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', tenant_id: tenant, approved_parent: true });
    expect(result.status).toBe(409); expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('COMMIT'))).toBe(false);
  });
  it('凭据引用不能指向任意服务环境变量或另一个平台', async () => {
    const result = await request(app).post(`/workspaces/${company}/bind`).set('x-internal-token', 'test-service').send({ platform: 'notion', parent_id: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', tenant_id: tenant, approved_parent: true, credential_ref: 'ZENITHJOY_INTERNAL_TOKEN' });
    expect(result.status).toBe(400); expect(mocks.connect).not.toHaveBeenCalled();
  });
});
