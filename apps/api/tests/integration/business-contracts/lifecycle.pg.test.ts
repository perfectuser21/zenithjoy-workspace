import './setup-env';
import { afterAll, describe, expect, it, vi } from 'vitest';
const {model,provider,childCalls}=vi.hoisted(()=>({model:vi.fn(),provider:vi.fn(),childCalls:[] as Array<{command:string,args:string[],options:unknown,closed:Promise<unknown>}>}));
// The actual route invokes its process boundary, but this fixture only launches a
// disposable local Node process. It cannot SSH, invoke Claude or use an account.
vi.mock('child_process',async()=>{
 const real=await vi.importActual<typeof import('child_process')>('child_process');
 return {...real,spawn:(command:string,args:string[],options:unknown)=>{
  if(command!=='ssh'||args[0]!=='mmv')throw new Error('unexpected process boundary');
  const child=real.spawn(process.execPath,['-e','process.exit(0)'],{detached:true,stdio:'ignore'});
  const closed=new Promise(resolve=>child.once('exit',resolve));childCalls.push({command,args,options,closed});return child;
 }};
});
vi.mock('axios',()=>({default:{post:provider,get:provider,isAxiosError:()=>false}}));
vi.mock('../../../src/services/comment-grading',()=>({gradeComments:vi.fn(async(_profile,_title,_transcript,comments)=>comments.map(()=> '精准'))}));
vi.mock('../../../src/llm/openrouter',()=>({callOpenRouter:model}));
import request from 'supertest';
import app from '../../../src/app';
import pool from '../../../src/db/connection';
import { randomUUID } from 'node:crypto';
import { TIER_QUOTA } from '../../../src/services/license.service';
afterAll(() => pool.end());
describe('current license, registration and tenant lifecycle — real HTTP + PostgreSQL', () => {
 it('admin-created paid license has a real tenant and can register then reconnect one agent', async()=>{
  const create=await request(app).post('/api/admin/license').set('X-Internal-Token',process.env.ZENITHJOY_INTERNAL_TOKEN!).send({tier:'basic'});expect(create.status).toBe(200);
  const license=create.body.data;const stored=(await pool.query('SELECT * FROM zenithjoy.licenses WHERE id=$1',[license.id])).rows[0];expect(stored.tenant_id).toMatch(/^[a-f\d-]{36}$/);
  const machine=randomUUID();const register=()=>request(app).post('/api/agent/register').send({license_key:license.license_key,machine_id:machine,hostname:machine});
  const first=await register();expect(first.status).toBe(200);expect(first.body).toMatchObject({ok:true,success:true,device_count:1,device_limit:1});
  const again=await register();expect(again.body.agent_id).toBe(first.body.agent_id);expect((await pool.query('SELECT id FROM zenithjoy.agents WHERE license_id=$1',[license.id])).rows).toHaveLength(1);
  const over=await request(app).post('/api/agent/register').send({license_key:license.license_key,machine_id:randomUUID()});expect(over.status).toBe(403);expect(over.body.error).toBe('LICENSE_DEVICE_LIMIT_EXCEEDED');
 });
 it('email registration without/with invalid key creates a usable free account using current quota',async()=>{
  for(const license_key of [undefined,'ZJ-B-INVALIDX']){
   const signup=await request(app).post('/api/auth/sign-up/email').send({email:`business-${randomUUID()}@example.test`,password:'Local-test-password-123',name:'Business fixture',license_key});expect(signup.status).toBe(200);
   const userId=signup.body.user.id;const cookies=signup.headers['set-cookie'];expect(cookies).toBeDefined();
   const me=await request(app).get('/api/account/me').set('Cookie',cookies);expect(me.status).toBe(200);expect(me.body.user.id).toBe(userId);expect(me.body.license).toMatchObject({tier:'free',max_machines:TIER_QUOTA.free});
   const ownership=await pool.query(`SELECT l.tenant_id,l.customer_id,l.max_machines,tm.role,t.plan FROM zenithjoy.licenses l JOIN zenithjoy.tenants t ON t.id=l.tenant_id JOIN zenithjoy.tenant_members tm ON tm.tenant_id=t.id WHERE l.customer_id=$1 AND tm.feishu_user_id=$1`,[userId]);expect(ownership.rows).toHaveLength(1);expect(ownership.rows[0]).toMatchObject({customer_id:userId,max_machines:1,role:'owner',plan:'free'});
   const credits=(await pool.query('SELECT balance FROM zenithjoy.tenant_credits WHERE tenant_id=$1',[ownership.rows[0].tenant_id])).rows;expect(credits).toEqual([{balance:100}]);
   const works=await request(app).get('/api/works').set('Cookie',cookies);expect(works.status).toBe(200);expect(Array.isArray(works.body.data)).toBe(true);
  }
 });
});

describe('real SQL tenant boundaries',()=>{
 it('snapshot ingest saves=555 reads through its work and stays invisible to another tenant',async()=>{
  const tenants=[] as {cookie:string[];id:string}[];
  for(let i=0;i<2;i++){
   const signup=await request(app).post('/api/auth/sign-up/email').send({email:`performance-${randomUUID()}@example.test`,password:'Local-test-password-123',name:'Performance fixture'});expect(signup.status).toBe(200);
   const row=(await pool.query('SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=$1',[signup.body.user.id])).rows[0];tenants.push({cookie:signup.headers['set-cookie'],id:row.tenant_id});
  }
  const work=(await pool.query("INSERT INTO zenithjoy.works(title,content_type,tenant_id) VALUES('performance fixture','text',$1) RETURNING id",[tenants[0].id])).rows[0].id;
  const contentId=randomUUID();await pool.query("INSERT INTO zenithjoy.publish_logs(work_id,platform,platform_post_id,published_at) VALUES($1,'douyin',$2,'2026-11-03T12:00:00Z')",[work,contentId]);
  const ingest=await request(app).post('/api/snapshots/ingest').send({platform:'douyin',items:[{content_id:contentId,scraped_date:'2026-11-04',views:1234,saves:555}]});expect(ingest.status).toBe(200);expect(ingest.body.inserted).toBe(1);
  const own=await request(app).get(`/api/works/${work}/performance`).set('Cookie',tenants[0].cookie);expect(own.status).toBe(200);expect(own.body.platforms.douyin).toEqual([expect.objectContaining({saves:555,views:1234,day_n:1})]);
  const alien=await request(app).get(`/api/works/${work}/performance`).set('Cookie',tenants[1].cookie);expect(alien.status).toBe(200);expect(alien.body.platforms).toEqual({});
  const alienPlatform=await request(app).get(`/api/works/${work}/performance/douyin`).set('Cookie',tenants[1].cookie);expect(alienPlatform.status).toBe(200);expect(alienPlatform.body.data).toEqual([]);
 });
});


