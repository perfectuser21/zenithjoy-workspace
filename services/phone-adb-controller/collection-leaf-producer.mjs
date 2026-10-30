// 父进程独占实际ADB进程与账；wrapper只可请求命令，不可提交started/exit证明。
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,readFileSync,realpathSync,statSync,appendFileSync,chmodSync,unlinkSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
const sandbox='/usr/bin/sandbox-exec';
// 精确复用PR2147 ccfcbfb7 wf-v2-processes.py的单叶子边界，绝不套在允许fork的父shell。
const profile='(version 1)(allow default)(deny process-fork)';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pinnedClient(policy){
 if(!isAbsolute(policy?.adb_bin||'')||!/^[a-f0-9]{64}$/.test(policy?.adb_sha256||''))throw Error('COLLECTION_CLIENT_PIN_REQUIRED');
 const actual=realpathSync(policy.adb_bin),info=statSync(actual);
 if(!info.isFile()||(info.mode&0o022)||policy.adb_realpath&&actual!==policy.adb_realpath||sha(readFileSync(actual))!==policy.adb_sha256)throw Error('COLLECTION_CLIENT_PIN_MISMATCH');
 return actual;
}
async function run(command,args,env,timeoutMs,onStart=()=>{}){
 return new Promise((resolve,reject)=>{
  const p=spawn(command,args,{env,stdio:['ignore','pipe','pipe']}),chunks=[[],[]];let bytes=0,tainted=false,force,startError;
  const timer=setTimeout(()=>{tainted=true;p.kill('SIGTERM');force=setTimeout(()=>p.kill('SIGKILL'),200);},Math.max(1,timeoutMs));
  p.once('spawn',()=>{try{onStart(p.pid);}catch(error){startError=error;tainted=true;p.kill('SIGKILL');}});p.once('error',error=>{startError=error;});
  for(const [index,stream] of [p.stdout,p.stderr].entries())stream.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024){tainted=true;p.kill('SIGKILL');}else chunks[index].push(b);});
  p.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(force);if(startError){reject(startError);return;}resolve({code,signal,tainted,stdout:Buffer.concat(chunks[0]),stderr:Buffer.concat(chunks[1])});});
 });
}
export async function startCollectionLeafProducer({directory,policy,serial,deadlineMs,env=process.env}){
 const binary=pinnedClient(policy);
 if(process.platform!=='darwin')throw Error('COLLECTION_NOFORK_UNSUPPORTED');
 if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(serial||'')||!Number.isSafeInteger(deadlineMs)||deadlineMs<=Date.now())throw Error('COLLECTION_LEAF_SCOPE_INVALID');
 const endpoint=policy.endpoint?.match(/^tcp:127\.0\.0\.1:([0-9]{1,5})$/);
 if(!endpoint||Number(endpoint[1])<1||Number(endpoint[1])>65535)throw Error('COLLECTION_LEAF_ROUTE_INVALID');
 const clean={...env};for(const key of Object.keys(clean))if(/^(?:DYLD_|LD_|PYTHON|NODE_OPTIONS$|NODE_PATH$)/.test(key))delete clean[key];
 // 每个producer实证内核拒绝fork；仅检查sandbox-exec文件存在不足以签发。
 const positive=await run(sandbox,['-p',profile,'/usr/bin/true'],clean,2000);
 const negative=await run(sandbox,['-p',profile,'/bin/sh','-c','/usr/bin/true & wait'],clean,2000);
 if(positive.code!==0||positive.tainted||negative.code===0||negative.tainted||!/fork: (?:Operation not permitted|Resource temporarily unavailable)/.test(negative.stderr.toString()))throw Error('COLLECTION_NOFORK_BOUNDARY_UNVERIFIED');
 mkdirSync(directory,{recursive:true,mode:0o700});
 const socket=join(tmpdir(),'cl-'+randomBytes(12).toString('hex')+'.sock'),nonce=randomBytes(24).toString('hex');
 const ledger=join(directory,'collection-leaves-'+randomBytes(8).toString('hex')+'.jsonl');
 const leaves=[],clients=new Set(),finishedClients=new WeakSet();let active=0,sealed=false,tainted=false,returnUnknown=false,draining;
 const append=entry=>appendFileSync(ledger,JSON.stringify(entry)+'\n',{mode:0o600});
 const dispatch=async request=>{
  if(returnUnknown)throw Error('COLLECTION_LEAF_RETURN_UNKNOWN');
  if(sealed||Date.now()>=deadlineMs||active)throw Error('COLLECTION_LEAF_CLOSED_OR_BUSY');
  if(!request||Object.keys(request).sort().join(',')!=='argv,nonce'||request.nonce!==nonce||!Array.isArray(request.argv)||request.argv.some(x=>typeof x!=='string'||x.length>12000||x.includes('\0')))throw Error('COLLECTION_LEAF_REQUEST_INVALID');
  const argv=request.argv,version=argv.length===1&&argv[0]==='version';
  if(!version&&(argv.length<7||JSON.stringify(argv.slice(0,6))!==JSON.stringify(['-H','127.0.0.1','-P',endpoint[1],'-s',serial])||!['get-state','shell','exec-out','pull'].includes(argv[6])))throw Error('COLLECTION_LEAF_COMMAND_REFUSED');
  if(pinnedClient(policy)!==binary)throw Error('COLLECTION_CLIENT_PIN_MISMATCH');
  active++;
  const entry={sequence:leaves.length+1,argv_sha256:sha(JSON.stringify(argv)),intent_at:Date.now(),boundary:'darwin-sandbox-deny-process-fork-v1'};
  leaves.push(entry);
  try{
   append({...entry,phase:'intent'});
   const result=await run(sandbox,['-p',profile,binary,...argv],{...clean,ADB_SERVER_SOCKET:policy.endpoint},deadlineMs-Date.now(),pid=>{entry.pid=pid;entry.started_at=Date.now();append({...entry,phase:'started'});});
   entry.ended_at=Date.now();entry.code=result.code;entry.signal=result.signal;entry.tainted=result.tainted;
   // This is a lifecycle proof from our nofork child close, not business success.
   const dumpCrashReturned=result.code===137&&result.signal===null&&!result.tainted&&result.stderr.length===0
    &&/^[A-Za-z0-9_-]{1,80}$/.test(env.P||'')
    &&argv.length===11&&argv[6]==='shell'&&argv[7]==='uiautomator'&&argv[8]==='dump'&&argv[9]==='--compressed'
    &&argv[10]===`/sdcard/douyin-leadgen-ui-${env.P}.xml`;
   entry.dump_crash_returned=dumpCrashReturned;
   entry.request_returned=(dumpCrashReturned||[0,1].includes(result.code))&&!result.signal&&!result.tainted&&!/fork_denied=|fork(?:\(\))?: (?:Operation not permitted|Resource temporarily unavailable)/.test(result.stderr.toString());
   if(!entry.request_returned){
    returnUnknown=true;
    // Private forensic metadata only: never persist native stderr or raw argv.
    entry.command_family=version?'version':argv[6];
    entry.stderr_bytes=result.stderr.length;
    entry.stderr_sha256=sha(result.stderr);
   }
   append({...entry,phase:'exit'});
   if(result.code!==0||result.signal||result.tainted)tainted=true;
   return {ok:true,code:result.code??124,stdout:result.stdout.toString('base64'),stderr:result.stderr.toString('base64')};
  }catch(error){tainted=true;returnUnknown=true;try{append({...entry,phase:'unknown'});}catch{}throw error;}finally{active--;}
 };
 const server=createServer({allowHalfOpen:true},client=>{
  clients.add(client);client.once('close',()=>{clients.delete(client);if(!finishedClients.has(client)){tainted=true;returnUnknown=true;}});client.on('error',()=>{});let bytes='';
  client.setTimeout(Math.max(1,deadlineMs-Date.now()),()=>{tainted=true;returnUnknown=true;client.destroy();});
  client.on('data',b=>{bytes+=b;if(bytes.length>32000){tainted=true;returnUnknown=true;client.destroy();}});
  client.on('end',async()=>{try{const response=await dispatch(JSON.parse(bytes));finishedClients.add(client);client.end(JSON.stringify(response)+'\n');}catch(error){tainted=true;returnUnknown=true;finishedClients.add(client);client.end(JSON.stringify({ok:false,error:String(error.message)})+'\n');}});
 });
 await new Promise((yes,no)=>{server.once('error',no);server.listen(socket,yes);});chmodSync(socket,0o600);
 const drain=()=>draining??=(async()=>{
  sealed=true;
  for(const client of clients){if(!finishedClients.has(client)){tainted=true;returnUnknown=true;}client.destroy();}
  await new Promise(r=>server.close(r));
  while(active&&Date.now()<deadlineMs+3000)await sleep(10);
  try{unlinkSync(socket);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(active){tainted=true;returnUnknown=true;throw Error('COLLECTION_LEAF_DRAIN_UNVERIFIED');}
 })();
 const returned=()=>sealed&&!returnUnknown&&active===0&&leaves.every(x=>x.started_at&&x.ended_at&&x.request_returned===true);
 const snapshot=()=>({complete:sealed&&!tainted&&active===0&&leaves.length>0&&leaves.every(x=>x.started_at&&x.ended_at&&x.code===0&&!x.signal&&!x.tainted),empty_complete:sealed&&!tainted&&active===0&&leaves.length===0,requests_returned:returned()&&leaves.length>0,empty_requests_returned:returned()&&leaves.length===0,leaves:structuredClone(leaves),ledger});
 return {env:{WFR_COLLECTION_LEAF_SOCKET:socket,WFR_COLLECTION_LEAF_NONCE:nonce},isReturnUnknown:()=>returnUnknown,
  seal:async()=>{await drain();return snapshot();},close:drain,snapshot};
}
