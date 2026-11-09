import {openSync,closeSync,fstatSync,lstatSync,readFileSync,writeFileSync,fsyncSync,realpathSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const digest=b=>createHash('sha256').update(b).digest('hex');
const required=['official-recording-producer.mjs','official-recording-observer.py','qualification-maintenance-processes.py','adb-process-observation.py','douyin-phone-adb','runtime/scrcpy-runtime.py','runtime/scrcpy-adb-shim.py','runtime/runtime-policy.json','runtime/runtime-policy-sdk33.json','decode-recording.py'];
const id=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const fail=()=>Error('OFFICIAL_RECORDING_UNKNOWN');
function need(ok){if(!ok)throw fail();}
function bytes(path,privateFile=false,max=8*1024*1024){
 need(isAbsolute(path)&&!lstatSync(path).isSymbolicLink());
 const fd=openSync(path,'r');try{const s=fstatSync(fd);need(s.isFile()&&s.size<=max&&(!privateFile||s.uid===process.getuid()&&(s.mode&0o777)===0o600));const raw=readFileSync(fd);need(raw.length<=max);return raw;}finally{closeSync(fd);}
}
function save(path,value){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}const parent=openSync(resolve(path,'..'),'r');try{fsyncSync(parent);}finally{closeSync(parent);}}
// This is a Code-owned adapter, never an RPC taking child supplied paths/PIDs.
// Its proof covers registered local capture producers only; the caller must also
// verify every foreground CLI native operation and the remaining activity domains.
export function createOfficialRecordingProducer({scope,sourceRoot,evidenceRoot,files,python}){
 const fixed=structuredClone(scope);files=structuredClone(files);python=structuredClone(python);need(isAbsolute(python?.path||'')&&realpathSync(python.path)===python.path&&/^[a-f0-9]{64}$/.test(python.sha256||''));need(isAbsolute(sourceRoot)&&realpathSync(sourceRoot)===sourceRoot&&isAbsolute(evidenceRoot));
 for(const k of ['runDir','runId','taskId','sourceCommit','profile','serial','owner','activity','snapshotSha256','bindingId'])need(typeof fixed?.[k]==='string'&&fixed[k].length>0);
 need(fixed.activity==='qualification'&&isAbsolute(fixed.runDir)&&/^[a-f0-9]{40}$/.test(fixed.sourceCommit)&&/^[a-f0-9]{64}$/.test(fixed.snapshotSha256));
 for(const k of ['deadlineMs','workerDeadlineMs','receiptDeadlineMs'])need(Number.isFinite(fixed[k]));
 const check=()=>{need(digest(bytes(python.path,false,64*1024*1024))===python.sha256);for(const p of required)need(/^[a-f0-9]{64}$/.test(files?.[p]||'')&&digest(bytes(join(sourceRoot,p)))===files[p]);};check();
 const entries=new Map(),tickets=new WeakMap(),proofs=new WeakSet();let unknown=false,sealed=false;
 const observe=e=>{check();need(digest(bytes(e.intentPath,true))===e.intentHash);const r=spawnSync(python.path,['-I',join(sourceRoot,'official-recording-observer.py'),'inspect',e.intentPath],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},encoding:'utf8',timeout:Math.max(1,Math.min(3000,fixed.receiptDeadlineMs-Date.now())),maxBuffer:1024*1024});need(r.status===0&&!r.error&&!r.signal);const v=JSON.parse(r.stdout);need(v.protocol==='official-recording-observation/v1'&&v.intent_sha256===e.intentHash&&Array.isArray(v.processes)&&Array.isArray(v.unregistered_group_members)&&v.unregistered_group_members.length===0&&!v.unknown);return v.processes;};
 const artifacts=e=>{
  const json=s=>JSON.parse(bytes(join(evidenceRoot,e.evidenceId+s),true));
  const sdk=String(bytes(join(evidenceRoot,e.evidenceId+'.capture-sdk.txt'),true)).trim();need(sdk==='31'||/^\d{2}$/.test(sdk)&&Number(sdk)>=33);
  const policy=JSON.parse(bytes(join(sourceRoot,'runtime',sdk==='31'?'runtime-policy.json':'runtime-policy-sdk33.json')));
  need(policy.schema===(sdk==='31'?'scrcpy-sdk31-pinned-v1':'scrcpy-sdk33-pinned-v1')&&policy.version===(sdk==='31'?'5.0.1':'3.3.4'));
  const runtime=json('.capture-runtime.json');need(runtime.runtime?.verified===true&&runtime.stage?.verified===true&&runtime.stage.execution_stop_unknown!==true);
  for(const k of ['schema','version','client_sha256','server_sha256'])need(runtime.runtime[k]===policy[k]);
  for(const k of ['client','server'])need(digest(bytes(runtime.runtime[k+'_path'],false,16*1024*1024))===policy[k+'_sha256']);
  const startup=json('.capture-startup.json');need(startup.status==='ready'&&Number.isSafeInteger(startup.pid)&&startup.pid>1&&Array.isArray(startup.expected_argv)&&startup.expected_argv[0]===runtime.runtime.client_path);
  const media=join(evidenceRoot,e.evidenceId+(sdk==='31'?'.rec.wav':'.rec.mkv'));
  const expected=[runtime.runtime.client_path,'-s',fixed.serial,'--no-window','--no-playback',...(sdk==='31'?['--no-video','--audio-source=output','--audio-codec=raw','--record-format=wav']:['--audio-source=playback','--audio-dup']),'--require-audio','--record='+media,'--time-limit='+e.seconds];
  need(JSON.stringify(startup.expected_argv)===JSON.stringify(expected)&&startup.observations?.length>=2);
  return {startup,media};
 };
 function before({operationId,command,evidenceId,videoId,argv}){
  check();need(!unknown&&!sealed&&Date.now()<fixed.receiptDeadlineMs&&id.test(operationId||'')&&id.test(evidenceId||'')&&/^\d+$/.test(videoId||'')&&Array.isArray(argv));
  need(['record-start','record-status','record-stop','record-extract-audio'].includes(command));
  let e=entries.get(evidenceId);
  if(command==='record-start'){
   need(!e&&Date.now()<fixed.workerDeadlineMs&&argv.length===3&&argv[0]===evidenceId&&argv[2]===videoId&&/^\d+$/.test(argv[1])&&Number(argv[1])>=5&&Number(argv[1])<=320);
   const s=lstatSync(evidenceRoot);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0);
   const intentPath=join(evidenceRoot,evidenceId+'.official-recording-intent.json');
   const value={protocol:'official-recording-intent/v1',scope:fixed,uid:process.getuid(),evidence_id:evidenceId,video_id:videoId,operation_id:operationId,source_files:files};
   save(intentPath,value);e={evidenceId,videoId,seconds:Number(argv[1]),intentPath,intentHash:digest(bytes(intentPath,true)),status:'intent',pending:0,seen:new Map()};entries.set(evidenceId,e);
  }else need(e&&e.videoId===videoId&&argv.length===1&&argv[0]===evidenceId);
  const ticket=Object.freeze({intentPath:e.intentPath,env:Object.freeze({ZJ_OFFICIAL_RECORDING_INTENT:e.intentPath})});tickets.set(ticket,{e,command});e.pending++;return ticket;
 }
 async function after(ticket,{executionStopped}){
  const t=tickets.get(ticket);need(t);tickets.delete(ticket);t.e.pending--;
  try{need(executionStopped===true);const rows=observe(t.e);need(rows.length>0);for(const row of rows){const key=row.receipt;const old=t.e.seen.get(key);need(!old||old===row.receipt_sha256);t.e.seen.set(key,row.receipt_sha256);}
   const {startup,media}=artifacts(t.e);need(rows.some(r=>r.pid===startup.pid&&r.argv_sha256===digest(JSON.stringify(startup.expected_argv))));
   if(t.command==='record-start'){need(rows.find(r=>r.pid===startup.pid).state==='alive');t.e.status='active';}
   if(t.command==='record-stop'){
    need(rows.every(r=>['absent','terminal'].includes(r.state)));
    const decoded=JSON.parse(bytes(join(evidenceRoot,t.e.evidenceId+'.decode.json'),true));
    need(decoded.verified===true&&decoded.decoder_exit_code===0&&decoded.requested_seconds===t.e.seconds&&decoded.decoded_sample_rate===16000&&decoded.decoded_samples===decoded.decoded_seconds*16000&&decoded.decoded_seconds>=t.e.seconds*.8&&decoded.decoded_seconds<=t.e.seconds+3&&Number.isFinite(decoded.mean_volume_db)&&decoded.mean_volume_db>-80&&decoded.media_sha256===digest(bytes(media,false,256*1024*1024)));
    t.e.mediaHash=decoded.media_sha256;t.e.status='stopped';
   }
   return snapshot();
  }catch(error){unknown=true;t.e.status='unknown';throw fail();}
 }
 function snapshot(){return {protocol:'official-recording-producer/v1',domain:'registered_local_capture_producers',os_full_stop:false,execution_stopped:!unknown&&[...entries.values()].every(e=>e.status==='stopped'&&e.pending===0),unknown,recordings:[...entries.values()].map(e=>({evidence_id:e.evidenceId,video_id:e.videoId,status:e.status,pending:e.pending,registered_processes:e.seen.size}))};}
 function validateClosed(){for(const e of entries.values()){const rows=observe(e);need(e.status==='stopped'&&e.pending===0&&rows.length>0&&rows.every(r=>['absent','terminal'].includes(r.state))&&rows.length===e.seen.size);for(const row of rows)need(e.seen.get(row.receipt)===row.receipt_sha256);const {media}=artifacts(e);need(digest(bytes(media,false,256*1024*1024))===e.mediaHash);}}
 async function close(){sealed=true;try{validateClosed();}catch{unknown=true;}const proof=Object.freeze(snapshot());proofs.add(proof);return proof;}
 return Object.freeze({before,after,snapshot,close,verifyStopped:p=>{if(!sealed||!proofs.has(p)||p.execution_stopped!==true||unknown)return false;try{validateClosed();return snapshot().execution_stopped;}catch{unknown=true;return false;}}});
}