async function account() {
 const signup=await request(app).post('/api/auth/sign-up/email').send({email:`fixture-${randomUUID()}@example.test`,password:'Local-test-password-123',name:'Isolated business fixture'});
 expect(signup.status).toBe(200);
 const userId=signup.body.user.id;
 const license=(await pool.query('SELECT * FROM zenithjoy.licenses WHERE customer_id=$1',[userId])).rows[0];
 return {cookie:signup.headers['set-cookie'] as string[],userId,tenant:license.tenant_id as string,key:license.license_key as string};
}
async function device() {
 const owner=await account(), machine=randomUUID();
 const reg=await request(app).post('/api/agent/register').send({license_key:owner.key,machine_id:machine,hostname:machine,agent_id:`fixture-${machine}`});
 expect(reg.status).toBe(200);
 await pool.query("UPDATE zenithjoy.agents SET os_type='android',last_heartbeat_at=now() WHERE id=$1",[reg.body.agent_id]);
 return {...owner,machine,agent:reg.body.agent_id as string};
}
async function bindCs(d:Awaited<ReturnType<typeof device>>) {
 const cs=`fixture-cs-${randomUUID()}`;
 const r=await request(app).put(`/api/wechat/cs/setup/${d.machine}`).set('Cookie',d.cookie).send({wechat_id:cs,auto_agent_enabled:false,real_wechat_id:`real-${randomUUID()}`});
 expect(r.status).toBe(200); expect(r.body.wechat_id).toBe(cs); return cs;
}

describe('agent event, account scan and Android warmup — actual producer SQL',()=>{
 it('real agentContext selects a fresh pinned agent and falls back when its heartbeat is stale',async()=>{
  const d=await device();
  const other=(await pool.query("INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status,last_heartbeat_at) VALUES($1,$2,$3,'online',now()) RETURNING id",[d.tenant,`fixture-other-${randomUUID()}`,`fixture-other-${randomUUID()}`])).rows[0].id;
  await pool.query('UPDATE zenithjoy.licenses SET pinned_agent_id=$1,updated_at=now() WHERE tenant_id=$2',[d.agent,d.tenant]);
  await pool.query("UPDATE zenithjoy.agents SET last_heartbeat_at=now()-interval '1 minute' WHERE id=$1",[d.agent]);
  const express=(await import('express')).default;const {agentContext}=await import('../../../src/middleware/agent-context');
  const probe=express();probe.use(express.json());probe.post('/fixture',(req,_res,next)=>{req.tenantId=d.tenant;next();},agentContext,(req,res)=>res.json({agent_id:req.agentId}));
  const pinned=await request(probe).post('/fixture').send({});expect(pinned.status).toBe(200);expect(pinned.body.agent_id).toBe(d.agent);
  await pool.query("UPDATE zenithjoy.agents SET last_heartbeat_at=now()-interval '6 minutes' WHERE id=$1",[d.agent]);
  const fallback=await request(probe).post('/fixture').send({});expect(fallback.status).toBe(200);expect(fallback.body.agent_id).toBe(other);
 });
 it('historical qr-bind receipt closes the seeded in-flight task and persists its session',async()=>{
  const d=await device();
  const task=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','qr_bind/douyin_burner',$3::jsonb) RETURNING id",[d.agent,d.tenant,JSON.stringify({agent_id:d.agent,account_label:'fixture-qr'})])).rows[0].id;
  const response=await request(app).post('/api/agent/burner/qr-bind-result').send({task_id:task,agent_id:d.agent,qr_login:'success'});
  expect(response.status).toBe(200);expect(response.body.data.sessions_updated).toBe(1);
  expect((await pool.query('SELECT status FROM zenithjoy.publish_tasks WHERE id=$1',[task])).rows).toEqual([{status:'done'}]);
  expect((await pool.query("SELECT role,status FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND account_label=$2",[d.agent,`pending:${task}`])).rows).toEqual([{role:'burner',status:'active'}]);
  expect((await request(app).post('/api/agent/burner/qr-bind-result').send({task_id:randomUUID(),agent_id:d.agent,qr_login:'success'})).status).toBe(404);
 });
 it('historical crawl receipt stores real task status and tenant-scoped leads',async()=>{
  const d=await device();const video=`https://www.douyin.com/video/${randomUUID()}`;
  const task=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','crawl_comments/douyin',$3::jsonb) RETURNING id",[d.agent,d.tenant,JSON.stringify({video_url:video})])).rows[0].id;
  const response=await request(app).post('/api/agent/burner/crawl-comments-result').send({task_id:task,video_url:video,comments:[{commenter_id:'/user/fixture-user',text:'fixture comment'}]});
  expect(response.status).toBe(200);expect(response.body.data).toMatchObject({comment_count:1,inserted:1,lead_write_status:'local_only'});
  expect((await pool.query('SELECT status,response FROM zenithjoy.publish_tasks WHERE id=$1',[task])).rows[0]).toMatchObject({status:'done',response:{comment_count:1,lead_write_status:'local_only'}});
  expect((await pool.query('SELECT sec_uid,comment_text FROM zenithjoy.acquisition_leads WHERE tenant_id=$1 AND sec_uid=$2',[d.tenant,'fixture-user'])).rows).toEqual([{sec_uid:'fixture-user',comment_text:'fixture comment'}]);
  expect((await request(app).post('/api/agent/burner/crawl-comments-result').send({task_id:randomUUID(),comments:[]})).status).toBe(404);
 });
 it('single/batch events persist license-derived tenant, and machine events reject another tenant',async()=>{
  const d=await device();
  const payload={agent_id:d.agent,kind:'log',level:'info',message:'business fixture event'};
  expect((await request(app).post('/api/agent/events').send(payload)).status).toBe(401);
  const single=await request(app).post('/api/agent/events').set('X-License-Key',d.key).send({...payload,tenant_id:randomUUID()});expect(single.status).toBe(200);
  const batch=await request(app).post('/api/agent/events').set('X-License-Key',d.key).send({events:[{...payload,kind:'upgrade',phase:'done',percent:100},payload]});expect(batch.status).toBe(200);expect(batch.body.data.count).toBe(2);
  const rows=(await pool.query('SELECT tenant_id,kind FROM zenithjoy.agent_events WHERE agent_id=$1',[d.agent])).rows;expect(rows).toHaveLength(3);expect(rows.every(r=>r.tenant_id===d.tenant)).toBe(true);
  const own=await request(app).get(`/api/agent/machines/${d.agent}/events`).set('Cookie',d.cookie);expect(own.status).toBe(200);expect(own.body.data.logs).toHaveLength(2);expect(own.body.data.upgrades).toHaveLength(1);
  const alien=await account();expect((await request(app).get(`/api/agent/machines/${d.agent}/events`).set('Cookie',alien.cookie)).status).toBe(404);
 });
 it('account scan closes the exact queued UUID, repeated result is idempotent and failures retain diagnostics',async()=>{
  const d=await device();
  const task=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','account_scan','{}') RETURNING id",[d.agent,d.tenant])).rows[0].id;
  const body={agent_id:d.agent,request_id:task,ok:true,account_ids:['fixture-burner-a','fixture-burner-b']};
  const first=await request(app).post('/api/agent/burner/account-scan-result').send(body);expect(first.status).toBe(200);expect(first.body.data.written).toBe(2);
  expect((await pool.query('SELECT status FROM zenithjoy.publish_tasks WHERE id=$1',[task])).rows).toEqual([{status:'done'}]);
  const repeat=await request(app).post('/api/agent/burner/account-scan-result').send({...body,account_ids:['must-not-be-added']});expect(repeat.status).toBe(200);expect(repeat.body.data.idempotent).toBe(true);
  expect((await pool.query("SELECT account_label FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND role='burner' ORDER BY account_label",[d.agent])).rows).toEqual([{account_label:'fixture-burner-a'},{account_label:'fixture-burner-b'}]);
  const fail=await request(app).post('/api/agent/burner/account-scan-result').send({agent_id:d.agent,request_id:'periodic-fixture-request',ok:false,account_ids:[],error_code:'SCREEN_LOCKED',version_name:'2.1.20',stage:'lock_check',foreground_package:'com.android.systemui'});expect(fail.status).toBe(200);
  expect((await pool.query('SELECT error_code,detail FROM zenithjoy.agent_scan_failures WHERE agent_id=$1',[d.agent])).rows[0]).toMatchObject({error_code:'SCREEN_LOCKED',detail:{version_name:'2.1.20',stage:'lock_check',foreground_package:'com.android.systemui'}});
 });
 it('retired warmup rejects new jobs but stores existing result fields and duplicate HTTP success',async()=>{
  const d=await device();
  await pool.query("INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,device_type) VALUES($1,'douyin','fixture-warmup','burner','active','android')",[d.agent]);
  const run=()=>request(app).post('/api/acquisition/warmup/run').set('Cookie',d.cookie).send({operator_nickname:'fixture-operator'});
  const first=await run();expect(first.status).toBe(410);
  expect((await pool.query("SELECT id FROM zenithjoy.publish_tasks WHERE agent_id=$1 AND task_type='warmup'",[d.agent])).rows).toHaveLength(0);
  const tasks=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','warmup',$3::jsonb) RETURNING id",[d.agent,d.tenant,JSON.stringify({task_type:'warmup',operator_nickname:'fixture-operator'})])).rows;
  const result=await request(app).post('/api/agent/burner/warmup-result').send({task_id:tasks[0].id,device_id:'isolated-fixture',results:[{nickname:'alive',alive:true,followers:1196},{nickname:'offline',alive:false,followers:null}],error_code:''});expect(result.status).toBe(200);expect(result.body.data).toMatchObject({task_status:'done',written:2});
  const repeat=await request(app).post('/api/agent/burner/warmup-result').send({task_id:tasks[0].id,results:[{nickname:'must-not-be-added',alive:true}]});expect(repeat.status).toBe(200);expect(repeat.body.data.idempotent).toBe(true);
  expect((await pool.query('SELECT nickname,alive,followers FROM zenithjoy.agent_warmup_liveness WHERE agent_id=$1 ORDER BY nickname',[d.agent])).rows).toEqual([{nickname:'alive',alive:true,followers:1196},{nickname:'offline',alive:false,followers:null}]);
 });
});

