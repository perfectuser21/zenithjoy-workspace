// 受审实现字节族，不含run/设备/Task专属常量；新行为必须另行审查。
export const reviewedSourceHashes=Object.freeze({
  "official-gateway-runtime.json": ["40ed4b1e22b5fa4de93cb160731f5770cdc326ed0ec22d80b83044752a9c34c5"],
  "leadgen-workflow.mjs": [
    "5b891b5bb482e8a0ace722f78ff8557a10612aeff07f570a17c1e91fafac8ac1"
  ],
  "leadgen-handlers.mjs": [
    "a50aa236c93c693aebf04730c1e5ebe18436bcf143fea3476e346f275fd03ab7",
    "dd39a60afda757c39621837835a58539113c565e92edcf5e500e250e6adb5d1d"
  ],
  "activity-skill-executor.mjs": [
    "bc91ef3cf9d2033a63048d84ec9243b7d211ed16db579b6a5b84ad6a347637ce"
  ],
  "activity-skill-primary-broker.mjs": [
    "d949bd309d15948712ab5a3ab75411abb5daaf1d97f9c54d6b677de06db4f83a"
  ],
  "activity-skill-parent-loop.mjs": [
    "183ff8a4a44e21045ac39ada62f4599342b2972a91e998ecb0ec8d8de5b3a9ab"
  ],
  "preflight-phone-scope.mjs": [
    "25a95776d5d5695249471b6b0216a74f8373935cef55fb4c45525654fc95eebb"
  ],
  "preflight-phone-driver.mjs": [
    "1b224f6dfe4079f9d580f1ea47fddde4a888b3d7e17f90d4de18d514e3fc1631"
  ],
  "preflight-native-domain.mjs": [
    "e5c6c4eebf877311676fd8ac1076f87d446c25f8baa41ef9b8ef8f86ac32cfd7"
  ],
  "preflight-local-leaves.mjs": [
    "ee6c0228e330b669bd99c93775a4eea66caedfbd5897abd9154d35b884ad40fc"
  ],
  "preflight-local-step.py": [
    "1c9b04539c5d09bbc736e3c8c19c77e97d415cd2bdf42da24fcd167f6e76eab0"
  ],
  "collection-leaf-producer.mjs": [
    "2f27ccadb94d2ddae0a60c5adec7b4e5ba1d37ba486e52313889fbe862502c91"
  ],
  "native-phone-runtime.mjs": [
    "87d2ee305cb696648bb966dd5ab3451af2b7591b5cf87ed674e213f954e80527"
  ],
  "native-phone-preflight-adapter.mjs": [
    "e1b5a31b917659f2b1f9f1f107fa9b1ab2bcc10f4174dd10ab6538064d57689c"
  ],
  "native-phone-command-source.mjs": [
    "54b6cda6353f717a3a88bdc0375307a5f8191802f02b4442ebfc21072bff7248"
  ],
  "native-phone-adb-read.mjs": [
    "2182ad4e8f0961602c674dde436215c88de40f78195de0b99a1ce6dd76252adf"
  ],
  "adb-shell-v2.mjs": [
    "a2bb83e41799952edee446fe249463e3c40775ce71eabc72b6393cf4fcfedc64"
  ],
  "adb-shell-v2-protocol.mjs": [
    "1e8b07c7ad2d009e9ad0c302a4d3e3443507bbf986a91184d9898d7e240f6400"
  ],
  "runner-official-commander.mjs": [
    "1da2bbd524908874ee5ff497a4661f44cb7330975057f9fa8a1be18eb5eaa8b3"
  ],
  "official-agent-control.mjs": [
    "f132d7c9ccd6db26665214090cbffddb667c6feb9044db9a98e055ac01458c36"
  ],
  "official-commander-sdk.mjs": [
    "47b372ced240b0dd6bacdcb74a22aa481a985b6e1993affc1073007a46482d86"
  ],
  "official-model-turn.mjs": [
    "046892302e41f08862e225e56bcde6f2815772b2dd24c8a972407afbb6a37454"
  ],
  "official-gateway-runtime.mjs": [
    "7dcea7a501390110b938c2fd73d1c4b2f832ec93624180869c1de4bd49b10abb"
  ],
  "commander-bounded-owner.mjs": [
    "39e04a6aea9d8b5a8e7cdca49c9359642eb331b6fa4a10e55293a761a0c7a508"
  ],
  "commander-owner-lock.mjs": [
    "29e09711bb8a4854a04f370b1d6685037504ace7f5c57b1ae5cebf4c547b6f73"
  ],
  "commander-owner-state.mjs": [
    "c44435a1cab93a663f85522341987992e43dc223a2aa914e3219a2e58bd2287b"
  ],
  "activity-commander.mjs": [
    "10154be0a6490cb377dffd32b1d2fb866fb8c05237859efd3d0addbacbb123a6"
  ]
});
for(const hashes of Object.values(reviewedSourceHashes))Object.freeze(hashes);
import {openSync,readFileSync,closeSync,fstatSync,lstatSync,readdirSync,realpathSync,constants} from 'node:fs';import {join,resolve,relative} from 'node:path';import {createHash} from 'node:crypto';
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const need=(ok,code)=>{if(!ok)throw Error('PREFLIGHT_REVIEW_'+code);};
export function readSafe(path){
 need(typeof path==='string'&&resolve(path)===path&&realpathSync(path)===path,'PATH');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=fstatSync(fd);need(a.isFile()&&a.uid===process.getuid()&&a.nlink===1&&!(a.mode&0o022)&&a.size<=64*1024*1024,'FILE');const raw=readFileSync(fd),b=fstatSync(fd),c=lstatSync(path);need(raw.length===a.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]&&a[k]===c[k]),'FILE_DRIFT');return raw;}finally{closeSync(fd);}
}
export const json=path=>JSON.parse(readSafe(path));
export const rows=path=>readSafe(path).toString().split('\n').filter(Boolean).map(line=>JSON.parse(line));
export function inventory(root){
 need(realpathSync(root)===root&&lstatSync(root).isDirectory(),'DIRECTORY');const out={};
 const walk=(path,prefix='')=>{for(const entry of readdirSync(path,{withFileTypes:true})){const rel=prefix+entry.name,p=join(path,entry.name),st=lstatSync(p);need(!st.isSymbolicLink(),'SYMLINK');if(entry.isDirectory())walk(p,rel+'/');else{need(entry.isFile(),'FILE_TYPE');const raw=readSafe(p);out[rel]={sha256:sha(raw),bytes:raw.length};}}};walk(root);return out;
}
const keys=['task_id','run_id','binding_id','source_commit','profile','serial','owner','epoch'];
const identity=(value,original,subset=keys)=>need(subset.every(key=>value?.[key]===original[key]),'IDENTITY');
export function callerClosed(run,files,original){
 const names=Object.keys(files).filter(name=>/\/official-caller-final-[a-f0-9-]+\.json$/.test(name));need(names.length===3,'CALLER_INVENTORY');let worker=0,turns=[];
 for(const name of names){
  const final=json(join(run,name)),s=final.snapshot;identity(final,original,['task_id','run_id','binding_id','source_commit']);
  need(final.not_recovery_authority===true&&final.journal_closed===true&&final.evidence_complete===true&&s.sealed===true&&s.pending===0&&s.execution_stopped===true&&s.caller_execution_stopped===true&&['execution_unknown','external_effect_unknown','previous_caller_stop_unproven','final_record_failed'].every(k=>s[k]===false),'CALLER_CLOSED');
  for(const artifact of [final.ledger,...final.artifacts]){need(/^[A-Za-z0-9_.-]+$/.test(artifact.file),'CALLER_PATH');const path=join(run,name.slice(0,name.lastIndexOf('/')),artifact.file),raw=readSafe(path);need(sha(raw)===artifact.sha256&&raw.length===artifact.bytes,'CALLER_ARTIFACT');}
  if(name.startsWith('skill-primary/preflight/official-control/')){worker++;turns=final.raw_turns;need(final.raw_turns.length<=1&&final.raw_turns.every(turn=>turn.index===0&&['dispatched','accepted','official_terminal','recovered'].every(k=>turn[k]===false)),'WORKER_DISPATCHED');}
  else need(final.raw_turns.length===0,'OBSERVER_WORKER_CAPABILITY');
 }
 need(worker===1,'WORKER_CALLER_MISSING');
 const raw=Object.keys(files).filter(name=>name.startsWith('skill-primary/preflight/official-control/official-authority-')&&name.endsWith('.jsonl')).flatMap(name=>rows(join(run,name))).filter(row=>row.event==='raw_stop_verified');
 need(raw.length===turns.length&&raw.every((row,i)=>row.official_run_id===turns[i].official_run_id&&row.source_session_id===turns[i].source_session_id&&row.source_session_key===turns[i].source_session_key&&row.session_id===turns[i].execution_session_id&&row.index===turns[i].index&&row.status==='not_started'&&row.official_execution_stopped===true&&row.external_effect_unknown===false&&row.previous_caller_stop_unproven===false&&Array.isArray(row.transport_proofs)&&row.transport_proofs.length===0),'RAW_STOP');
}
export function nativeClosed(run,files,original){
 const closes=rows(join(run,'preflight-native-domain-close.jsonl'));need(closes.length===1,'NATIVE_INVENTORY');const d=closes[0],p=d.physical;
 identity(d,original);need(d.activity==='preflight'&&d.official_stopped===true&&d.resource_unknown===false&&p.domain==='parent-preflight-local-nofork-v1'&&p.execution_stopped===true&&p.pending===0&&p.command_failures===0&&canonical(d.control)===canonical({sealed:true,pending:0,execution_stopped:true}),'NATIVE_CLOSED');
 const local=p.local;need(local.sealed===true&&local.execution_stopped===true&&local.leaves.length===2&&local.leaves.map(l=>l.operation).join(',')==='lock,route'&&local.leaves.every(l=>l.code===0&&l.signal===null&&l.tainted===false&&l.ended_at&&l.boundary==='darwin-sandbox-deny-process-fork-v1'),'LOCAL_LEAVES');
 need(p.adb.complete===true&&p.adb.requests_returned===true&&p.adb.leaves.length===2&&p.adb.leaves.every(l=>l.code===0&&l.signal===null&&l.tainted===false&&l.request_returned===true&&l.boundary==='darwin-sandbox-deny-process-fork-v1'),'ADB_LEAVES');
 const commandFiles=Object.keys(files).filter(name=>/^native-phone\/preflight\/command-\d+\.native\.json$/.test(name));need(commandFiles.length>0&&commandFiles.length<=5,'PHONE_INVENTORY');
 const programs={sdk:"exec /system/bin/getprop 'ro.build.version.sdk'",model:"exec /system/bin/getprop 'ro.product.model'",telecom:"exec /system/bin/dumpsys 'telephony.registry'",foreground:"exec /system/bin/dumpsys 'window' 'displays'",window:"exec /system/bin/dumpsys 'window'"};
 let endpoint;
 const request=text=>Buffer.from(Buffer.byteLength(text).toString(16).padStart(4,'0')+text);
 for(const name of commandFiles){
  const c=json(join(run,name)),w=c.wire_snapshot;identity(c.scope,original,['task_id','run_id','binding_id','source_commit','profile','serial']);need(programs[c.operation]&&c.error_code===null&&w.sealed===true&&w.pending===0&&w.open_sockets===0&&w.unknown===false&&w.wire_complete===true,'PHONE_NOT_READONLY');
  need(/^tcp:127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(c.scope.endpoint)&&(!endpoint||endpoint===c.scope.endpoint),'ENDPOINT');endpoint=c.scope.endpoint;
  const dir=join(run,name.replace(/\.native\.json$/,'')),expected=[request('host-serial:'+original.serial+':features'),request('host:transport:'+original.serial),request('shell,v2,raw:'+programs[c.operation]),Buffer.from([4,0,0,0,0])];
  const writes=readdirSync(dir).filter(n=>/^write-\d+\.intent\.json$/.test(n));need(writes.length===4,'PHONE_WIRE_INVENTORY');for(let i=0;i<4;i++){const x=json(join(dir,'write-'+i+'.intent.json'));need(x.bytes===expected[i].length&&x.sha256===sha(expected[i]),'PHONE_WIRE');}
 }
 const adbHashes=[sha(JSON.stringify(['version'])),sha(JSON.stringify(['-H','127.0.0.1','-P',endpoint.split(':').at(-1),'-s',original.serial,'get-state']))];need(p.adb.leaves.every((leaf,index)=>leaf.argv_sha256===adbHashes[index]),'ADB_READ_ONLY');
 need(!Object.keys(files).some(name=>/^native-phone\/(?!preflight\/)/.test(name)||/^native-phone\/preflight\/(?:queue|vision|ui|search|link|evidence)/.test(name)||/^skill-primary\/(?!preflight\/)/.test(name)||/^agent-tools\/(?!preflight\/)/.test(name)),'EXTRA_PRODUCER');
 const sourceRoot=join(run,'native-phone/preflight/source'),intents=readdirSync(sourceRoot).filter(n=>/^read-\d+\.intent\.json$/.test(n));need(intents.length>0&&!Object.keys(files).some(name=>/^native-phone\/.*\.unknown\.json$/.test(name)),'SOURCE_READ_UNKNOWN');
 const policy=json(join(run,'runtime/config/native-phone-command-sources.json')),matches=policy.device_sources.filter(row=>row.profile===original.profile&&row.serial===original.serial);need(matches.length===1,'SOURCE_POLICY');const allowed=matches[0].program_files;need(intents.length===allowed.length,'SOURCE_INVENTORY');
 for(let i=0;i<allowed.length;i++){const intent=json(join(sourceRoot,'read-'+i+'.intent.json')),done=json(join(sourceRoot,'read-'+i+'.returned.json'));need(intent.id===i&&intent.path===allowed[i].path&&done.id===i&&done.path===intent.path&&done.sha256===allowed[i].sha256&&done.peer_eof===true&&done.socket_closed===true,'SOURCE_READ_RETURNED');}
 for(const ledger of [p.adb.ledger,local.ledger]){need(ledger.startsWith(run+'/'),'LEAF_PATH');const entries=rows(ledger);need(entries.length===6,'LEAF_LEDGER');for(let i=0;i<entries.length;i+=3){const a=entries[i],b=entries[i+1],c=entries[i+2];need((a.event??a.phase)==='intent'&&(b.event??b.phase)==='started'&&['returned','exit'].includes(c.event??c.phase)&&b.pid===c.pid&&c.code===0&&c.signal===null&&c.tainted===false,'LEAF_LEDGER_CLOSED');}}
}
export function observerClosed(run,files,original){
 const values=rows(join(run,'activity-events.jsonl')).filter(row=>row.phase==='commander_domain_closed');need(values.length===1,'OBSERVER_INVENTORY');const observer=values[0].evidence;
 need(observer.domain==='runner-phone-observer/v1'&&observer.activities.length===1&&observer.activities[0].activity==='preflight','OBSERVER_SCOPE');const e=observer.activities[0].evidence;
 need(e.domain==='runner-official-observer/v1'&&e.sdk.sealed===true&&e.sdk.pending===0&&e.control.sealed===true&&e.control.pending===0&&e.control.execution_stopped===true&&e.control.caller_execution_stopped===true,'OBSERVER_CALLER_CLOSED');
 need(e.owner.sealed===true&&e.owner.pending===0&&canonical(e.owner.calibration)===canonical({positive_closed:true,fork_denied:true})&&e.owner.leaves.length>=2,'OWNER_CLOSED');
 for(const [i,leaf]of e.owner.leaves.entries())need(leaf.purpose===(i===0?'calibration-positive':i===1?'calibration-negative':'owner')&&leaf.code===(i===1?1:0)&&leaf.signal===null&&leaf.closing===true&&['process_closed','stdin_closed','stdout_closed','stderr_closed','fd_closed'].every(k=>leaf[k]===true),'OWNER_PROCESS_OPEN');
 const sdkFiles=Object.keys(files).filter(name=>name.startsWith('commander-preflight/sdk/')&&name.endsWith('.agent.rpc.json'));need(sdkFiles.length>0,'OBSERVER_RPC');
 for(const name of sdkFiles){const rpc=json(join(run,name));need(['request_closed','websocket_closed','socket_closed'].every(k=>rpc[k]===true),'OBSERVER_TRANSPORT_OPEN');if(rpc.dispatched){const base=name.slice(0,-'.agent.rpc.json'.length),agent=json(join(run,base+'.agent.response.json')),wait=json(join(run,base+'.agent.wait.response.json')),tr=agent.receipt;need(agent.agent_meta.provider_matches===true&&agent.agent_meta.model_matches===true&&agent.agent_meta.agent_harness_id_matches===true&&tr.successful_tool_names_array===true&&tr.successful_tool_names_empty===true&&tr.rerouted_false===true&&tr.expected_session_id_matches===true&&tr.run_id_matches===true,'OBSERVER_TOOL_OR_DELIVERY');const w=wait.receipt;if(w.declared)need(w.successful_tool_names_array===true&&w.successful_tool_names_empty===true&&w.rerouted_false===true&&w.expected_session_id_matches===true,'OBSERVER_WAIT_TOOLS');const wr=json(join(run,base+'.agent.wait.rpc.json'));need(wr.dispatched===true&&wr.response_received===true&&['request_closed','websocket_closed','socket_closed'].every(k=>wr[k]===true),'OBSERVER_WAIT_OPEN');}}
 return {domain:observer.domain,remote_execution_stopped:false,remote_unknown_preserved:observer.execution_stopped!==true||e.sdk.execution_unknown===true||e.owner.execution_unknown===true};
}
export function verifyPreflightEvidence({runDir,original,home,sourcePolicy=reviewedSourceHashes}={}){
 need(typeof runDir==='string'&&original&&typeof home==='string','INPUT_NOT_PROOF');const files=inventory(runDir),frozen=json(join(runDir,'run-definition.json')),{snapshot_sha256,...body}=frozen;need(sha(canonical(body))===snapshot_sha256,'FROZEN_DIGEST');
 need(frozen.execution_mode==='agent'&&frozen.execution_transport==='raw-model-v1'&&frozen.agent_input.workflow_key==='douyin_video_discovery'&&frozen.agent_input.run_tag===original.owner&&frozen.agent_input.task_id===original.task_id&&frozen.deployment.source_commit===original.source_commit&&frozen.deployment.target==='mmv','FROZEN_SCOPE');
 for(const [name,digest]of Object.entries(frozen.files))need(files[name]?.sha256===digest,'FROZEN_BYTES');
 for(const [name,allowed]of Object.entries(sourcePolicy))need(allowed.includes(files['runtime/'+name]?.sha256),'UNREVIEWED_SOURCE');
 const preflight=json(join(runDir,'activity-preflight.json')),cleanup=json(join(runDir,'activity-cleanup.json')),collect=json(join(runDir,'activity-collect_videos.json'));need(preflight.execution_stopped===true&&preflight.status==='needs_review'&&cleanup.execution_stopped===false&&cleanup.status==='needs_review'&&collect.status==='blocked','ORIGINAL_OUTCOME');
 const quarantine=json(join(runDir,'resource-quarantine.json'));need(quarantine.verified===true&&quarantine.claim_receipt_unknown===false&&quarantine.device?.verified===true&&quarantine.device.physical_actions===0&&Array.isArray(quarantine.videos)&&quarantine.videos.length===0,'BUSINESS_EFFECT');
 callerClosed(runDir,files,original);nativeClosed(runDir,files,original);const observer=observerClosed(runDir,files,original);
 const name='workflow-'+sha(JSON.stringify(['runner-observer/v1',original.run_id,original.source_commit,original.binding_id,original.task_id])).slice(0,32),root=join(home,'.openclaw/leadgen-owner-turns'),owners={},ownerOriginals={};
 const names=readdirSync(root).filter(file=>file.startsWith(name));need(names.includes(name+'.pending.json')&&names.includes(name+'.pending.json.guard'),'OWNER_INVENTORY');for(const file of names){const raw=readSafe(join(root,file));owners[file]={sha256:sha(raw),bytes:raw.length};ownerOriginals[file]=raw.toString('base64');if(file.endsWith('.guard'))need(file===name+'.pending.json.guard'&&raw.length===0,'OWNER_GUARD');else{need(file.endsWith('.json'),'OWNER_TYPE');const data=JSON.parse(raw),scope=data.scope??data;identity(scope,original,['task_id','run_id','binding_id','source_commit']);}}
 need(json(join(root,name+'.pending.json')).status==='reserved','OWNER_PENDING_PRESERVED');
 return {files,original,owner_files:owners,owner_originals_base64:ownerOriginals,frozen_sha256:sha(readSafe(join(runDir,'run-definition.json'))),runtime_snapshot_sha256:snapshot_sha256,observer,original_execution_stopped:false,authority_basis:'sealed-local-producers-unstarted-worker-readonly-phone-noninterference'};
}
