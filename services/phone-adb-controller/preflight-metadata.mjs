// Parent-only metadata operations. Business rules remain in the original RPC functions.
import {appendFileSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {handleRpc,verifyRpcSource} from './leadgen-rpc.mjs';
const fail=code=>Object.assign(Error(code),{code});
export function createPreflightMetadata({directory,scope,source,createPool,verify=verifyRpcSource}){
 if(!['douyin_video_discovery','douyin_video_processing'].includes(scope?.workflow)||typeof createPool!=='function')throw fail('PREFLIGHT_METADATA_SCOPE');
 const fixed=structuredClone(scope),pending=new Set(),transports=new Set();let sealed=false,unknown=false;
 const ledger=join(directory,'preflight-metadata-'+randomUUID()+'.jsonl');
 const record=value=>{try{appendFileSync(ledger,JSON.stringify(value)+'\n',{mode:0o600});}catch{unknown=true;throw fail('PREFLIGHT_METADATA_RECORD_FAILED');}};
 const active=deadline=>{if(unknown)throw fail('PREFLIGHT_METADATA_UNKNOWN');if(sealed||!Number.isSafeInteger(deadline)||Date.now()>=deadline)throw fail('PREFLIGHT_METADATA_DEADLINE');};
 const admitted=input=>{
  const q=input?.request,step=fixed.workflow==='douyin_video_discovery'?'101':'102';
  if(input?.kind==='keywords'){
   if(step!=='101'||Object.keys(input).some(k=>!['kind','line','run','limit','keywords'].includes(k))||input.line!==fixed.line||input.run!==fixed.run||input.limit!==2||JSON.stringify(input.keywords)!==JSON.stringify(fixed.sources))throw fail('PREFLIGHT_METADATA_SCOPE');
  }else if(input?.kind!=='queue'||Object.keys(input).sort().join(',')!=='kind,request'||q?.op!=='company_config'||q.step!==step||q.line!==fixed.line||q.run!==fixed.run||q.source_run!==(fixed.source_run||undefined)||q.limit!==fixed.limit
   ||Object.keys(q).some(k=>!['op','step','line','run','source_run','limit','device_binding'].includes(k))||!q.device_binding||Object.keys(q.device_binding).sort().join(',')!=='device_serial,profile'||q.device_binding.profile!==fixed.profile||q.device_binding.device_serial!==fixed.serial)throw fail('PREFLIGHT_METADATA_SCOPE');
 };
 const call=async(input,{scope:activity}={})=>{
  admitted(input);const deadline=Math.min(activity?.worker_deadline_ms??activity?.deadline_ms,activity?.deadline_ms);active(deadline);
  try{verify(source);}catch{throw fail('PREFLIGHT_METADATA_SOURCE');}
  const operation=input.kind==='keywords'?'keywords':'company_config',id=randomUUID();record({id,operation,event:'intent'});
  let pool,transport;const job=(async()=>{
   try{
    const allocated=await createPool({deadlineMs:deadline});pool=allocated.pool;transport=allocated.transport;transports.add(transport);pool.on?.('error',()=>{unknown=true;void transport.close().catch(()=>{});});active(deadline);
    // A successfully authenticated endpoint must also match the authorized database identity.
    const expected=allocated.expectedIdentity;if(!expected?.database||!expected?.role)throw fail('PREFLIGHT_METADATA_IDENTITY');
    const identity=(await pool.query('SELECT current_database() AS database, current_user AS role')).rows;
    if(identity.length!==1||identity[0].database!==expected.database||identity[0].role!==expected.role)throw fail('PREFLIGHT_METADATA_IDENTITY');active(deadline);
    const guarded={query:(...args)=>{active(deadline);return pool.query(...args);},connect:async()=>{active(deadline);const client=await pool.connect();try{active(deadline);}catch(error){client.release();throw error;}return {query:(...args)=>{active(deadline);return client.query(...args);},release:()=>client.release()};},end:async()=>{}};
    const result=await handleRpc({...input,source},{verify:()=>{},pool:guarded});active(deadline);
    await pool.end();pool=null;const proof=await transport.seal();if(proof.execution_stopped!==true)throw fail('PREFLIGHT_METADATA_UNKNOWN');active(deadline);
    record({id,operation,event:'returned'});return result;
   }catch(error){
    unknown=true;const sqlstate=/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:undefined;
    try{record({id,operation,event:'unknown',...(sqlstate?{sqlstate}:{})});}catch{}
    // Never propagate PG errors, options, URI, stderr or nested causes to Runner/Agent logs.
    throw fail('PREFLIGHT_METADATA_UNKNOWN');
   }finally{
    if(pool){try{await transport?.close();}catch{}try{await pool.end();}catch{}}
   }
  })();pending.add(job);try{return await job;}finally{pending.delete(job);}
 };
 call.assertActive=()=>{if(unknown)throw fail('PREFLIGHT_METADATA_UNKNOWN');if(sealed)throw fail('PREFLIGHT_METADATA_DEADLINE');};
 call.close=async()=>{sealed=true;if(pending.size)unknown=true;await Promise.allSettled([...transports].map(t=>t.close()));await Promise.allSettled([...pending]);return {sealed,execution_stopped:!unknown,pending:pending.size};};
 call.snapshot=()=>({sealed,unknown,pending:pending.size,ledger});return call;
}