describe('shared current CS setup, CRM, draft, escalation, receipt and moments contracts',()=>{
 it('setup is owner-only and scoped, creates current shared agent config and scoped workbench list',async()=>{
  const d=await device();
  expect((await request(app).put(`/api/wechat/cs/setup/${d.machine}`).send({})).status).toBe(401);
  const alien=await account();expect((await request(app).put(`/api/wechat/cs/setup/${d.machine}`).set('Cookie',alien.cookie).send({})).status).toBe(403);
  const cs=await bindCs(d);
  const config=await request(app).get(`/api/wechat/cs/agent-config?machine_id=${d.machine}`);expect(config.status).toBe(200);expect(config.body).toMatchObject({wechat_id:cs,auto_agent_enabled:false});
  const own=await request(app).get('/api/wechat/cs/machines').set('Cookie',d.cookie);expect(own.status).toBe(200);expect(own.body.machines).toHaveLength(1);
  const foreign=await request(app).get('/api/wechat/cs/machines').set('Cookie',alien.cookie);expect(foreign.status).toBe(200);expect(foreign.body.machines).toEqual([]);
 });
 it('CRM ingest keeps default dry-run, identity/onboarding, blacklists bots, skips self and hides deleted/foreign rows',async()=>{
  const d=await device(),cs=await bindCs(d);
  const ingest=(contacts:unknown[],extra={})=>request(app).post('/api/crm/friend-scan/ingest').set('X-License-Key',d.key).send({cs_wechat_id:cs,contacts,...extra});
  const first=await ingest([{name:'fixture-customer',wechat_id:'wx-fixture'},{name:'fixture-absent'},{name:'微信ClawBot'},{name:'fixture-self'}],{self_name:'fixture-self'});expect(first.status).toBe(200);expect(first.body.ingested).toBe(3);
  for(let i=0;i<3;i++)expect((await ingest([{name:'fixture-customer'}])).status).toBe(200);
  const absent=(await pool.query("SELECT scan_miss_count,deleted_at FROM zenithjoy.crm_customers WHERE cs_wechat_id=$1 AND contact='fixture-absent'",[cs])).rows[0];expect(absent).toEqual({scan_miss_count:3,deleted_at:null});
  expect((await ingest([{name:'fixture-customer'},{name:'fixture-absent'}])).status).toBe(200);
  const restored=(await pool.query("SELECT scan_miss_count FROM zenithjoy.crm_customers WHERE cs_wechat_id=$1 AND contact='fixture-absent'",[cs])).rows[0];expect(restored.scan_miss_count).toBe(0);
  expect((await pool.query("SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id=$1 AND contact='微信ClawBot'",[cs])).rows[0].identity).toBe('blacklist');
  expect((await pool.query("SELECT contact FROM zenithjoy.crm_customers WHERE cs_wechat_id=$1 AND contact='fixture-self'",[cs])).rows).toEqual([]);
  const identity=await request(app).put('/api/crm/customers/identity').set('Cookie',d.cookie).send({wechat_id:cs,contact:'fixture-customer',identity:'internal'});expect(identity.status).toBe(200);
  const list=await request(app).get(`/api/crm/customers?cs_wechat_id=${cs}`).set('Cookie',d.cookie);expect(list.status).toBe(200);expect(list.body.customers.some((r:any)=>r.contact==='fixture-customer')).toBe(false);expect((await pool.query("SELECT identity FROM zenithjoy.crm_customers WHERE cs_wechat_id=$1 AND contact='fixture-customer'",[cs])).rows[0].identity).toBe('internal');
  const onboarding=await request(app).get(`/api/crm/onboarding/${cs}`).set('Cookie',d.cookie);expect(onboarding.status).toBe(200);
  await pool.query("UPDATE zenithjoy.crm_customers SET deleted_at=now() WHERE cs_wechat_id=$1 AND contact='fixture-customer'",[cs]);
  const hidden=await request(app).get(`/api/crm/customers?cs_wechat_id=${cs}`).set('Cookie',d.cookie);expect(hidden.status).toBe(200);expect(hidden.body.customers.some((r:any)=>r.contact==='fixture-customer')).toBe(false);
  const alien=await account();expect((await request(app).get(`/api/crm/customers?cs_wechat_id=${cs}`).set('Cookie',alien.cookie)).status).toBe(403);
 });
 it('isolated model output persists escalation and AI stage; drafts count as replies only after an actual receipt',async()=>{
  const d=await device(),cs=await bindCs(d),contact=`fixture-contact-${randomUUID()}`;
  model.mockResolvedValue({content:JSON.stringify({reply:'收到，我会核实您的问题。',tags:{stage:'A2',escalate:true}})});
  const draft=await request(app).post('/api/wechat/draft-generate').send({tenant_id:d.tenant,cs_wechat_id:cs,wechat_id:contact,sender:contact,content:'需要人工协助',mode:'auto'});expect(draft.status).toBe(200);expect(draft.body).toMatchObject({status:'sent',reply:'收到，我会核实您的问题。'});expect(draft.body.message_id).toBeTypeOf('number');
  await vi.waitFor(async()=>{expect((await pool.query("SELECT reason FROM zenithjoy.wechat_publish_task WHERE tenant_id=$1 AND target_user=$2",[d.tenant,contact])).rows).toEqual([{reason:'cs_escalate'}]);expect((await pool.query('SELECT new_status,changed_by FROM zenithjoy.crm_customer_status_history WHERE tenant_id=$1 AND contact=$2',[d.tenant,contact])).rows).toEqual([{new_status:'A2',changed_by:'ai_inferred'}]);});
  const before=await request(app).get('/api/wechat/cs/stats');expect(before.status).toBe(200);expect(before.body.stats.find((r:any)=>r.cs_wechat_id===cs)).toMatchObject({received_count:1,reply_count:0,served_customers:1});
  const forged=await request(app).post(`/api/wechat/messages/${draft.body.message_id}/receipt`).send({cs_wechat_id:'foreign-fixture',ok:true});expect(forged.status).toBe(200);expect(forged.body.updated).toBe(false);
  const receipt=await request(app).post(`/api/wechat/messages/${draft.body.message_id}/receipt`).set('X-License-Key',d.key).send({cs_wechat_id:cs,ok:true});expect(receipt.status).toBe(200);expect(receipt.body.updated).toBe(true);
  const repeat=await request(app).post(`/api/wechat/messages/${draft.body.message_id}/receipt`).send({cs_wechat_id:cs,ok:true});expect(repeat.status).toBe(200);expect(repeat.body.updated).toBe(false);
  const after=await request(app).get('/api/wechat/cs/stats');expect(after.status).toBe(200);expect(after.body.stats.find((r:any)=>r.cs_wechat_id===cs)).toMatchObject({received_count:1,reply_count:1,served_customers:1,work_duration_minutes:expect.any(Number)});
 });
 it('marketing profile upsert and moment approve/reject stay on their tenant and preserve dispatch state',async()=>{
  const d=await device(),other=await account();
  const put=await request(app).post('/api/wechat/marketing-profile').set('X-Tenant-Id',d.tenant).send({customer:'fixture',industry:'software',audience:'operators',hook:'fixture-hook'});expect(put.status).toBe(200);
  const update=await request(app).post('/api/wechat/marketing-profile').set('X-Tenant-Id',d.tenant).send({customer:'fixture',industry:'updated'});expect(update.status).toBe(200);expect(update.body.profile.industry).toBe('updated');
  const profiles=await request(app).get('/api/wechat/marketing-profile').set('X-Tenant-Id',d.tenant);expect(profiles.status).toBe(200);expect(profiles.body.profiles).toHaveLength(1);
  const task=randomUUID();await pool.query("INSERT INTO zenithjoy.wechat_publish_task(task_id,platform,type,target_user,content_draft,approval_status,tenant_id,status) VALUES($1,'wechat_personal','moment','fixture','isolated fixture','pending_review',$2,'draft')",[task,d.tenant]);
  const foreign=await request(app).post(`/api/wechat/moment-drafts/${task}/approve`).set('X-Tenant-Id',other.tenant).send({});expect(foreign.status).toBe(404);
  const approved=await request(app).post(`/api/wechat/moment-drafts/${task}/approve`).set('X-Tenant-Id',d.tenant).send({});expect(approved.status).toBe(200);expect(approved.body.task).toMatchObject({approval_status:'approved',approval_source:'dashboard',status:'draft'});
  const rejected=await request(app).post(`/api/wechat/moment-drafts/${task}/reject`).set('X-Tenant-Id',d.tenant).send({});expect(rejected.status).toBe(200);expect(rejected.body.task.approval_status).toBe('rejected');
 });
 it('skill registry returns a real seeded array with statuses instead of accepting empty/string shapes',async()=>{
  const r=await request(app).get('/api/skills');expect(r.status).toBe(200);expect(Array.isArray(r.body.skills)).toBe(true);expect(r.body.skills.length).toBeGreaterThan(0);
  for(const skill of r.body.skills)expect(skill).toMatchObject({slug:expect.any(String),platform:expect.any(String),name:expect.any(String),agent_statuses:expect.any(Object)});
  expect(r.body.skills.some((s:any)=>s.slug==='kuaishou_image_publish')).toBe(true);
 });
});


