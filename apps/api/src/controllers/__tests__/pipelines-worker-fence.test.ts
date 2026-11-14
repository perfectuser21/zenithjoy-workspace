import {beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';import request from 'supertest';
const m=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn()}));vi.mock('../../db/connection',()=>({default:m}));
import {PipelinesWorkerController} from '../pipelines-worker.controller';
import {resultDigest} from '../../services/pipeline-brain-tasks';
const id='11111111-1111-4111-8111-111111111111', task='22222222-2222-4222-8222-222222222222';
const identity={brain_task_id:task,claimer:'zj:worker:1',claim_epoch:'2026-11-14 01:00:00.123456+00'};
const a=()=>{const a=express();a.use(express.json());const c=new PipelinesWorkerController();if(c.claim)a.post('/:id/claim',c.claim);a.post('/:id/stage-complete',c.stageComplete);a.post('/:id/fail',c.fail);return a;};
let queries:unknown[][];let row:Record<string,unknown>;
beforeEach(()=>{vi.restoreAllMocks();m.query.mockReset();m.connect.mockReset();queries=[];row={id,status:'pending',cecelia_task_id:task,output_manifest:null};const query=vi.fn(async(s:string,p?:unknown[])=>{queries.push([s,p]);return s.startsWith('SELECT')?{rows:[row]}:{rows:[{...row,status:'running'}]};});m.connect.mockResolvedValue({query,release:vi.fn()});});
describe('Worker本地业务回执受Brain租约和当前工作单约束',()=>{
 it('无任务认领身份不接受阶段回写，零数据库副作用',async()=>{const r=await request(a()).post(`/${id}/stage-complete`).send({stage:'research',output:{}});expect(r.status).toBe(400);expect(m.connect).not.toHaveBeenCalled();});
 it('Brain拒绝租约时不绑定本地执行',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status:409} as Response);const r=await request(a()).post(`/${id}/claim`).send(identity);expect(r.status).toBe(409);expect(m.connect).not.toHaveBeenCalled();});
 it('同一认领先取得权威心跳才本地绑定，原生epoch保留',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,lease_until:'2026-11-14T01:02:00Z'})} as Response);const r=await request(a()).post(`/${id}/claim`).send(identity);expect(r.status).toBe(200);expect(JSON.stringify(queries)).toContain(identity.claim_epoch);expect(JSON.stringify(queries)).toContain('brain_claim');});
 it('旧Brain taskid不能覆盖重新挂号的本地工作单',async()=>{row.cecelia_task_id='33333333-3333-4333-8333-333333333333';vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,lease_until:'2026-11-14T01:02:00Z'})} as Response);const r=await request(a()).post(`/${id}/claim`).send(identity);expect(r.status).toBe(409);expect(queries.some(([s])=>String(s).startsWith('UPDATE'))).toBe(false);});
 it('没有Brain终态确认不能提前完成内容工作单',async()=>{row.status='running';row.output_manifest={brain_claim:identity};vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:false,status:409} as Response);const output={status:'completed'};const result={pipeline_id:id,output_manifest:output};const r=await request(a()).post(`/${id}/stage-complete`).send({...identity,stage:'export',output,is_final:true,brain_result:result});expect(r.status).toBe(409);expect(queries.some(([s])=>String(s).startsWith('UPDATE'))).toBe(false);});
 it('同结果Brainfinish幂等确认后保留认领身份保存产物',async()=>{row.status='running';row.output_manifest={brain_claim:identity};const output={status:'completed',article:{path:'article.md'}};const result={pipeline_id:id,output_manifest:output};const f=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,task_id:task,status:'completed',replayed:true,receipt:{claimer:identity.claimer,claim_epoch:identity.claim_epoch,status:'completed',result_sha256:resultDigest(result)}})} as Response);const r=await request(a()).post(`/${id}/stage-complete`).send({...identity,stage:'export',output,is_final:true,brain_result:result});expect(r.status).toBe(200);expect(String(f.mock.calls[0][0])).toMatch(/lease\/finish$/);expect(JSON.stringify(queries)).toContain('brain_claim');});
 it('当前Brain身份相同但本地epoch已更新时拒绝旧阶段写入',async()=>{
  row.status='running';row.output_manifest={brain_claim:{...identity,claim_epoch:'2026-11-14 01:00:00.654321+00'}};
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,lease_until:'2026-11-14T01:02:00Z'})} as Response);
  const r=await request(a()).post(`/${id}/stage-complete`).send({...identity,stage:'research',output:{}});
  expect(r.status).toBe(409);expect(queries.some(([s])=>String(s).startsWith('UPDATE'))).toBe(false);
 });
 it('阶段产物目录不能切到另一run或共享根',async()=>{
  row.status='running';row.output_dir='/tmp/owned/runs/'+id;row.output_manifest={brain_claim:identity};
  vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,lease_until:'2026-11-14T01:02:00Z'})} as Response);
  const r=await request(a()).post(`/${id}/stage-complete`).send({...identity,stage:'generate',output:{output_dir:'/tmp/owned'}});
  expect(r.status).toBe(400);expect(queries.some(([s])=>String(s).startsWith('UPDATE'))).toBe(false);
 });

});
