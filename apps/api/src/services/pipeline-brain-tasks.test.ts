import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {resultDigest} from './pipeline-brain-tasks';
describe('Brain公共终态回执digest wire',()=>{
 it('逐层使用UTF16键排序，与服务端JSON.stringify合同一致',()=>{
  const x={a:1,A:2,_x:3,nest:{b:4,B:5,'中':6}};
  const expected=createHash('sha256').update(JSON.stringify({A:2,_x:3,a:1,nest:{B:5,b:4,'中':6}})).digest('hex');
  expect(resultDigest(x)).toBe(expected);
 });
});

import {vi,afterEach} from 'vitest';
import {registerPipelineTask} from './pipeline-brain-tasks';
afterEach(()=>vi.restoreAllMocks());
it('不同同题run使用不同title/source_id，回执必须绑定本run',async()=>{
 const f=vi.spyOn(globalThis,'fetch').mockImplementation(async(_u,options)=>{
  const sent=JSON.parse(String(options?.body));const id=sent.payload.zenithjoy_pipeline_run_id;
  return {ok:true,json:async()=>({id:'22222222-2222-4222-8222-222222222222',payload:{zenithjoy_pipeline_run_id:id}})} as Response;
 });
 await registerPipelineTask({id:'11111111-1111-4111-8111-111111111111',topic:'same'});
 await registerPipelineTask({id:'33333333-3333-4333-8333-333333333333',topic:'same'});
 const bodies=f.mock.calls.map(([,o])=>JSON.parse(String(o?.body)));
 expect(bodies[0].source_id).not.toBe(bodies[1].source_id);expect(bodies[0].title).not.toBe(bodies[1].title);
 f.mockResolvedValue({ok:true,json:async()=>({id:'22222222-2222-4222-8222-222222222222',payload:{zenithjoy_pipeline_run_id:'other'}})} as Response);
 await expect(registerPipelineTask({id:'11111111-1111-4111-8111-111111111111'})).rejects.toThrow('有效任务');
});

import {validateBrainLease} from './pipeline-brain-tasks';
it('API验证身份不擅自缩短Worker租约期限',async()=>{
 const f=vi.spyOn(globalThis,'fetch').mockResolvedValue({ok:true,json:async()=>({ok:true,lease_until:'2026-11-14T01:00:00Z'})} as Response);
 await validateBrainLease({brain_task_id:'11111111-1111-4111-8111-111111111111',claimer:'worker',claim_epoch:'2026-11-14 00:00:00.123456+00'});
 expect(JSON.parse(String(f.mock.calls[0][1]?.body))).not.toHaveProperty('lease_seconds');
});