describe('current acquisition pipeline against PostgreSQL with isolated provider transports',()=>{
 it('two-stage collection produces real video cards/leads and final counts; foreign tenants cannot read them',async()=>{
  const d=await device(),other=await account();
  const task=(await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,agent_id,status,keywords) VALUES($1,$2,'running','[\"fixture\"]') RETURNING id",[d.tenant,d.agent])).rows[0].id;
  const videos=['7111111111111111111','7222222222222222222'];
  const first=await request(app).post('/api/acquisition/collect/report-videos').set('x-agent-id',d.agent).send({task_id:task,videos:videos.map(video_id=>({video_id,title:'fixture video'}))});expect(first.status).toBe(200);expect(first.body.data).toMatchObject({status:'stage_1_done',video_count:2,accepted:2});
  const repeat=await request(app).post('/api/acquisition/collect/report-videos').set('x-agent-id',d.agent).send({task_id:task,videos:videos.map(video_id=>({video_id}))});expect(repeat.status).toBe(200);expect(repeat.body.data.video_count).toBe(2);
  for(const [i,video_id] of videos.entries()){
   const report=await request(app).post('/api/acquisition/collect/report').send({task_id:task,video_id,commenters:[{sec_uid:`fixture-sec-${i}`,nickname:`fixture-commenter-${i}`,comment_text:'如何预约',douyin_id:`fixture-douyin-${i}`}],terminal:i===1?'done':false});expect(report.status).toBe(200);expect(report.body.data.inserted).toBe(1);
  }
  const row=(await pool.query('SELECT status,video_count,lead_count_raw FROM zenithjoy.acquisition_collect_tasks WHERE id=$1',[task])).rows[0];expect(row).toMatchObject({status:'done',video_count:2,lead_count_raw:2});
  const cards=await request(app).get(`/api/acquisition/collect-tasks/${task}/videos`).set('Cookie',d.cookie);expect(cards.status).toBe(200);expect(cards.body.data.videos).toHaveLength(2);expect(cards.body.data.videos.every((v:any)=>v.comment_count===1)).toBe(true);
  const leads=await request(app).get(`/api/acquisition/videos/${videos[0]}/leads`).set('Cookie',d.cookie);expect(leads.status).toBe(200);expect(leads.body.data.leads).toEqual([expect.objectContaining({commenter_id:'fixture-commenter-0',comment_text:'如何预约',grade:'精准'})]);
  expect((await request(app).get(`/api/acquisition/collect-tasks/${task}/videos`).set('Cookie',other.cookie)).status).toBe(404);
  expect((await request(app).get(`/api/acquisition/videos/${videos[0]}/leads`).set('Cookie',other.cookie)).status).toBe(404);
  const terminal=await request(app).post('/api/acquisition/collect/report').send({task_id:task,video_id:videos[0],commenters:[],terminal:'done'});expect(terminal.status).toBe(200);expect(terminal.body.data.ignored).toBe(true);
 });
 it('real judgment parsing writes matched to SQL and second request reuses cache without another paid provider call',async()=>{
  const d=await device();
  await pool.query('INSERT INTO zenithjoy.acquisition_config(tenant_id,target_profile_desc) VALUES($1,$2)',[d.tenant,'software operators']);
  const task=(await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,status) VALUES($1,'running') RETURNING id",[d.tenant])).rows[0].id;
  const video='7333333333333333333';await pool.query('INSERT INTO zenithjoy.acquisition_collect_videos(video_id,task_id,tenant_id,title) VALUES($1,$2,$3,$4)',[video,task,d.tenant,'fixture']);
  provider.mockReset().mockResolvedValue({data:{choices:[{finish_reason:'stop',message:{content:'MATCHED\n转写：软件运营工作流'}}]}});
  vi.stubEnv('TOAPIS_API_KEY','synthetic-fixture-only');
  try {
   const judge=()=>request(app).post('/api/acquisition/judge-video').set('x-agent-id',d.agent).send({video_id:video,capture_type:'audio',data_b64:'Zml4dHVyZQ=='});
   const first=await judge();expect(first.status).toBe(200);expect(first.body.data.judgment_status).toBe('matched');expect(provider).toHaveBeenCalledTimes(1);
   expect((await pool.query('SELECT judgment_status FROM zenithjoy.acquisition_collect_videos WHERE task_id=$1 AND video_id=$2',[task,video])).rows).toEqual([{judgment_status:'matched'}]);
   const second=await judge();expect(second.status).toBe(200);expect(second.body.data).toMatchObject({judgment_status:'matched',cache_hit:true});expect(provider).toHaveBeenCalledTimes(1);
  } finally {vi.unstubAllEnvs();}
 });
 it('retired dispatch creates no new work; existing dm receipts and history remain idempotent',async()=>{
  const d=await device();await pool.query("UPDATE zenithjoy.agents SET capabilities=ARRAY['android'] WHERE id=$1",[d.agent]);
  await pool.query("INSERT INTO zenithjoy.agent_platform_sessions(agent_id,platform,account_label,role,status,device_type,bound_at) VALUES($1,'douyin','fixture-dm','burner','active','android',now())",[d.agent]);
  const config=await request(app).put('/api/acquisition/config').set('Cookie',d.cookie).send({burner_count:1,dm_per_hour:10,dm_per_day:30,dm_active_start:'00:00',dm_active_end:'23:59',dm_interval_min_sec:1,dm_interval_max_sec:2,dm_message:'fixture message'});expect(config.status).toBe(200);
  const lead=(await pool.query("INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname,profile_url,douyin_id,relevance_score,outreach_eligible) VALUES($1,'fixture dm lead','https://www.douyin.com/user/fixture','fixture-dm-target',90,true) RETURNING id",[d.tenant])).rows[0].id;
  const build=await request(app).post('/api/acquisition/dispatch/build').set('Cookie',d.cookie).send({});expect(build.status).toBe(410);expect(build.body.error.code).toBe('LEGACY_ACQUISITION_RETIRED');
  const run=await request(app).post('/api/acquisition/dispatch/run').set('Cookie',d.cookie).send({});expect(run.status).toBe(410);expect(run.body.error.code).toBe('LEGACY_ACQUISITION_RETIRED');
  expect((await pool.query('SELECT id FROM zenithjoy.dm_assignments WHERE tenant_id=$1 AND lead_id=$2',[d.tenant,lead])).rows).toEqual([]);
  expect((await pool.query("SELECT id FROM zenithjoy.publish_tasks WHERE agent_id=$1 AND task_type='dm_outreach'",[d.agent])).rows).toEqual([]);
  // An already dispatched task can still report a terminal receipt after retirement.
  const assignment=(await pool.query("INSERT INTO zenithjoy.dm_assignments(tenant_id,lead_id,account_label,status) VALUES($1,$2,'fixture-dm','dispatched') RETURNING id",[d.tenant,lead])).rows[0];
  await pool.query("INSERT INTO zenithjoy.dm_outreach_log(tenant_id,account_label,lead_id,status,assignment_id) VALUES($1,'fixture-dm',$2,'dispatched',$3)",[d.tenant,lead,assignment.id]);
  const job=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','dm_outreach',$3::jsonb) RETURNING id",[d.agent,d.tenant,JSON.stringify({device_platform:'android',douyin_id:'fixture-dm-target',message:'fixture message',dm_assignment_id:assignment.id})])).rows[0];
  const result={task_id:job.id,agent_id:d.agent,account_label:'fixture-dm',status:'sent',dm_assignment_id:assignment.id};
  for(let i=0;i<2;i++)expect((await request(app).post('/api/agent/burner/dm-outreach-result').send(result)).status).toBe(200);
  expect((await pool.query('SELECT status FROM zenithjoy.dm_assignments WHERE id=$1',[assignment.id])).rows).toEqual([{status:'sent'}]);
  expect((await pool.query('SELECT status FROM zenithjoy.dm_outreach_log WHERE assignment_id=$1',[assignment.id])).rows).toEqual([{status:'sent'}]);
  const history=await request(app).get('/api/acquisition/dispatch/outreach-history').set('Cookie',d.cookie);expect(history.status).toBe(200);expect(history.body.data.items.some((r:any)=>r.id===assignment.id&&r.status==='sent')).toBe(true);
 });

 it('in-flight failed dm receipt persists all three diagnostic fields and repeat cannot overwrite them',async()=>{
  const d=await device();
  const lead=(await pool.query("INSERT INTO zenithjoy.acquisition_leads(tenant_id,nickname,profile_url) VALUES($1,'failure fixture','https://www.douyin.com/user/fixture') RETURNING id",[d.tenant])).rows[0].id;
  const assignment=(await pool.query("INSERT INTO zenithjoy.dm_assignments(tenant_id,lead_id,account_label,status) VALUES($1,$2,'fixture-dm','dispatched') RETURNING id",[d.tenant,lead])).rows[0].id;
  await pool.query("INSERT INTO zenithjoy.dm_outreach_log(tenant_id,account_label,lead_id,status,assignment_id) VALUES($1,'fixture-dm',$2,'dispatched',$3)",[d.tenant,lead,assignment]);
  const task=(await pool.query("INSERT INTO zenithjoy.publish_tasks(agent_id,tenant_id,platform,status,task_type,payload) VALUES($1,$2,'douyin','queued','dm_outreach',$3::jsonb) RETURNING id",[d.agent,d.tenant,JSON.stringify({account_label:'fixture-dm',dm_assignment_id:assignment})])).rows[0].id;
  const body={task_id:task,agent_id:d.agent,account_label:'fixture-dm',status:'failed',dm_assignment_id:assignment,error_code:'NO_SEARCH_INPUT',foreground_pkg:'fixture.foreground',failure_diag:'fixture diagnosis'};
  const first=await request(app).post('/api/agent/burner/dm-outreach-result').send(body);expect(first.status).toBe(200);
  const read=async()=>(await pool.query('SELECT status,error_code,foreground_pkg,failure_diag FROM zenithjoy.dm_outreach_log WHERE assignment_id=$1',[assignment])).rows;
  const expected=[{status:'failed',error_code:'NO_SEARCH_INPUT',foreground_pkg:'fixture.foreground',failure_diag:'fixture diagnosis'}];
  expect(await read()).toEqual(expected);
  const repeat=await request(app).post('/api/agent/burner/dm-outreach-result').send({...body,status:'sent',error_code:'CHANGED',foreground_pkg:'other',failure_diag:'overwritten'});expect(repeat.status).toBe(200);
  expect(await read()).toEqual(expected);
 });

});

