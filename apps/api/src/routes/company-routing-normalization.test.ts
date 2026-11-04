import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), session: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: db.query, connect: db.connect } }));
vi.mock('../auth', () => ({ auth: { api: { getSession: db.session } } }));
import { companyProfileRouter } from './company-profile';
const app = express(); app.use(express.json()); app.use('/profile', companyProfileRouter);
const initial = () => ({ company_id: 'company-a', tenant_id: 'tenant-a', company_key: 'own', company_name: 'Own', config_version: 26, config_status: 'draft', config_owner: 'owner-a', wiki: { markdown: 'keep' }, source_evidence: { keep: true }, runtime_config: { routing: { line_key: 'yuesheng', profiles: ['work', 'work', 'work', 'other'], status: 'unverified', feishu_base: 'own-base' }, policy_id: 'original-policy', platform_accounts: [{ id: 'account-a', company_id: 'company-a', tenant_id: 'tenant-a', profile: 'work', device_serial: 'own-device', enabled: true, verification_status: 'verified' }] } });
let row = initial(), transaction = initial(), role = 'owner', tenant = 'tenant-a', failCas = false, failVersion = false;
let changes: Record<string, unknown>[] = [], versions: unknown[] = [], auditBefore: Record<string, unknown>[] = [], versionsBefore: unknown[] = [];
const body = () => ({ expected_version: 26, request_id: '11111111-1111-4111-8111-111111111111' });
const post = (value: unknown = body()) => request(app).post('/profile/routing-profile-normalizations').send(value);
beforeEach(() => {
  vi.clearAllMocks(); row = initial(); role = 'owner'; tenant = 'tenant-a'; failCas = false; failVersion = false; changes = []; versions = [];
  db.session.mockResolvedValue({ user: { id: 'actor-a' } });
  db.connect.mockResolvedValue({ query: db.query, release: db.release });
  db.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM zenithjoy.tenant_members')) return { rows: [{ tenant_id: tenant, role }] };
    if (sql === 'BEGIN') { transaction = structuredClone(row); auditBefore = structuredClone(changes); versionsBefore = structuredClone(versions); return { rows: [] }; }
    if (sql === 'ROLLBACK') { row = transaction; changes = auditBefore; versions = versionsBefore; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('SELECT * FROM zenithjoy.tenant_company_profiles')) return { rows: args[0] === row.tenant_id ? [structuredClone(row)] : [] };
    if (sql.includes('FROM zenithjoy.company_config_changes')) return { rows: changes.filter(c => c.company_id === args[0] && (c.conflict as Record<string, unknown>).request_id === args[1]) };
    if (sql.startsWith('UPDATE zenithjoy.tenant_company_profiles')) {
      if (failCas) return { rows: [], rowCount: 0 };
      expect(args.slice(3)).toEqual(['company-a', 'tenant-a', 26]);
      row.runtime_config = JSON.parse(String(args[0])); row.config_status = String(args[1]); row.config_version = Number(args[2]); return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO zenithjoy.company_config_versions')) { if (failVersion) throw Error('fixture version write failed'); versions.push(JSON.parse(String(args[3]))); return { rows: [] }; }
    if (sql.includes('INSERT INTO zenithjoy.company_config_changes')) { changes.push({ company_id: args[0], version: args[1], actor: args[2], old_snapshot: JSON.parse(String(args[3])), new_snapshot: JSON.parse(String(args[4])), conflict: JSON.parse(String(args[5])) }); return { rows: [] }; }
    if (sql.includes('company_config_projections')) return { rows: [] };
    throw Error('unexpected SQL fixture');
  });
});

