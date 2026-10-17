import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), session: vi.fn() }));
vi.mock('../auth', () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock('../db/connection', () => ({ default: { query: mocks.query, connect: mocks.connect } }));
vi.mock('../middleware/tenant-context', () => ({ tenantContext: (req: Request, _res: Response, next: NextFunction) => { req.tenantId=req.header('x-test-tenant'); req.tenantRole=req.header('x-test-role')||'owner'; req.feishuUserId='authenticated-actor'; next(); } }));
import { companyProfileRouter } from './company-profile';
// 每个用例独立客户端IP，避免本文件扩充后跨用例耗尽生产60次限额。
const app=express(); app.set('trust proxy',1); app.use(express.json()); app.use('/profile',companyProfileRouter);
const initial=()=>({ company_id:'company-a',tenant_id:'tenant-a',company_key:'yueshengyun',company_name:'悦升云端',config_version:1,config_status:'draft',config_owner:'owner',city:'',industry:'',description:'',customer_problem:'',customer_portrait:'',products:[],key_advantages:[],qa_list:[],wiki:{markdown:'# Draft',products:[{id:'p',name:'待确认'}]},source_evidence:[],runtime_config:{routing:{line_key:'yuesheng',profiles:['old-profile'],feishu_base:'own-base'},policy_id:'draft-v1',comment_scoring:{status:'draft',criteria:{A:'草稿'}},platform_accounts:[{id:'old-record',fields:{抖音号:'oldaccount',手机Profile:'old-profile',ADB序列号:'old-device'},enabled:false,verification_status:'unverified'}]}});
const input=()=>({expected_version:1,request_id:'11111111-1111-4111-8111-111111111111',ownership_decision_id:'d6b9c66a-f019-469a-957a-399cbfbcbe39',account:{platform:'douyin',douyin_id:'perfect21xx',nickname:'企业Ai员工智能体',profile:'cloud-phone-test',device_serial:'47.100.213.173:10001',device_instance_id:'acp-f6utus34dgnghc1oc',device_host:'mmv'},evidence_refs:[{uri:'/evidence/fresh-account.stdout',sha256:'a'.repeat(64)}]});
let clientIp=0;
let row: ReturnType<typeof initial>; let foreign: Array<Record<string,unknown>>;let checkpoint: ReturnType<typeof initial>|null;let failSnapshot=false;let failCas=false;
beforeEach(()=>{clientIp++;vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:"authenticated-actor"}});row=initial();foreign=[];checkpoint=null;failSnapshot=false;failCas=false;mocks.connect.mockResolvedValue({query:mocks.query,release:mocks.release});mocks.query.mockImplementation(async(sql:string,args:unknown[]=[])=>{
 if(sql==='BEGIN'){checkpoint=structuredClone(row);return {rows:[]};}
 if(sql==='ROLLBACK'){if(checkpoint)row=checkpoint;return {rows:[]};}
 if(sql==='COMMIT'){checkpoint=null;return {rows:[]};}
 if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
 if(sql.includes('SELECT company_id, tenant_id, runtime_config'))return {rows:[structuredClone(row),...structuredClone(foreign)]};
 if(sql.includes('SELECT * FROM zenithjoy.tenant_company_profiles'))return {rows:[structuredClone(row)]};
 if(sql.startsWith('UPDATE zenithjoy.tenant_company_profiles')){if(failCas)return {rows:[],rowCount:0};row.runtime_config=JSON.parse(String(args[0]));row.config_version=Number(args[1]);return {rows:[structuredClone(row)],rowCount:1};}
 if(sql.includes('INSERT INTO zenithjoy.company_config_versions')&&failSnapshot)throw Error('snapshot unavailable');
 return {rows:[],rowCount:1};
});});
const post=(body:unknown=input(),role='owner')=>request(app).post('/profile/platform-account-registrations').set('x-test-tenant','tenant-a').set('x-test-role',role).set('X-Forwarded-For','192.0.2.'+clientIp).send(body);
const updates=()=>mocks.query.mock.calls.filter(([sql])=>String(sql).startsWith('UPDATE'));
describe('正式公司账号归属登记HTTP合同',()=>{
 it('真实入口追加disabled/unverified登记，保留旧账号/草稿/政策并GET读回',async()=>{const before=initial();const r=await post();expect(r.status).toBe(201);expect(r.body.data.verification_required).toBe(true);expect(r.body.data.account).toMatchObject({douyin_id:'perfect21xx',profile:'cloud-phone-test',device_serial:'47.100.213.173:10001',enabled:false,verification_status:'unverified'});expect(row.config_version).toBe(2);expect(row.config_status).toBe('draft');expect(row.wiki).toEqual(before.wiki);expect(row.runtime_config.comment_scoring).toEqual(before.runtime_config.comment_scoring);expect(row.runtime_config.platform_accounts[0]).toEqual(before.runtime_config.platform_accounts[0]);expect(row.runtime_config.routing.profiles).toEqual(['old-profile','cloud-phone-test']);const read=await request(app).get('/profile').set('x-test-tenant','tenant-a');expect(read.body.data.runtime_config.platform_accounts).toHaveLength(2);});
 it('旧Feishu身份头不能替代真实session',async()=>{mocks.session.mockResolvedValue(null);const r=await post().set('X-Feishu-User-Id','guessed-owner');expect(r.status).toBe(401);expect(mocks.connect).not.toHaveBeenCalled();});
 it('session主体必须等于解析的租户actor',async()=>{mocks.session.mockResolvedValue({user:{id:'different-actor'}});expect((await post()).status).toBe(403);expect(mocks.connect).not.toHaveBeenCalled();});
 it('带真实session仍拒绝跨站未信任Origin',async()=>{expect((await post().set('Origin','https://untrusted.example')).status).toBe(403);expect(mocks.connect).not.toHaveBeenCalled();});
 it('浏览器跨站且缺Origin拒绝，不能利用全局宽CORS',async()=>{expect((await post().set('Sec-Fetch-Site','cross-site')).status).toBe(403);expect(mocks.connect).not.toHaveBeenCalled();});
 it('管理员亦可登记',async()=>{expect((await post(input(),'admin')).status).toBe(201);});
 it('缺认证租户拒绝，不认body租户',async()=>{expect((await request(app).post('/profile/platform-account-registrations').send({...input(),tenant_id:'tenant-a'})).status).toBe(403);expect(mocks.connect).not.toHaveBeenCalled();});
 it('普通成员不可登记',async()=>{expect((await post(input(),'member')).status).toBe(403);expect(mocks.connect).not.toHaveBeenCalled();});
 it.each(['company_id','tenant_id','config_status','runtime_config'])('拒绝越权顶层字段%s',async key=>{expect((await post({...input(),[key]:'foreign'})).status).toBe(400);expect(updates()).toHaveLength(0);});
 it.each(['enabled','verification_status','company_id'])('账号不能自报%s',async key=>{const b=input();Object.assign(b.account,{[key]:key==='enabled'?true:'verified'});expect((await post(b)).status).toBe(400);expect(updates()).toHaveLength(0);});
 it('缺版本、决定或证据拒绝',async()=>{for(const key of ['expected_version','ownership_decision_id','evidence_refs']){const b:Record<string,unknown>=input();delete b[key];expect((await post(b)).status).toBe(400);}expect(updates()).toHaveLength(0);});
 it('全局唯一互斥先于任何公司FOR UPDATE，避免跨租户并发抢占',async()=>{await post();const sql=mocks.query.mock.calls.map(([s])=>String(s));expect(sql.findIndex(s=>s.includes('pg_advisory_xact_lock'))).toBeGreaterThan(sql.indexOf('BEGIN'));expect(sql.findIndex(s=>s.includes('pg_advisory_xact_lock'))).toBeLessThan(sql.findIndex(s=>s.includes('FOR UPDATE')));});
 it('其他公司已有旧fields账号同号（大小写）拒绝且不泄漏所属主体',async()=>{foreign=[{company_id:'company-b',tenant_id:'tenant-b',runtime_config:{platform_accounts:[{fields:{抖音号:'PERFECT21XX'}}]}}];const r=await post();expect(r.status).toBe(409);expect(r.body.error.code).toBe('ACCOUNT_OWNERSHIP_CONFLICT');expect(JSON.stringify(r.body)).not.toContain('company-b');expect(updates()).toHaveLength(0);});
 it('其他公司已绑相同设备/实例或host+profile拒绝',async()=>{for(const binding of [{device_serial:input().account.device_serial},{device_instance_id:input().account.device_instance_id},{device_host:'mmv',profile:'cloud-phone-test'}]){foreign=[{company_id:'company-b',tenant_id:'tenant-b',runtime_config:{platform_accounts:[{douyin_id:'someoneelse',...binding}]}}];expect((await post()).status).toBe(409);}expect(updates()).toHaveLength(0);});
 it('同request完整重试返回原登记，旧expected_version不产生第二版本',async()=>{expect((await post()).status).toBe(201);const r=await post();expect(r.status).toBe(200);expect(r.body.data.idempotent).toBe(true);expect(row.config_version).toBe(2);expect(updates()).toHaveLength(1);});
 it('同request换设备拒绝，不能把旧回执冒新绑定',async()=>{await post();const b=input();b.account.device_serial='other-device';expect((await post(b)).status).toBe(409);expect(updates()).toHaveLength(1);});
 it('同账号新request不得再建身份',async()=>{await post();const b=input();b.request_id='22222222-2222-4222-8222-222222222222';b.expected_version=2;expect((await post(b)).status).toBe(409);expect(updates()).toHaveLength(1);});
 it('旧版本冲突保持原公司并落conflict审计',async()=>{const b=input();b.expected_version=0;const r=await post(b);expect(r.status).toBe(409);expect(r.body.error.code).toBe('VERSION_CONFLICT');expect(updates()).toHaveLength(0);expect(mocks.query.mock.calls.some(([s])=>String(s).includes('company_config_changes'))).toBe(true);});
 it('必须已有draft，不静默停用已启用公司的政策',async()=>{row.config_status='enabled';expect((await post()).status).toBe(409);expect(row.config_status).toBe('enabled');expect(updates()).toHaveLength(0);});
 it('成功保存不可变版本及旧新actor审计，CAS约束tenant/version',async()=>{await post();const update=updates()[0];expect(String(update[0])).toMatch(/tenant_id\s*=\s*\$4.*config_version\s*=\s*\$5/);expect(update[1]).toEqual([expect.any(String),2,'company-a','tenant-a',1]);const audit=mocks.query.mock.calls.find(([s])=>String(s).includes('INSERT INTO zenithjoy.company_config_changes'));expect(audit?.[1]).toContain('authenticated-actor');expect(mocks.query.mock.calls.some(([s])=>String(s).includes('INSERT INTO zenithjoy.company_config_versions'))).toBe(true);});
 it('CAS未更新必须回滚，不返回成功',async()=>{failCas=true;expect((await post()).status).toBe(409);expect(row.config_version).toBe(1);expect(mocks.query.mock.calls.some(([s])=>s==='ROLLBACK')).toBe(true);});
 it('快照失败回滚公司变更并释放连接',async()=>{failSnapshot=true;expect((await post()).status).toBe(500);expect(row).toEqual(initial());expect(mocks.query.mock.calls.some(([s])=>s==='ROLLBACK')).toBe(true);expect(mocks.release).toHaveBeenCalled();});
});