it('orphan legacy license fails with an actionable 4xx and creates no partial machine binding',async()=>{
 const created=await request(app).post('/api/admin/license').set('X-Internal-Token',process.env.ZENITHJOY_INTERNAL_TOKEN!).send({tier:'basic'});expect(created.status).toBe(200);
 const license=created.body.data;await pool.query('UPDATE zenithjoy.licenses SET tenant_id=NULL WHERE id=$1',[license.id]);
 const result=await request(app).post('/api/agent/register').send({license_key:license.license_key,machine_id:randomUUID()});expect(result.status).toBe(403);expect(result.body.code).toBe('LICENSE_NO_TENANT');
 expect((await pool.query('SELECT id FROM zenithjoy.license_machines WHERE license_id=$1',[license.id])).rows).toEqual([]);
});

it('manual history default production router authenticates a real cookie, confirms once and rejects foreign readers',async()=>{
 const d=await device(),cs=await bindCs(d),alien=await account();
 const customer=(await pool.query("INSERT INTO zenithjoy.crm_customers(tenant_id,cs_wechat_id,contact) VALUES($1,$2,'manual fixture') RETURNING id",[d.tenant,cs])).rows[0].id;
 const analysis={summary:'客户需要样品',needs:[],quotes:[],commitments:[],next_actions:[],uncertainties:['历史时间未知']};model.mockResolvedValue({content:JSON.stringify(analysis)});
 const body={customer_id:String(customer),cs_wechat_id:cs,source_type:'group',channel_name:'合成业务群',text:'客户：需要100件样品。'};
 expect((await request(app).post('/api/crm/manual-history/preview').set('X-User-Email','fixture@example.test').send(body)).status).toBe(401);
 const preview=await request(app).post('/api/crm/manual-history/preview').set('Cookie',d.cookie).send(body);expect(preview.status).toBe(200);
 const commit={customer_id:String(customer),cs_wechat_id:cs,preview_id:preview.body.preview.id,preview_version:preview.body.preview.version,request_id:randomUUID(),confirmed_result:analysis};
 const results=await Promise.all([0,1].map(()=>request(app).post('/api/crm/manual-history/commit').set('Cookie',d.cookie).send(commit)));for(const r of results)expect(r.status).toBe(200);expect(results[0].body.record.id).toBe(results[1].body.record.id);
 const record=results[0].body.record;expect(record).toMatchObject({created_by:d.userId,raw_text:body.text});
 const read=`/api/crm/manual-history/${record.id}?customer_id=${customer}&cs_wechat_id=${cs}`;
 expect((await request(app).get(read).set('Cookie',d.cookie)).body.record.raw_text).toBe(body.text);expect((await request(app).get(read).set('Cookie',alien.cookie)).status).toBe(404);
 expect((await pool.query('SELECT id FROM zenithjoy.crm_manual_history_imports WHERE tenant_id=$1',[d.tenant])).rows).toHaveLength(1);
});

