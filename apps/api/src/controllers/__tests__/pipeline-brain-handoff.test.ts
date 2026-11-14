import { simpleRateLimit, ipKeyFn } from '../../middleware/simple-rate-limit';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));
vi.mock('../../db/connection',()=>({default:mocks}));
import {PipelineController} from '../pipeline.controller';
const ID='11111111-1111-4111-8111-111111111111', TASK='22222222-2222-4222-8222-222222222222';
const row={id:ID,content_type:'solo-company-case',topic:'案例',topic_id:null,status:'pending',output_dir:'/tmp/owned-output',output_manifest:null};
const app=()=>{const a=express();a.use(express.json());a.use(simpleRateLimit({windowMs:60000,max:240,keyFn:ipKeyFn}));const c=new PipelineController();a.post('/trigger',c.trigger);a.post('/:id/rerun',c.rerun);if(c.capabilities)a.get('/capabilities',c.capabilities);a.get('/',c.list);return a;};
beforeEach(()=>{vi.restoreAllMocks();mocks.query.mockReset();mocks.connect.mockReset();mocks.connect.mockResolvedValue({query:vi.fn(async(sql:string,args?:unknown[])=>{if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {};if(sql.includes('FROM zenithjoy.topics'))return {rows:[{id:ID,notebook_id:null}]};if(sql.includes('FROM zenithjoy.pipeline_runs'))return {rows:[]};return mocks.query(sql,args);}),release:vi.fn()});});
describe('内容业务本地拥有，Brain仅统一工作单',()=>{
 it('Brain不可达不能伪报成功或发布可执行running',async()=>{
  vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));mocks.query.mockResolvedValue({rows:[row]});
  const r=await request(app()).post('/trigger').send({content_type:'solo-company-case',topic:'案例',topic_id:ID});
  expect(r.status).toBe(502);expect(r.body.success).toBe(false);expect(mocks.query.mock.calls.some(([s])=>s.includes("status = 'running'"))).toBe(false);
 });
 it('有效挂号返回pending等待认领，不伪造派发完成',async()=>{
  const f=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({id:TASK,payload:{zenithjoy_pipeline_run_id:ID}})} as Response);
  mocks.query.mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{...row,cecelia_task_id:TASK}]});
  const r=await request(app()).post('/trigger').send({content_type:'solo-company-case',topic:'案例',topic_id:ID});
  expect(r.status).toBe(201);expect(r.body.data.status).toBe('pending');expect(r.body.data.cecelia_task_id).toBe(TASK);
  expect(f.mock.calls[0][0]).toMatch(/\/api\/brain\/tasks$/);
 });
 it('畸形Brain回执不能发布运行',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({success:true})} as Response);mocks.query.mockResolvedValue({rows:[row]});
  const r=await request(app()).post('/trigger').send({content_type:'solo-company-case',topic_id:ID});
  expect(r.status).toBe(502);
 });
 it('本地列表不再访问Brain专属内容接口',async()=>{
  const f=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unexpected network'));mocks.query.mockResolvedValue({rows:[row]});
  const r=await request(app()).get('/');expect(r.status).toBe(200);expect(r.body[0].id).toBe(ID);expect(f).not.toHaveBeenCalled();
 });
 it('能力仅描述实际固定六阶段，不迁旧prompt配置引擎',async()=>{
  const r=await request(app()).get('/capabilities');expect(r.status).toBe(200);expect(r.body.content_type).toBe('solo-company-case');expect(r.body.stages).toEqual(['research','copywriting','copy_review','generate','image_review','export']);expect(r.body.notebook_source).toBe('topic');
 });
});