const legacyId='recLegacyAccount';
const legacyAccount=()=>({id:legacyId,fields:{抖音号:'perfect21xx',抖音账号:'旧显示名',手机Profile:'old-phone',ADB序列号:'stale-serial'},source:{platform:'feishu',base:'own-base',table:'accounts',record:legacyId,read_at:'2026-10-13T00:00:00Z'},enabled:false,verification_status:'unverified',custom_history:{keep:'完整原行'}});
function seedLegacy(extra:Record<string,unknown>={}){const account={...legacyAccount(),...extra};row.runtime_config.platform_accounts=[account] as typeof row.runtime_config.platform_accounts;return structuredClone(account);}
const migrate=(extra:Record<string,unknown>={})=>({...input(),legacy_account_id:legacyId,...extra});
describe('显式迁移同公司唯一Feishu历史账号HTTP回归',()=>{
 it('生成canonical UUID并保留完整旧行、政策及不可变版本审计',async()=>{
  const old=seedLegacy();const before=structuredClone(row);const r=await post(migrate());expect(r.status).toBe(201);
  const account=r.body.data.account;expect(account.id).toMatch(/^[0-9a-f-]{36}$/);expect(account.id).not.toBe(legacyId);expect(account).toMatchObject({douyin_id:'perfect21xx',enabled:false,verification_status:'unverified'});
  expect(account.source.legacy_migration).toMatchObject({legacy_account_id:legacyId,legacy_account:old,from_config_version:1});
  expect(row.runtime_config.platform_accounts).toHaveLength(1);expect(row.runtime_config.platform_accounts[0]).toEqual(account);expect(row.runtime_config.comment_scoring).toEqual(before.runtime_config.comment_scoring);expect(row.wiki).toEqual(before.wiki);
  const audit=mocks.query.mock.calls.find(([s])=>String(s).includes('INSERT INTO zenithjoy.company_config_changes'))!;expect(JSON.parse(audit[1][3] as string).runtime_config.platform_accounts[0]).toEqual(old);expect(JSON.parse(audit[1][4] as string).runtime_config.platform_accounts[0]).toEqual(account);
  expect(mocks.query.mock.calls.some(([s])=>String(s).includes('INSERT INTO zenithjoy.company_config_versions'))).toBe(true);
 });
 it('默认同号仍409；精确重试幂等且同request换迁移目标拒绝',async()=>{seedLegacy();expect((await post()).status).toBe(409);expect((await post(migrate())).status).toBe(201);expect((await post(migrate())).body.data.idempotent).toBe(true);expect((await post(migrate({legacy_account_id:'different-legacy'}))).status).toBe(409);expect(updates()).toHaveLength(1);});
 it.each([
  ['启用',{enabled:true}],['已核验',{verification_status:'verified'}],['未知启用',{enabled:undefined}],['未知核验',{verification_status:undefined}],['非Feishu',{source:{platform:'manual'}}],['正式登记',{source:{platform:'feishu',kind:'tenant_owner_registration'}}],['登记请求',{source:{platform:'feishu',registration_request_id:'prior'}}],['登记摘要',{source:{platform:'feishu',registration_fingerprint:'prior'}}],['已登记时间',{source:{platform:'feishu',registered_at:'prior'}}],['决定来源',{source:{platform:'feishu',ownership_decision_id:'prior'}}],['核验来源',{verification_source:{}}],['source核验来源',{source:{platform:'feishu',verification_source:{}}}],['top platform矛盾',{platform:'wechat'}],['top company矛盾',{company_id:'foreign'}],['top tenant矛盾',{tenant_id:'foreign'}],['top native矛盾',{douyin_id:'someoneelse'}],['raw native矛盾',{fields:{抖音号:'someoneelse'}}],
 ])('不可迁移旧行拒绝：%s',async(_name,extra)=>{seedLegacy(extra as Record<string,unknown>);expect((await post(migrate())).status).toBe(409);expect(updates()).toHaveLength(0);});
 it('缺失/非唯一id及同号多行拒绝',async()=>{seedLegacy();expect((await post(migrate({legacy_account_id:'missing'}))).status).toBe(409);row.runtime_config.platform_accounts.push({...legacyAccount()});expect((await post(migrate())).status).toBe(409);row.runtime_config.platform_accounts=[legacyAccount(),{...legacyAccount(),id:'recOther'}] as typeof row.runtime_config.platform_accounts;expect((await post(migrate())).status).toBe(409);expect(updates()).toHaveLength(0);});
 it.each([null,'',42,{}])('非法legacy id返回400：%s',async id=>{seedLegacy();expect((await post(migrate({legacy_account_id:id}))).status).toBe(400);expect(updates()).toHaveLength(0);});
 it('外公司同号即使raw disabled/unverified仍拒绝迁移',async()=>{seedLegacy();foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[legacyAccount()]}}];expect((await post(migrate())).status).toBe(409);expect(updates()).toHaveLength(0);});
 it.each([{device_serial:input().account.device_serial},{device_id:input().account.device_instance_id},{source:{device_instance_id:input().account.device_instance_id}},{profile:'cloud-phone-test',source:{device_host:'mmv'}}])('外公司真实typed绑定仍阻断迁移：%j',async binding=>{seedLegacy();foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[{douyin_id:'foreignnative',...binding}]}}];expect((await post(migrate())).status).toBe(409);expect(updates()).toHaveLength(0);});
 it('canonical serial优先；未登记Feishu raw设备不冒现役',async()=>{seedLegacy();foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[{id:'verified-old',device_serial:'real-foreign-serial',profile:'foreign-profile',verification_status:'verified',fields:{ADB序列号:input().account.device_serial},source:{device_host:'xian-m4'}},{...legacyAccount(),fields:{抖音号:'othernative',ADB序列号:input().account.device_serial,手机Profile:'cloud-phone-test',绑定机器:'mmv'}}]}}];expect((await post(migrate())).status).toBe(201);});
 it('迁移快照失败必须事务回滚',async()=>{const old=seedLegacy();failSnapshot=true;expect((await post(migrate())).status).toBe(500);expect(row.config_version).toBe(1);expect(row.runtime_config.platform_accounts).toEqual([old]);});
});