it('real SSE sends the persisted own-task state; anonymous, malformed and foreign subscriptions fail closed',async()=>{
 const {listenLoopback,closeLoopback}=await import('../../helpers/loopback-server');
 const d=await device(),other=await account();
 const task=(await pool.query("INSERT INTO zenithjoy.acquisition_collect_tasks(tenant_id,status,video_count,lead_count_raw) VALUES($1,'running',3,2) RETURNING id",[d.tenant])).rows[0].id;
 expect((await request(app).get(`/api/acquisition/collect/${task}/sse`)).status).toBe(401);
 expect((await request(app).get('/api/acquisition/collect/not-a-uuid/sse').set('Cookie',d.cookie)).status).toBe(400);
 expect((await request(app).get(`/api/acquisition/collect/${task}/sse`).set('Cookie',other.cookie)).status).toBe(404);
 const server=await listenLoopback(app),controller=new AbortController();
 try {
  const address=server.address();if(!address||typeof address==='string')throw new Error('missing loopback address');
  const response=await fetch(`http://127.0.0.1:${address.port}/api/acquisition/collect/${task}/sse`,{headers:{Cookie:d.cookie.map(v=>v.split(';')[0]).join('; ')},signal:controller.signal});
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader=response.body!.getReader();const first=await reader.read();const wire=new TextDecoder().decode(first.value);expect(wire).toContain('data:');expect(wire).toContain(task);expect(wire).toContain('"video_count":3');expect(wire).toContain('"lead_count_raw":2');
  controller.abort();await reader.cancel().catch(()=>{});
 } finally {controller.abort();await closeLoopback(server);}
});