it('挂号未知回执提供同run恢复入口而不是新建并自启动',async()=>{
 vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('connection reset'));
 mocks.query.mockResolvedValue({rows:[row]});
 const r=await request(app()).post('/trigger').send({content_type:'solo-company-case',topic_id:ID});
 expect(r.status).toBe(502);expect(r.body.error.details).toEqual({pipeline_run_id:ID,registration_status:'unknown'});
 expect(mocks.query.mock.calls.at(-1)?.[1]).toEqual(['pending','unknown',ID]);
 const insert=mocks.query.mock.calls.find(([sql])=>sql.startsWith('INSERT'));
 expect(String(insert?.[1][3])).toMatch(/\/runs\/[0-9a-f-]{36}$/);
});
it('同run重试挂号使用已有记录并不再次INSERT',async()=>{
 const c=new PipelineController();const a=express();a.use(express.json());a.use(simpleRateLimit({windowMs:60000,max:240,keyFn:ipKeyFn}));a.post('/:id/register',c.register);
 mocks.query.mockResolvedValueOnce({rows:[row]}).mockResolvedValueOnce({rows:[{...row,cecelia_task_id:TASK}]});
 vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({id:TASK,payload:{zenithjoy_pipeline_run_id:ID}})} as Response);
 const r=await request(a).post(`/${ID}/register`).send({});
 expect(r.status).toBe(201);expect(r.body.data.cecelia_task_id).toBe(TASK);expect(mocks.query.mock.calls.every(([sql])=>!sql.startsWith('INSERT'))).toBe(true);
});
it('rerun在远端挂号前COMMIT新隔离意图，未知时仍保留同run',async()=>{
 const next={...row,id:'33333333-3333-4333-8333-333333333333',triggered_by:`rerun:${ID}`};const order:string[]=[];
 const query=vi.fn(async(sql:string)=>{order.push(sql);if(sql.startsWith('SELECT *')&&sql.includes('FOR UPDATE'))return {rows:[{...row,status:'failed'}]};if(sql.startsWith('SELECT *'))return {rows:[]};if(sql.startsWith('INSERT'))return {rows:[next]};return {rows:[]};});
 mocks.connect.mockResolvedValue({query,release:vi.fn()});mocks.query.mockResolvedValue({rows:[]});
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{expect(order.at(-1)).toBe('COMMIT');throw new Error('lost response');});
 const r=await request(app()).post(`/${ID}/rerun`).send({});expect(r.status).toBe(502);expect(r.body.error.details.pipeline_run_id).toBe(next.id);
 const insert=(query.mock.calls as unknown[][]).find(([sql])=>String(sql).startsWith('INSERT'))!;expect(String(insert[1])).not.toContain('/tmp/owned-output');
 expect(order.filter(s=>s==='COMMIT')).toHaveLength(1);
});

// Exercise production routers and their shared per-IP budget over real HTTP.
afterEach(() => vi.unstubAllEnvs());
it('内容路由正常读库，超过共享240次预算后拒绝写入且不再触及DB', async () => {
 const {default:router}=await import('../../routes/pipeline');
 const server=express().use(express.json()).use(router);
 mocks.query.mockResolvedValue({rows:[]});
 for(let i=0;i<240;i++) expect((await request(server).get('/')).status).toBe(200);
 const count=mocks.query.mock.calls.length;
 const blocked=await request(server).post(`/${ID}/rerun`).send({});
 expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe('RATE_LIMITED');
 expect(blocked.headers['retry-after']).toBeDefined();expect(mocks.query).toHaveBeenCalledTimes(count);
 expect(mocks.connect).not.toHaveBeenCalled();
},15000);
it('worker独立600次预算覆盖鉴权失败和合法调用，超限不执行claim', async () => {
 vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN','isolated-pipeline-rate-limit');
 const {default:router}=await import('../../routes/pipelines-worker');
 const server=express().use(express.json()).use(router);
 mocks.query.mockResolvedValue({rows:[]});
 expect((await request(server).get('/running').auth('isolated-pipeline-rate-limit',{type:'bearer'})).status).toBe(200);
 for(let i=1;i<600;i++) expect((await request(server).get('/running')).status).toBe(401);
 const blocked=await request(server).post(`/${ID}/claim`).auth('isolated-pipeline-rate-limit',{type:'bearer'}).send({});
 expect(blocked.status).toBe(429);expect(blocked.body.error.code).toBe('RATE_LIMITED');
 expect(blocked.headers['retry-after']).toBeDefined();expect(mocks.query).toHaveBeenCalledTimes(1);
 expect(mocks.connect).not.toHaveBeenCalled();
},15000);
