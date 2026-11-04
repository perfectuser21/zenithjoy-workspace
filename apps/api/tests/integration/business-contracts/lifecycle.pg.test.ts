import './setup-env';
import { afterAll, describe, expect, it } from 'vitest';
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