it('paid license signup links the existing tenant and account identity, without silently creating a free customer',async()=>{
 const paid=await request(app).post('/api/admin/license').set('X-Internal-Token',process.env.ZENITHJOY_INTERNAL_TOKEN!).send({tier:'matrix'});expect(paid.status).toBe(200);
 const license=paid.body.data;
 const signup=await request(app).post('/api/auth/sign-up/email').send({email:`paid-${randomUUID()}@example.test`,password:'Local-test-password-123',name:'Paid fixture',license_key:license.license_key});expect(signup.status).toBe(200);
 const me=await request(app).get('/api/account/me').set('Cookie',signup.headers['set-cookie']);expect(me.status).toBe(200);expect(me.body.license).toMatchObject({license_key:license.license_key,tier:'matrix',max_machines:3});
 const rows=(await pool.query('SELECT tenant_id,customer_id FROM zenithjoy.licenses WHERE customer_id=$1',[signup.body.user.id])).rows;expect(rows).toHaveLength(1);expect(rows[0].customer_id).toBe(signup.body.user.id);
 expect((await pool.query('SELECT tenant_id,role FROM zenithjoy.tenant_members WHERE feishu_user_id=$1',[signup.body.user.id])).rows).toEqual([{tenant_id:rows[0].tenant_id,role:'owner'}]);
});

it('moment generation persists both tenants independently and never reports success after database rejection',async()=>{
 const {generateMomentDraft}=await import('../../../src/services/wechat-draft');
 const owners=[await account(),await account()];model.mockResolvedValue({content:'合成朋友圈草稿'});
 for(const owner of owners)await pool.query("INSERT INTO zenithjoy.wechat_marketing_profile(tenant_id,customer,industry,audience,hook) VALUES($1,'same-fixture-customer','software','operators','fixture-hook')",[owner.tenant]);
 for(const owner of owners){const result=await generateMomentDraft({customer:'same-fixture-customer',tenant_id:owner.tenant});expect(result.ok).toBe(true);}
 expect((await pool.query("SELECT tenant_id FROM zenithjoy.wechat_publish_task WHERE target_user='same-fixture-customer' ORDER BY tenant_id")).rows).toHaveLength(2);
 const duplicate=await generateMomentDraft({customer:'same-fixture-customer',tenant_id:owners[0].tenant});expect(duplicate).toEqual({ok:false,reason:'already_generated_today'});
 await pool.query("INSERT INTO zenithjoy.wechat_marketing_profile(tenant_id,customer,industry,audience,hook) VALUES($1,'rejected-fixture-customer','software','operators','fixture-hook')",[owners[0].tenant]);
 await pool.query(`CREATE FUNCTION zenithjoy.reject_fixture_moment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.target_user='rejected-fixture-customer' THEN RAISE EXCEPTION 'injected fixture insert failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_fixture_moment BEFORE INSERT ON zenithjoy.wechat_publish_task FOR EACH ROW EXECUTE FUNCTION zenithjoy.reject_fixture_moment()`);
 try{const rejected=await generateMomentDraft({customer:'rejected-fixture-customer',tenant_id:owners[0].tenant});expect(rejected).toEqual({ok:false,reason:'persist_failed'});}finally{await pool.query('DROP TRIGGER reject_fixture_moment ON zenithjoy.wechat_publish_task;DROP FUNCTION zenithjoy.reject_fixture_moment()');}
});


it('shared friend-scan API persists exact detail fields and all twelve contacts without a UI-scroll claim',async()=>{
 const d=await device(),cs=await bindCs(d),alien=await device();
 const contacts=Array.from({length:12},(_,i)=>({name:`detail-fixture-${i.toString().padStart(2,'0')}`,wechat_id:`wx-detail-${i}`,add_friend_time:i===0?'2026-03-12T00:00:00Z':undefined,last_message:`message-${i}`}));
 expect((await request(app).post('/api/crm/friend-scan/ingest').send({cs_wechat_id:cs,contacts})).status).toBe(401);
 expect((await request(app).post('/api/crm/friend-scan/ingest').set('X-License-Key',alien.key).send({cs_wechat_id:cs,contacts})).status).toBe(403);
 const response=await request(app).post('/api/crm/friend-scan/ingest').set('X-License-Key',d.key).send({cs_wechat_id:cs,contacts});expect(response.status).toBe(200);expect(response.body).toMatchObject({success:true,ingested:12,scanned_count:12});
 const stored=(await pool.query('SELECT contact,wechat_id,add_friend_time,last_message,source FROM zenithjoy.crm_customers WHERE tenant_id=$1 AND cs_wechat_id=$2 ORDER BY contact',[d.tenant,cs])).rows;expect(stored).toHaveLength(12);
 for(const [i,row] of stored.entries()){expect(row).toMatchObject({contact:contacts[i].name,wechat_id:contacts[i].wechat_id,last_message:contacts[i].last_message,source:'scan'});expect(row.add_friend_time?new Date(row.add_friend_time).toISOString():null).toBe(i===0?'2026-03-12T00:00:00.000Z':null);}
 const roster=await request(app).get(`/api/crm/customers?cs_wechat_id=${cs}`).set('Cookie',d.cookie);expect(roster.status).toBe(200);expect(roster.body.customers).toHaveLength(12);expect(roster.body.customers.find((r:any)=>r.contact===contacts[0].name)).toMatchObject({wechat_id:'wx-detail-0',add_friend_time:'2026-03-12T00:00:00.000Z'});
});