// 2026-10-17蓝白原409配置的完整旧账号行；抖音账号为展示名，抖音号才是原生ID。
const physicalLegacyFixtures=[{"profile": "jinoshengyuan-work", "native": "langzi63485", "serial": "ANGYVB4227006983", "legacy": {"id": "recvteyZ7VYjMa", "fields": {"备注": "2026-09-06用户拍板:与人工智能小诺考评共同承担搜索+私信,7250已排除;当前手机实际登录账号;绑定机器型号纠正为HONOR MAA-AN00(原记录误写RMX3478)", "业务线": "金诺盛源", "抖音号": "langzi63485", "ADB序列号": "e6c7ef34", "允许任务": "搜索、查看、线索发现、私信触达、回复跟进", "内容定位": "分发、话术A/B与客服承接", "切换标识": "躺赢AI学姐", "归属状态": "抖音号已核验；用户指定为小号1", "抖音账号": "躺赢AI学姐", "每日上限": "1", "目标人群": "去重后的合格线索", "绑定机器": "XIAN-M4-PHONE / MAA-AN00", "账号名称": "躺赢AI学姐", "账号状态": "正常", "账号角色": "搜索+分发小号", "手机Profile": "jinoshengyuan-work", "登录优先级": "2", "今日已触达数": "0", "是否当前登录": "是", "最近核验时间": "2026-08-25", "最近登录时间": "2026-08-25"}, "source": {"base": "GNuwbzY0da8GP0sv6MGcOTu9ntd", "table": "tblzgMSK4KfgdE0r", "record": "recvteyZ7VYjMa", "read_at": "2026-10-13T08:33:42.932Z", "platform": "feishu"}, "enabled": false, "verification_status": "unverified"}}, {"profile": "yueshengyun-work", "native": "37358506855", "serial": "e6c7ef34", "legacy": {"id": "recvtjA2J2jSfY", "fields": {"备注": "2026-09-06用户拍板:与Ai办公室共同承担搜索+私信", "业务线": "自媒体代运营", "抖音号": "37358506855", "ADB序列号": "e6c7ef34", "允许任务": "身份核验后再配置", "内容定位": null, "切换标识": null, "归属状态": "悦升云端", "抖音账号": "Ai效率笔记", "每日上限": "0", "目标人群": null, "绑定机器": "XIAN-M1-PHONE", "账号名称": "Ai效率笔记", "账号状态": "正常", "账号角色": "搜索+分发小号", "手机Profile": "yueshengyun-work", "登录优先级": "99", "今日已触达数": "0", "是否当前登录": false, "最近核验时间": null, "最近登录时间": null}, "source": {"base": "H3OrbAH49aLNebs7XvOcpS1enec", "table": "tblg8QCFIIGkCVen", "record": "recvtjA2J2jSfY", "read_at": "2026-10-13T08:33:42.932Z", "platform": "feishu"}, "enabled": false, "verification_status": "unverified"}}];
describe('实机蓝白旧Feishu账号回归',()=>{
 it.each(physicalLegacyFixtures)('显式迁移$profile原行并保留所有原字段',async f=>{
  row.runtime_config.platform_accounts=[structuredClone(f.legacy)] as typeof row.runtime_config.platform_accounts;
  const b=migrate({legacy_account_id:f.legacy.id});b.account={...b.account,douyin_id:f.native,profile:f.profile,device_serial:f.serial,device_instance_id:f.serial,device_host:'xian-m4'};
  foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[{douyin_id:'44997267357',device_serial:'ANGYVB4402004137',profile:'legacy',verification_status:'verified',source:{platform:'feishu'},fields:{抖音号:'44997267357',ADB序列号:'e6c7ef34',手机Profile:'jinoshengyuan-work',绑定机器:'XIAN-M4-PHONE'}}]}}];
  const r=await post(b);expect(r.status).toBe(201);expect(r.body.data.account.source.legacy_migration.legacy_account).toEqual(f.legacy);expect(r.body.data.account.device_serial).toBe(f.serial);expect(r.body.data.account.enabled).toBe(false);expect(r.body.data.account.verification_status).toBe('unverified');
 });
});

describe('登记设备绑定来源优先级',()=>{
 it('普通新号登记也忽略外公司canonical已纠正的陈旧raw serial',async()=>{
  foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[{douyin_id:'foreignnative',device_serial:'actual-foreign-device',verification_status:'verified',fields:{ADB序列号:input().account.device_serial}}]}}];expect((await post()).status).toBe(201);
 });
 it('普通新号登记不把未登记Feishu raw字段当现役设备',async()=>{
  foreign=[{company_id:'foreign',runtime_config:{platform_accounts:[{...legacyAccount(),fields:{抖音号:'foreignnative',ADB序列号:input().account.device_serial,手机Profile:input().account.profile,绑定机器:input().account.device_host}}]}}];expect((await post()).status).toBe(201);
 });
});
