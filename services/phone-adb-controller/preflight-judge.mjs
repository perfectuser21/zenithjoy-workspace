// Runner/Judge only: source-verified original checks; never a worker broker operation.
import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {createRequire} from 'node:module';
import {verifyRpcSource} from './leadgen-rpc.mjs';import {runProbes,runSteps,resolveLineKey} from './verify-step.mjs';
const require=createRequire(import.meta.url),{loadChecks}=require('./checks/probes-lib.js');
export async function judgePreflightInProcess({root,source,workflow,stage,run,line,metrics={},deadlineMs}){
 if(!['douyin_video_discovery','douyin_video_processing'].includes(workflow)||stage!=='preflight')throw Error('PREFLIGHT_JUDGE_SCOPE');
 const remaining=()=>{if(!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now())throw Error('PREFLIGHT_JUDGE_DEADLINE');return Math.min(45000,deadlineMs-Date.now());};remaining();
 verifyRpcSource(source,{base:root});
 const name=workflow==='douyin_video_discovery'?'douyin-video-discovery':'douyin-video-processing';
 const {doc,errors}=loadChecks(resolve(root,'checks',name+'.yaml'),resolve(root,'checks/schema.json'));if(errors.length)throw Error('RPC_VERIFY_CHECKS_INVALID');
 const spec=JSON.parse(readFileSync(resolve(root,'plans',workflow+'.steps.json'),'utf8'));
 // Current preflight contract has metric probes and local evidence. Do not silently
 // drop a future external readback or reopen a generic RPC/PG transport to run it.
 if(doc.probes.filter(p=>p.stage===stage).some(p=>p.probe.type!=='metric')||spec.steps.filter(s=>(s.at||s.activity)===stage).some(s=>['sql','http'].includes(s.readback?.type)))throw Error('PREFLIGHT_JUDGE_EXTERNAL_PROBE_UNSUPPORTED');
 const params={runTag:run,lineKey:resolveLineKey(line),metrics,word:''};
 const probes=await runProbes({doc,stage,params,deps:{},timeoutMs:remaining()});const steps=await runSteps({spec,stage,params,deps:{},timeoutMs:remaining()});remaining();
 return {ok:true,result:{...probes,steps}};
}
