import { simpleRateLimit, ipKeyFn } from '../../middleware/simple-rate-limit';
import {beforeEach,expect,it,vi} from 'vitest';import express from 'express';import request from 'supertest';
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));vi.mock('../../db/connection',()=>({default:m}));
import {PipelineController} from '../pipeline.controller';
const TOPIC='11111111-1111-4111-8111-111111111111',RUN='22222222-2222-4222-8222-222222222222',TASK='33333333-3333-4333-8333-333333333333';
function app(){const a=express();a.use(express.json());a.use(simpleRateLimit({windowMs:60000,max:240,keyFn:ipKeyFn}));a.post('/trigger',new PipelineController().trigger);return a;}
beforeEach(()=>{vi.restoreAllMocks();m.query.mockReset();m.connect.mockReset();});
it('同topic完全丢失HTTP回执后重发仍恢复同run，先提交本地意图才访问Brain',async()=>{
 let existing:Record<string,unknown>|null=null;const order:string[]=[];let inserted=0;
 const query=vi.fn(async(sql:string)=>{order.push(sql);if(sql.includes('FROM zenithjoy.topics'))return {rows:[{id:TOPIC,notebook_id:'book'}]};if(sql.includes('FROM zenithjoy.pipeline_runs'))return {rows:existing?[existing]:[]};if(sql.startsWith('INSERT')){inserted++;existing={id:RUN,topic_id:TOPIC,status:'pending',content_type:'solo-company-case'};return {rows:[existing]};}return {rows:[]};});
 m.connect.mockResolvedValue({query,release:vi.fn()});m.query.mockResolvedValue({rows:[]});
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{expect(order.at(-1)).toBe('COMMIT');throw new Error('response lost');});
 const body={content_type:'solo-company-case',topic_id:TOPIC};
 const first=await request(app()).post('/trigger').send(body);const second=await request(app()).post('/trigger').send(body);
 expect(first.status).toBe(502);expect(second.status).toBe(502);expect(second.body.error.details.pipeline_run_id).toBe(RUN);expect(inserted).toBe(1);
 expect(fetch.mock.calls.map(([,o])=>JSON.parse(String(o?.body)).source_id)).toEqual([`zenithjoy:pipeline:${RUN}`,`zenithjoy:pipeline:${RUN}`]);
 expect(order.filter(x=>x.includes('FOR UPDATE')).every(x=>x.includes('FROM zenithjoy.topics'))).toBe(true);
});
it('已有已运行或已终态工作单只读回，不创建新工作单或再次Brain挂号',async()=>{
 const query=vi.fn(async(sql:string)=>sql.includes('FROM zenithjoy.topics')?{rows:[{id:TOPIC}]}:sql.includes('FROM zenithjoy.pipeline_runs')?{rows:[{id:RUN,topic_id:TOPIC,status:'running',cecelia_task_id:TASK}]}:{rows:[]});m.connect.mockResolvedValue({query,release:vi.fn()});const f=vi.spyOn(globalThis,'fetch');
 const r=await request(app()).post('/trigger').send({topic_id:TOPIC,content_type:'solo-company-case'});expect(r.status).toBe(200);expect(r.body.data.status).toBe('running');expect(f).not.toHaveBeenCalled();expect(query.mock.calls.some(([s])=>s.startsWith('INSERT'))).toBe(false);
});
it('缺少topic的旧手工旁路不能创建无稳定身份任务',async()=>{
 const r=await request(app()).post('/trigger').set('X-Manual-Override','true').send({content_type:'solo-company-case'});expect(r.status).toBe(400);expect(m.connect).not.toHaveBeenCalled();
});

it('并发同topic事务序只建一行，不同topic保持独立工作单',async()=>{
 const intents=new Map<string,Record<string,unknown>>(),tails=new Map<string,Promise<void>>();let inserts=0;
 m.connect.mockImplementation(async()=>{
  let unlock:(()=>void)|undefined;
  return {release:vi.fn(),query:vi.fn(async(sql:string,args?:unknown[])=>{
   if(sql.includes('FROM zenithjoy.topics')) {
    const topic=String(args?.[0]);const previous=tails.get(topic)??Promise.resolve();
    const mine=new Promise<void>(resolve=>{unlock=resolve;});tails.set(topic,previous.then(()=>mine));await previous;
    return {rows:[{id:topic,notebook_id:null}]};
   }
   if(sql.includes('FROM zenithjoy.pipeline_runs'))return {rows:intents.has(String(args?.[0]))?[intents.get(String(args?.[0]))]:[]};
   if(sql.startsWith('INSERT')){inserts++;const run={id:String(args?.[6]),topic_id:String(args?.[2]),status:'pending',content_type:'solo-company-case'};intents.set(run.topic_id,run);return {rows:[run]};}
   if(sql==='COMMIT'||sql==='ROLLBACK')unlock?.();return {rows:[]};
  })};
 });
 m.query.mockResolvedValue({rows:[]});vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unknown response'));
 const other='44444444-4444-4444-8444-444444444444';
 const send=(topic:string)=>request(app()).post('/trigger').send({topic_id:topic,content_type:'solo-company-case'});
 const [a,b,c]=await Promise.all([send(TOPIC),send(TOPIC),send(other)]);
 expect(a.status).toBe(502);expect(b.status).toBe(502);expect(c.status).toBe(502);
 expect(a.body.error.details.pipeline_run_id).toBe(b.body.error.details.pipeline_run_id);
 expect(c.body.error.details.pipeline_run_id).not.toBe(a.body.error.details.pipeline_run_id);expect(inserts).toBe(2);
});
