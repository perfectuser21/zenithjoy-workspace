import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), session: vi.fn() }));
vi.mock('../auth', () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock('../db/connection', () => ({ default: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../middleware/tenant-context', () => ({ tenantContext: (req: Request, _res: Response, next: NextFunction) => {
  req.tenantId = req.header('x-test-tenant'); req.tenantRole = req.header('x-test-role') ?? 'owner';
  req.feishuUserId = 'authenticated-owner'; next();
} }));
import { companyProfileRouter } from './company-profile';
type Row = Record<string, any>;
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD_REQUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/profile', companyProfileRouter);
const initial = (): Row => ({
  company_id: 'company-a', tenant_id: 'tenant-a', company_name: '客户A', config_owner: 'owner',
  config_status: 'enabled', config_version: 29, wiki: { markdown: '# 原政策', products: [{ id: 'p1', name: '原产品' }] },
  runtime_config: { policy_id: 'policy-original', comment_scoring: { criteria: { A: '原规则' } },
    routing: { line_key: 'line-a', profiles: ['physical'], feishu_base: 'base-a' }, platform_accounts: [{
      id: ACCOUNT, company_id: 'company-a', tenant_id: 'tenant-a', platform: 'douyin', douyin_id: '90915521618', nickname: 'Ai办公室',
      profile: 'physical', device_serial: 'physical-serial', device_id: 'physical-serial', device_host: 'xian-m4',
      enabled: true, verification_status: 'verified', verification_source: { capture_task_id: 'old-capture', validation_task_id: 'old-validation' },
      source: { kind: 'tenant_owner_registration', platform: 'douyin', registration_request_id: OLD_REQUEST,
        registration_fingerprint: 'a'.repeat(64), registered_at: '2026-11-01T00:00:00Z', device_host: 'xian-m4', device_instance_id: 'physical-serial' },
      fields: { 手机Profile: 'physical', ADB序列号: 'physical-serial', 绑定机器: 'xian-m4', 抖音号: '90915521618', 备注: '须保留' },
    }] },
});
const input = () => ({ expected_version: 29, account_id: ACCOUNT, request_id: '11111111-1111-4111-8111-111111111111',
  ownership_decision_id: '22222222-2222-4222-8222-222222222222',
  device: { profile: 'android14', device_serial: 'B114E2190975', device_instance_id: 'acp-android14', device_host: 'mmv' },
  evidence_refs: [{ uri: '/evidence/profile.xml', sha256: 'b'.repeat(64) }],
});
let row: Row, foreign: Row[], history: Row[], checkpoint: { row: Row; history: Row[] } | null;
let failCas = false, failSnapshot = false, clientIp = 0;
beforeEach(() => {
  vi.clearAllMocks(); clientIp++; row = initial(); foreign = []; history = []; checkpoint = null; failCas = false; failSnapshot = false;
  mocks.session.mockResolvedValue({ user: { id: 'authenticated-owner' } });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql === 'BEGIN') { checkpoint = structuredClone({ row, history }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (checkpoint) { row = checkpoint.row; history = checkpoint.history; } return { rows: [] }; }
    if (sql === 'COMMIT') { checkpoint = null; return { rows: [] }; }
    if (sql.includes('SELECT company_id, tenant_id, runtime_config')) return { rows: structuredClone([row, ...foreign]) };
    if (sql.includes('SELECT * FROM zenithjoy.tenant_company_profiles')) return { rows: [structuredClone(row)] };
    if (sql.startsWith('SELECT') && sql.includes('company_config_changes')) return { rows: history.filter(h =>
      h.conflict?.request_id === args[0] || [h.old_snapshot, h.new_snapshot].some(s => s?.runtime_config?.platform_accounts?.some((a: Row) => a.source?.registration_request_id === args[0]))) };
    if (sql.startsWith('UPDATE zenithjoy.tenant_company_profiles')) {
      if (failCas) return { rows: [], rowCount: 0 };
      row.runtime_config = JSON.parse(String(args[Number(sql.match(/runtime_config\s*=\s*\$(\d+)/)![1]) - 1]));
      row.config_version = Number(args[Number(sql.match(/config_version\s*=\s*\$(\d+)/)![1]) - 1]);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO zenithjoy.company_config_versions') && failSnapshot) throw Error('snapshot failed');
    if (sql.includes('INSERT INTO zenithjoy.company_config_changes')) history.push({ company_id: args[0], version: args[1], actor: args[2],
      old_snapshot: JSON.parse(String(args[3])), new_snapshot: JSON.parse(String(args[4])), conflict: JSON.parse(String(args[5])) });
    return { rows: [], rowCount: 1 };
  });
});
const post = (body: unknown = input(), role = 'owner') => request(app).post('/profile/platform-account-device-replacements')
  .set('x-test-tenant', 'tenant-a').set('x-test-role', role).set('X-Forwarded-For', `192.0.2.${clientIp}`).send(body);