it('legacy skill draft lifecycle persists running/pause/token rotation/done with an isolated local child process',async()=>{
 vi.stubEnv('STAFF_EMAILS','fixture-staff@example.test');
 const staff={'X-User-Email':'fixture-staff@example.test'};
 try{
  expect((await request(app).post('/api/staff/skill-drafts').send({})).status).toBe(403);
  const created=await request(app).post('/api/staff/skill-drafts').set(staff).send({});expect(created.status).toBe(201);const id=created.body.data.id;
  await vi.waitFor(async()=>expect((await pool.query('SELECT status FROM zenithjoy.skill_drafts WHERE id=$1',[id])).rows).toEqual([{status:'chatting'}]));
  const start=await request(app).post(`/api/staff/skill-drafts/${id}/generate`).set(staff).send({});expect(start.status).toBe(200);expect(start.body.data.status).toBe('running');
  expect((await request(app).post(`/api/staff/skill-drafts/${id}/generate`).set(staff).send({})).status).toBe(409);
  let token:string='';await vi.waitFor(async()=>{const r=(await pool.query('SELECT status,callback_token FROM zenithjoy.skill_drafts WHERE id=$1',[id])).rows[0];expect(r.status).toBe('running');expect(r.callback_token).toMatch(/^[a-f0-9-]{36}$/);token=r.callback_token;});
  const callback=(body:object)=>request(app).post(`/internal/skill-drafts/${id}/callback`).send(body);
  expect((await callback({token:randomUUID(),event:'done',zip_path:'/tmp/fixture.zip'})).status).toBe(400);
  expect((await callback({token,event:'invalid_fixture_event'})).status).toBe(400);
  const paused=await callback({token,event:'needs_input',question:'fixture question'});expect(paused.status).toBe(200);
  await vi.waitFor(async()=>expect((await pool.query('SELECT status,pending_question,callback_token FROM zenithjoy.skill_drafts WHERE id=$1',[id])).rows).toEqual([{status:'needs_input',pending_question:'fixture question',callback_token:null}]));
  expect((await callback({token,event:'done'})).status).toBe(400);
  const answer=await request(app).post(`/api/staff/skill-drafts/${id}/answer`).set(staff).send({answer:'fixture answer'});expect(answer.status).toBe(200);
  let nextToken='';await vi.waitFor(async()=>{const r=(await pool.query('SELECT status,callback_token,messages_json FROM zenithjoy.skill_drafts WHERE id=$1',[id])).rows[0];expect(r.status).toBe('running');expect(r.callback_token).not.toBe(token);nextToken=r.callback_token;expect(r.messages_json).toEqual([{role:'user',content:'fixture answer'}]);});
  const done=await callback({token:nextToken,event:'done',zip_path:'/tmp/fixture-only.zip'});expect(done.status).toBe(200);
  await vi.waitFor(async()=>expect((await pool.query('SELECT status,callback_token,result_json FROM zenithjoy.skill_drafts WHERE id=$1',[id])).rows).toEqual([{status:'done',callback_token:null,result_json:{zip_path:'/tmp/fixture-only.zip'}}]));
  expect((await request(app).post(`/api/staff/skill-drafts/${id}/generate`).set(staff).send({})).status).toBe(409);
  expect(childCalls).toHaveLength(2);for(const call of childCalls)expect(call.options).toMatchObject({detached:true});await Promise.all(childCalls.map(c=>c.closed));
 }finally{vi.unstubAllEnvs();}
});

it('license register plus current WebSocket hello resolver reuses the exact existing UUID',async()=>{
 const d=await device();const {resolveAgentUuidFromHello}=await import('../../../src/services/agent-ws');
 const resolved=await resolveAgentUuidFromHello({agentId:`different-display-${randomUUID()}`,agentUuid:d.agent,capabilities:['douyin'],version:'1.0.1',tenantId:d.tenant});
 expect(resolved).toBe(d.agent);expect((await pool.query('SELECT id FROM zenithjoy.agents WHERE tenant_id=$1',[d.tenant])).rows).toEqual([{id:d.agent}]);
});

it('legacy skill draft soft timeout and error callbacks persist explicit recoverable error states',async()=>{
 vi.stubEnv('STAFF_EMAILS','fixture-staff@example.test');
 try{
  const stale=randomUUID();await pool.query("INSERT INTO zenithjoy.skill_drafts(id,status,callback_token,updated_at) VALUES($1,'running',$2,now()-interval '3 hours')",[stale,randomUUID()]);
  const read=await request(app).get(`/api/staff/skill-drafts/${stale}`).set('X-User-Email','fixture-staff@example.test');expect(read.status).toBe(200);expect(read.body.data.status).toBe('error');expect(read.body.data.result_json.error_message).toContain('超时');
  await vi.waitFor(async()=>expect((await pool.query('SELECT status FROM zenithjoy.skill_drafts WHERE id=$1',[stale])).rows).toEqual([{status:'error'}]));
  const failed=randomUUID(),token=randomUUID();await pool.query("INSERT INTO zenithjoy.skill_drafts(id,status,callback_token) VALUES($1,'running',$2)",[failed,token]);
  const callback=await request(app).post(`/internal/skill-drafts/${failed}/callback`).send({token,event:'error',error_message:'isolated worker failure'});expect(callback.status).toBe(200);
  await vi.waitFor(async()=>expect((await pool.query('SELECT status,result_json,callback_token FROM zenithjoy.skill_drafts WHERE id=$1',[failed])).rows).toEqual([{status:'error',result_json:{error_message:'isolated worker failure'},callback_token:null}]));
 }finally{vi.unstubAllEnvs();}
});
