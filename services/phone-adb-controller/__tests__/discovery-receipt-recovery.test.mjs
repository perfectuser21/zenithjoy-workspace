import {queueMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpc,RPC_FILES} from '../leadgen-client.mjs';
import {handleRpc} from '../leadgen-rpc.mjs';
const commit='a'.repeat(40),frozen={deployment:{source_commit:commit},files:Object.fromEntries(RPC_FILES.map(path=>['runtime/'+path,'b'.repeat(64)]))};
const fixture=queueMetricsFixture({run:'actual-receipt-recovery',videoId:'7638592889887709632'});
const request={kind:'queue',request:{op:'discover',line:'jinuo',run:'actual-receipt-recovery',video:fixture.video}};
for(const committedBeforeLoss of [true,false])test(`完整RPC→队列→SQL恢复链：首次提交=${committedBeforeLoss}，只形成一个真实身份`,async()=>{
 const records=new Map(),writes=[],reads=[],calls=[];
 const pool={query:async(sql,args)=>{
  if(sql.includes('company_config_runs'))return {rows:[fixture.company]};
  const key=args[0]+':'+args[1];
  if(sql.startsWith('SELECT discovery_metrics='))return {rows:[{verified:JSON.stringify(records.get(key)?.metrics)===args[2]}]};
  if(sql.includes('INSERT INTO zenithjoy.leadgen_videos')){
   writes.push(args);const existing=records.has(key);records.set(key,{url:args[2],run:args[5],metrics:JSON.parse(args[7])});
   return {rows:[{judgment_status:'pending',has_transcript:false,inserted:!existing}]};
  }
  if(sql.includes('AND video_url=$3')){
   reads.push(args);return {rows:records.get(key)?.url===args[2]?[{judgment_status:'pending',has_transcript:false,metrics_verified:JSON.stringify(records.get(key)?.metrics)===args[3]}]:[]};
  }
  throw Error('UNEXPECTED_SQL');
 }};
 const rpc=createRpc({frozen,runContext:fixture.deps.execution,execute:async(_c,_a,o)=>{
  const input=JSON.parse(o.input);calls.push(input.request.op);
  const executeServer=()=>handleRpc(input,{pool,verify:source=>{assert.equal(source.commit,commit);assert.equal(source.files.length,RPC_FILES.length);}});
  if(calls.length===1){if(committedBeforeLoss)await executeServer();return {code:255,stdout:'',stderr:'connection closed'};}
  return {code:0,stdout:JSON.stringify(await executeServer()),stderr:''};
 }});
 const result=await rpc(request,{timeoutMs:2000});
 assert.equal(result.ok,true);assert.equal(records.size,1);assert.equal(writes.length,1);assert.equal(reads.length,1);
 assert.equal(records.get('jinuo:7638592889887709632').url,request.request.video.videoUrl);
 assert.deepEqual(calls,committedBeforeLoss?['discover','discover_readback']:['discover','discover_readback','discover']);
 assert.equal(result.result.inserted,!committedBeforeLoss);
});