const account = () => row.runtime_config.platform_accounts[0];
const updates = () => mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE'));

describe('同租户原账号换机登记HTTP回归', () => {
  it('已启用公司可以换机：保留账号身份/业务政策，仅新设备待核验并读回', async () => {
    const before = structuredClone(row), response = await post();
    expect(response.status).toBe(201);
    expect(account()).toMatchObject({ id: ACCOUNT, company_id: 'company-a', tenant_id: 'tenant-a', douyin_id: '90915521618',
      ...input().device, device_id: 'acp-android14', enabled: false, verification_status: 'unverified' });
    expect(account()).not.toHaveProperty('verification_source');
    expect(account().fields).toMatchObject({ 手机Profile: 'android14', ADB序列号: 'B114E2190975', 绑定机器: 'mmv', 备注: '须保留' });
    expect(account().source).toMatchObject({ kind: 'tenant_owner_registration', registration_request_id: input().request_id,
      ownership_decision_id: input().ownership_decision_id, device_instance_id: 'acp-android14', device_host: 'mmv', actor: 'authenticated-owner' });
    expect(account().source.registration_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(row.config_status).toBe('enabled'); expect(row.config_version).toBe(30); expect(row.wiki).toEqual(before.wiki);
    expect(row.runtime_config.comment_scoring).toEqual(before.runtime_config.comment_scoring);
    expect(row.runtime_config.policy_id).toBe(before.runtime_config.policy_id);
    expect(row.runtime_config.routing).toEqual({ ...before.runtime_config.routing, profiles: ['physical', 'android14'] });
    expect(history[0].old_snapshot.runtime_config.platform_accounts[0]).toEqual(before.runtime_config.platform_accounts[0]);
    expect(history[0].new_snapshot.runtime_config.platform_accounts[0]).toEqual(account());
    expect(history[0].actor).toBe('authenticated-owner'); expect(response.body.data.verification_required).toBe(true);
    const read = await request(app).get('/profile').set('x-test-tenant', 'tenant-a');
    expect(read.body.data.runtime_config.platform_accounts[0]).toEqual(account());
  });
  it('真实owner和可信来源必需，身份头及其他角色不能替代', async () => {
    mocks.session.mockResolvedValue(null); expect((await post().set('X-Feishu-User-Id', 'guessed')).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 'different' } }); expect((await post()).status).toBe(403);
    mocks.session.mockResolvedValue({ user: { id: 'authenticated-owner' } });
    expect((await post(input(), 'admin')).status).toBe(403); expect((await post(input(), 'member')).status).toBe(403);
    expect((await post().set('Origin', 'https://untrusted.example')).status).toBe(403); expect(updates()).toHaveLength(0);
  });
  it.each(['company_id', 'tenant_id', 'douyin_id', 'enabled', 'verification_status'])('拒绝输入改身份或自报%s', async key => {
    expect((await post({ ...input(), [key]: 'forged' })).status).toBe(400); expect(updates()).toHaveLength(0);
  });
  it('缺失账号、非唯一账号、跨租户行与非正式账号均拒绝', async () => {
    const original = structuredClone(row);
    for (const mutate of [() => { row.runtime_config.platform_accounts = []; }, () => { row.runtime_config.platform_accounts.push(structuredClone(account())); },
      () => { account().tenant_id = 'foreign'; }, () => { account().source.kind = 'feishu'; }]) {
      row = structuredClone(original); mutate(); expect((await post()).status).toBe(409);
    }
    expect(updates()).toHaveLength(0);
  });
  it.each(['device_serial', 'device_instance_id', 'profile'])('外租户设备冲突 %s 不可占用', async key => {
    const d = input().device;
    foreign = [{ company_id: 'foreign-company', tenant_id: 'foreign-tenant', runtime_config: { platform_accounts: [{
      douyin_id: 'foreign-account', ...(key === 'profile' ? { profile: d.profile, source: { device_host: d.device_host } } : { [key]: d[key] }),
    }] } }];
    const response = await post(); expect(response.status).toBe(409); expect(JSON.stringify(response.body)).not.toContain('foreign-company');
    expect(updates()).toHaveLength(0);
  });
  it('相同原生账号的第二条记录拒绝，不能用目标id掩盖歧义', async () => {
    row.runtime_config.platform_accounts.push({ ...structuredClone(account()), id: 'another' });
    expect((await post()).status).toBe(409); expect(updates()).toHaveLength(0);
  });
  it('同请求重试幂等，改正文拒绝，二次换机后旧请求不能切回', async () => {
    expect((await post()).status).toBe(201); expect((await post()).body.data.idempotent).toBe(true); expect(updates()).toHaveLength(1);
    const altered = input(); altered.device.device_serial = 'other'; expect((await post(altered)).status).toBe(409);
    const second = input(); second.expected_version = 30; second.request_id = '33333333-3333-4333-8333-333333333333';
    second.device.device_serial = 'second-device'; second.device.device_instance_id = 'second-instance';
    expect((await post(second)).status).toBe(201); expect((await post()).status).toBe(409);
    expect(account().device_serial).toBe('second-device'); expect(updates()).toHaveLength(2);
  });
  it('换机后旧登记request不可被新账号重新使用', async () => {
    expect((await post()).status).toBe(201); row.config_status = 'draft';
    const response = await request(app).post('/profile/platform-account-registrations').set('x-test-tenant', 'tenant-a').send({
      expected_version: 30, request_id: OLD_REQUEST, ownership_decision_id: input().ownership_decision_id,
      account: { platform: 'douyin', douyin_id: 'another-account', profile: 'unused', device_serial: 'unused', device_host: 'mmv' }, evidence_refs: input().evidence_refs,
    });
    expect(response.status).toBe(409); expect(updates()).toHaveLength(1);
  });
  it('过期版本、CAS失败及快照失败均不改变绑定；锁顺序与释放可验证', async () => {
    expect((await post({ ...input(), expected_version: 28 })).status).toBe(409); expect(updates()).toHaveLength(0);
    failCas = true; expect((await post()).status).toBe(409); failCas = false;
    failSnapshot = true; expect((await post()).status).toBe(500); expect(row).toEqual(initial()); expect(history).toEqual([]);
    expect(mocks.release).toHaveBeenCalled(); const sql = mocks.query.mock.calls.map(([s]) => String(s));
    expect(sql.findIndex(s => s.includes('pg_advisory_xact_lock'))).toBeLessThan(sql.findIndex(s => s.includes('FOR UPDATE')));
  });
  it('无设备变化不清空核验，普通PUT仍不能直接换机或自行启用', async () => {
    expect((await post({ ...input(), device: { profile: 'physical', device_serial: 'physical-serial', device_instance_id: 'physical-serial', device_host: 'xian-m4' } })).status).toBe(409);
    const changed = structuredClone(row.runtime_config); changed.platform_accounts[0].device_serial = 'bypass';
    expect((await request(app).put('/profile').set('x-test-tenant', 'tenant-a').send({ expected_version: 29, runtime_config: changed })).status).toBe(400);
    expect(updates()).toHaveLength(0);
  });
  it.each(['device_host', 'device_instance_id'])('普通PUT不能改现役顶层设备字段 %s', async key => {
    row.source_evidence = []; account().device_instance_id = 'physical-serial';
    const before = structuredClone(row), changed = structuredClone(row.runtime_config);
    changed.platform_accounts[0][key] = 'foreign-device';
    const response = await request(app).put('/profile').set('x-test-tenant', 'tenant-a')
      .send({ expected_version: 29, runtime_config: changed });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('IMMUTABLE_COMPANY_BINDING');
    expect(row).toEqual(before); expect(updates()).toHaveLength(0);
  });
});
