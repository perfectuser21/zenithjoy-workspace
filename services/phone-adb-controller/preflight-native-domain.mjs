// Proof domain: only this parent's local nofork leaves, not Android/PG/sshd service OS domains.
import {createConnection} from 'node:net';import {startCollectionLeafProducer} from './collection-leaf-producer.mjs';import {startPreflightLocalLeaves} from './preflight-local-leaves.mjs';
const records=new WeakMap();
export function preflightDomainClosure(domain){const r=records.get(domain);return r?.proof?.execution_stopped===true?r.capability:null;}
export async function startPreflightNativeDomain({root,directory,sourceFiles,python,policy,serial,workerDeadlineMs,receiptDeadlineMs,env=process.env}){
 if(!Number.isSafeInteger(workerDeadlineMs)||!Number.isSafeInteger(receiptDeadlineMs)||workerDeadlineMs>=receiptDeadlineMs||Date.now()>=workerDeadlineMs)throw Error('PREFLIGHT_NATIVE_DEADLINE');
 const local=await startPreflightLocalLeaves({root,directory,sourceFiles,python,deadlineMs:workerDeadlineMs,env});let adb;
 try{
  if(Date.now()>=workerDeadlineMs)throw Error('PREFLIGHT_NATIVE_DEADLINE');
  adb=await startCollectionLeafProducer({directory,policy,serial,deadlineMs:receiptDeadlineMs,admissionDeadlineMs:workerDeadlineMs,env});
 }catch(error){await local.close();throw error;}
 let sealed=false,failed=false,pending=0,closing;
 const active=()=>{if(sealed||Date.now()>=workerDeadlineMs)throw Error('PREFLIGHT_NATIVE_CLOSED');};
 const request=async argv=>{
  active();pending++;
  try{return await new Promise((resolve,reject)=>{
   const client=createConnection(adb.env.WFR_COLLECTION_LEAF_SOCKET);let bytes='',finished=false;
   const timer=setTimeout(()=>{client.destroy();reject(Error('PREFLIGHT_ADB_REQUEST_FAILED'));},Math.max(1,receiptDeadlineMs-Date.now()));
   client.on('connect',()=>{try{active();client.end(JSON.stringify({nonce:adb.env.WFR_COLLECTION_LEAF_NONCE,argv}));}catch(error){client.destroy();reject(error);}});
   client.on('data',b=>{bytes+=b;if(bytes.length>16*1024*1024){client.destroy();reject(Error('PREFLIGHT_ADB_REQUEST_FAILED'));}});
   client.on('error',()=>reject(Error('PREFLIGHT_ADB_REQUEST_FAILED')));
   client.on('end',()=>{try{const response=JSON.parse(bytes);if(response.ok!==true||response.code!==0||typeof response.stdout!=='string')throw Error('PREFLIGHT_ADB_REQUEST_FAILED');finished=true;resolve(Buffer.from(response.stdout,'base64'));}catch{reject(Error('PREFLIGHT_ADB_REQUEST_FAILED'));}});
   client.on('close',()=>{clearTimeout(timer);if(!finished)reject(Error('PREFLIGHT_ADB_REQUEST_FAILED'));});
  });}catch(error){failed=true;throw error;}finally{pending--;}
 };
 const domain={
  adb:async(...args)=>{const argv=args.length===1&&args[0]==='version'?args:['-H','127.0.0.1','-P',policy.endpoint.split(':').at(-1),'-s',serial,...args];return (await request(argv)).toString('utf8');},
  local:async(operation,input)=>{active();pending++;try{return await local.run(operation,input);}catch(error){failed=true;throw error;}finally{pending--;}}
 };
 const r={capability:Object.freeze({}),proof:null};records.set(domain,r);
 domain.close=()=>closing??=(async()=>{
  sealed=true;const [a,l]=await Promise.all([adb.seal(),local.seal()]);await adb.close();
  const stopped=!failed&&pending===0&&(a.requests_returned||a.empty_requests_returned)&&l.execution_stopped===true;
  r.proof=Object.freeze({domain:'parent-preflight-local-nofork-v1',execution_stopped:stopped,adb:a,local:l,pending});return structuredClone(r.proof);
 })();
 domain.snapshot=()=>r.proof?structuredClone(r.proof):{domain:'parent-preflight-local-nofork-v1',execution_stopped:false,sealed,pending};
 return domain;
}
