import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';import request from 'supertest';import {createServer,type Server} from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';
import {loadOrInitConfig} from '../../../../../services/agent/src/config-loader';
// Session is an isolated identity boundary. Actual application mounts, SQL, env burner and webhook transport execute.
vi.mock('../../../src/auth',()=>({auth:{api:{getSession:async({headers}:{headers:Headers})=>{const id=headers.get('cookie')?.match(/user=([^;]+)/)?.[1];return id?{user:{id,email:id+'@example.test'}}:null;}}}}));
import app from '../../../src/app';import pool from '../../../src/db/connection';import {_resetAlertedMap} from '../../../src/services/agent-offline-monitor';import {verifyStartupConfig,REQUIRED_ENV_GROUPS} from '../../../src/startup-check';
let webhook:Server;let webhookStatus=200;const captures:any[]=[];let webhookUrl:string;
beforeAll(async()=>{
 if(!process.env.DATABASE_HOST?.startsWith('/tmp/zj-media-'))throw new Error('requires disposable PostgreSQL harness');
 await pool.query(`CREATE SCHEMA zenithjoy;CREATE TABLE zenithjoy.licenses(id uuid DEFAULT gen_random_uuid(),license_key text,customer_id text,status text,created_at timestamptz DEFAULT now());CREATE TABLE zenithjoy.agents(agent_id text PRIMARY KEY,hostname text,platform text,status text,updated_at timestamptz);INSERT INTO zenithjoy.licenses(license_key,customer_id,status)VALUES('fixture-personal-a','alice','active'),('fixture-personal-b','bob','active');`);
 webhook=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;captures.push(JSON.parse(body));res.statusCode=webhookStatus;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});await new Promise<void>(r=>webhook.listen(0,'127.0.0.1',r));webhookUrl=`http://127.0.0.1:${(webhook.address()as any).port}/webhook`;
 vi.stubEnv('FEISHU_ALERT_WEBHOOK',webhookUrl);
});
afterEach(()=>{vi.unstubAllEnvs();vi.stubEnv('FEISHU_ALERT_WEBHOOK',webhookUrl);});
afterAll(async()=>{vi.unstubAllEnvs();await pool.end();await new Promise<void>(r=>webhook.close(()=>r()));});
describe('actual mounted startup health and explicit complete DB fixture',()=>{
 it.each(['/health','/api/health'])('uses production mount %s with positive and missing-key negative config',async path=>{
  vi.stubEnv('TOAPI_API_KEY','fixture-not-a-real-key');vi.stubEnv('BETTER_AUTH_SECRET','fixture-secret-'.repeat(4));
  const complete=await request(app).get(path);expect(complete.status).toBe(200);expect(complete.body.config).toEqual({ok:true,missing:[]});
  vi.stubEnv('TOAPI_API_KEY','');const missing=await request(app).get(path);expect(missing.status).toBe(200);expect(missing.body.config.ok).toBe(false);expect(missing.body.config.missing).toContain('TOAPI_API_KEY');expect(JSON.stringify(missing.body)).not.toContain('fixture-secret-');
 });
 it('keeps both DB alternatives and rejects a missing or half-configured group',()=>{
  const required={TOAPI_API_KEY:'fixture',BETTER_AUTH_SECRET:'fixture'};const group=REQUIRED_ENV_GROUPS[0].label;
  expect(verifyStartupConfig({...required,DATABASE_URL:'postgres://isolated/socket'}).ok).toBe(true);
  expect(verifyStartupConfig({...required,DATABASE_HOST:process.env.DATABASE_HOST,DATABASE_NAME:'postgres'}).ok).toBe(true);
  expect(verifyStartupConfig({...required,DATABASE_HOST:process.env.DATABASE_HOST}).missing).toContain(group);expect(verifyStartupConfig(required).missing).toContain(group);
 });
});
describe('actual mounted device command bridge guard',()=>{
 it('uses mounted production route and rejects missing token before dispatch',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN','');
  const result=await request(app).post('/api/devices/11111111-1111-4111-8111-111111111111/actions').send({action:'device_info'});expect(result.status).toBe(503);expect(result.body.error).toBe('SERVICE_UNAVAILABLE');
  expect((await request(app).post('/api/devices/not-uuid/actions').send({action:'device_info'})).status).toBe(400);
 });
});
describe('actual personal dotenv burn uses the current account and explicit environment',()=>{
 it.each([['https://staging.example.test','wss://staging.example.test/agent-ws','staging','alice','fixture-personal-a'],['https://api.example.test','wss://api.example.test/agent-ws','prod','bob','fixture-personal-b']])('burns %s and account license without leaking it in logs',async(base,ws,environment,user,license)=>{
  const directory=await mkdtemp('/tmp/zj-personal-env-');vi.stubEnv('APPDATA',directory);
  vi.stubEnv('AGENT_PUBLIC_BASE_URL',base);vi.stubEnv('AGENT_PUBLIC_WS_URL',ws);const log=vi.spyOn(console,'log'),warn=vi.spyOn(console,'warn'),error=vi.spyOn(console,'error');
  try{const result=await request(app).get('/api/agent/install-pack/dotenv').set('Cookie',`user=${user}`).timeout({response:2000,deadline:3000});expect(result.status).toBe(200);const parsed=Object.fromEntries(result.text.trim().split('\n').map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)];}));expect(parsed).toEqual({ZENITHJOY_LICENSE:license,ZENITHJOY_API_BASE:base,ZENITHJOY_API_URL:ws,ZENITHJOY_ENV:environment});for(const[key,value]of Object.entries(parsed))vi.stubEnv(key,String(value));expect(loadOrInitConfig()).toMatchObject({licenseKey:license,apiUrl:ws});expect(JSON.stringify([...log.mock.calls,...warn.mock.calls,...error.mock.calls])).not.toContain(license);}finally{log.mockRestore();warn.mockRestore();error.mockRestore();await rm(directory,{recursive:true,force:true});}
 });
 it('the real shared config consumer refuses a personal env lacking both connection URLs',async()=>{
  const directory=await mkdtemp('/tmp/zj-personal-env-');vi.stubEnv('APPDATA',directory);vi.stubEnv('ZENITHJOY_LICENSE','fixture-personal-a');vi.stubEnv('ZENITHJOY_API_URL','');vi.stubEnv('ZENITHJOY_API_BASE','');
  try{expect(()=>loadOrInitConfig()).toThrow(/apiUrl/);}finally{await rm(directory,{recursive:true,force:true});}
 });
 it('anonymous and unlicensed accounts have exact errors without returning another account credential',async()=>{
  expect((await request(app).get('/api/agent/install-pack/dotenv')).status).toBe(401);const missing=await request(app).get('/api/agent/install-pack/dotenv').set('Cookie','user=nobody');expect(missing.status).toBe(503);expect(missing.body.code).toBe('NO_ACTIVE_LICENSE');expect(missing.text).not.toContain('fixture-personal');
 });
});
describe('offline alert scans only isolated SQL fixture and loopback webhook',()=>{
 const scan=(url=webhookUrl)=>request(app).post('/api/internal/agent-offline-scan').send({threshold_hours:4,webhook_override:url}).timeout({response:3000,deadline:5000});
 it('sends one alert for stale Windows agent, dedupes while stale, then sends one recovery',async()=>{
  _resetAlertedMap();captures.length=0;await pool.query("INSERT INTO zenithjoy.agents VALUES('fixture-agent','isolated-host','windows','online',now()-interval '5 hours'),('fresh','fresh-host','windows','online',now()),('android','android-host','android','online',now()-interval '5 hours')");
  const first=await scan();expect(first.status).toBe(200);expect(first.body.success).toBe(true);expect(first.body.data.alerted).toHaveLength(1);expect(first.body.data.alerted[0]).toMatchObject({agent_id:'fixture-agent',hostname:'isolated-host',offline_duration_minutes:300});expect(captures).toHaveLength(1);expect(captures[0].content.text).toMatch(/isolated-host.*fixture-agent.*300 分钟/);
  const duplicate=await scan();expect(duplicate.body.data.alerted).toEqual([]);expect(captures).toHaveLength(1);
  await pool.query("UPDATE zenithjoy.agents SET updated_at=now() WHERE agent_id='fixture-agent'");const recovered=await scan();expect(recovered.body.data.recovered).toHaveLength(1);expect(captures).toHaveLength(2);expect(captures[1].content.text).toContain('已恢复');expect((await scan()).body.data.recovered).toEqual([]);expect(captures).toHaveLength(2);
 });
 it('refused webhook reports exact agent send_errors as JSON and remains retryable',async()=>{
  _resetAlertedMap();await pool.query("UPDATE zenithjoy.agents SET updated_at=now()-interval '5 hours' WHERE agent_id='fixture-agent'");
  const closed=createServer();await new Promise<void>(r=>closed.listen(0,'127.0.0.1',r));const port=(closed.address()as any).port;await new Promise<void>(r=>closed.close(()=>r()));
  const failure=await scan(`http://127.0.0.1:${port}/refused`);expect(failure.status).toBe(200);expect(failure.headers['content-type']).toContain('application/json');expect(failure.body.success).toBe(false);expect(failure.body.data.alerted).toEqual([]);expect(failure.body.data.send_errors).toEqual([{agent_id:'fixture-agent',hostname:'isolated-host',error:expect.any(String)}]);expect(failure.body.data.send_errors[0].error).toMatch(/fetch failed|ECONNREFUSED/);
  expect((await scan()).body.data.alerted.map((a:any)=>a.agent_id)).toEqual(['fixture-agent']);
 });
 it('webhook HTTP 503 cannot be counted as a successful alert',async()=>{
  _resetAlertedMap();webhookStatus=503;
  try{const result=await scan();expect(result.status).toBe(200);expect(result.body.success).toBe(false);expect(result.body.data.alerted).toEqual([]);expect(result.body.data.send_errors[0]).toMatchObject({agent_id:'fixture-agent',error:expect.stringContaining('503')});}finally{webhookStatus=200;}
 });

});