describe('公司Profile精确重复映射修复的真实HTTP入口', () => {
  it('保序消除完全相同profile，保存draft新版本，其他账号策略和旧快照不变', async () => {
    const old = structuredClone(row); const r = await post(); expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(row.runtime_config.routing.profiles).toEqual(['work', 'other']); expect(row.config_status).toBe('draft'); expect(row.config_version).toBe(27);
    expect({ ...row, runtime_config: { ...row.runtime_config, routing: old.runtime_config.routing }, config_status: old.config_status, config_version: old.config_version }).toEqual(old);
    expect(versions).toHaveLength(1); expect(changes).toHaveLength(1); expect(changes[0].actor).toBe('actor-a');
    expect((changes[0].old_snapshot as Record<string, unknown>).runtime_config).toEqual(old.runtime_config);
    expect(db.query.mock.calls.some(([sql]) => /UPDATE.*company_config_(runs|versions)/.test(String(sql)))).toBe(false);
    const read = await request(app).get('/profile/routing-profile-normalizations/' + body().request_id); expect(read.status).toBe(200); expect(read.body.data.config_version).toBe(27);
  });
  it('同request失去ACK后可读回或原样重试，只创建一个新版本', async () => {
    expect((await post()).status).toBe(201); const r = await post(); expect(r.status).toBe(200); expect(r.body.data.idempotent).toBe(true); expect(versions).toHaveLength(1); expect(row.config_version).toBe(27);
  });
  it('同request更换版本拒绝，不能复用旧回执', async () => { await post(); expect((await post({ ...body(), expected_version: 27 })).status).toBe(409); expect(versions).toHaveLength(1); });
  it('旧版本拒绝且不写新版本', async () => { expect((await post({ ...body(), expected_version: 25 })).status).toBe(409); expect(versions).toHaveLength(0); });
  it('已启用配置必须先经普通流程另存draft，不可隐式停用', async () => { row.config_status = 'enabled'; const r = await post(); expect(r.status).toBe(409); expect(r.body.error.code).toBe('DRAFT_REQUIRED'); expect(row.config_status).toBe('enabled'); expect(versions).toHaveLength(0); });
  it('无重复不得创建无意义版本', async () => { row.runtime_config.routing.profiles = ['work', 'other']; expect((await post()).status).toBe(409); expect(row.config_version).toBe(26); });
  it.each(['profiles', 'profile', 'tenant_id', 'runtime_config', 'config_status', 'operation'])('拒绝输入越权字段%s', async key => { expect((await post({ ...body(), [key]: ['foreign'] })).status).toBe(400); expect(db.connect).not.toHaveBeenCalled(); });
  it.each([[], ['work', ' work'], ['work', 'WORK'], ['work', ''], ['work', null], ['work', ['work']]])('不把畸形或大小写trim变体当可修重复：%j', async profiles => { row.runtime_config.routing.profiles = profiles as string[]; expect((await post()).status).toBe(409); expect(versions).toHaveLength(0); });
  it('无真实session的header冒owner拒绝，不能走tenant fallback或bypass', async () => { db.session.mockResolvedValue(null); const r = await post().set('X-Feishu-User-Id', 'actor-a').set('X-Bypass-Tenant', 'true'); expect(r.status).toBe(401); expect(db.connect).not.toHaveBeenCalled(); });
  it('session在两层校验间失效时拒绝fallback', async () => { db.session.mockResolvedValueOnce({ user: { id: 'actor-a' } }).mockResolvedValue(null); expect((await post().set('X-Feishu-User-Id', 'actor-a')).status).toBe(401); expect(db.connect).not.toHaveBeenCalled(); });
  it('两层session主体不一致拒绝', async () => { db.session.mockResolvedValueOnce({ user: { id: 'actor-a' } }).mockResolvedValue({ user: { id: 'actor-b' } }); expect((await post()).status).toBe(403); expect(db.connect).not.toHaveBeenCalled(); });
  it('普通member拒绝', async () => { role = 'member'; expect((await post()).status).toBe(403); expect(db.connect).not.toHaveBeenCalled(); });
  it('admin可执行但不越租户', async () => { role = 'admin'; expect((await post()).status).toBe(201); tenant = 'tenant-b'; expect((await post()).status).toBe(404); expect(row.tenant_id).toBe('tenant-a'); });
  it('跨站Origin或无Origin跨站请求均拒绝', async () => { expect((await post().set('Origin', 'https://foreign.example')).status).toBe(403); expect((await post().set('Sec-Fetch-Site', 'cross-site')).status).toBe(403); expect(db.connect).not.toHaveBeenCalled(); });
  it('CAS失败或版本快照失败完整回滚，不能返回成功', async () => {
    failCas = true; expect((await post()).status).toBe(409); expect(row).toEqual(initial());
    failCas = false; failVersion = true; expect((await post()).status).toBe(500); expect(row).toEqual(initial()); expect(versions).toHaveLength(0); expect(changes).toHaveLength(0);
  });
  it('未知request只读返回404，不触发修复', async () => { const r = await request(app).get('/profile/routing-profile-normalizations/' + body().request_id); expect(r.status).toBe(404); expect(versions).toHaveLength(0); });
  it('普通PUT仍然拒绝修改routing身份', async () => { row.config_status = 'draft'; const runtime = structuredClone(row.runtime_config); runtime.routing.profiles = ['work', 'other']; const r = await request(app).put('/profile').send({ expected_version: 26, runtime_config: runtime }); expect(r.status).toBe(400); expect(r.body.error.code).toBe('IMMUTABLE_COMPANY_BINDING'); });
});
