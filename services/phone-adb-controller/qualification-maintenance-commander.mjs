import {lstatSync,readdirSync,openSync,readFileSync,fstatSync,closeSync,constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {digest} from './runtime-definition.mjs';
import {workflowCommanderSession} from './commander-owner-state.mjs';
const need=value=>{if(!value)throw Error('MAINTENANCE_COMMANDER_ACTIVITY_UNKNOWN');};
async function gatewayRead(method,params) {
 need(['sessions.describe','chat.history','sessions.list'].includes(method));
 try{return JSON.parse(execFileSync('openclaw',['gateway','call',method,'--json','--timeout','10000','--params',JSON.stringify(params)],
  {encoding:'utf8',timeout:12000,maxBuffer:2*1024*1024}));}catch{throw Error('MAINTENANCE_COMMANDER_ACTIVITY_UNKNOWN');}
}
export async function readCommanderClosure(scope,{home=homedir(),get=gatewayRead,rawTaskId=null}={}) {
 const identity={run_id:'douyin_video_processing-'+scope.run_tag+'__a1',source_commit:scope.consumer_source,binding_id:scope.binding_id,task_id:rawTaskId};
 need(rawTaskId===null||rawTaskId===scope.original_task_id);
 const session=workflowCommanderSession(identity),directory=join(home,'.openclaw','leadgen-owner-turns');
 for(const dir of [join(home,'.openclaw'),directory]){const s=lstatSync(dir);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o022)===0);}
 const prefix=session.split(':').at(-1)+'.pending.json';
 const noPending=()=>{try{lstatSync(join(directory,prefix));need(false);}catch(e){if(e.code!=='ENOENT')throw e;}};
 noPending();
 const names=()=>readdirSync(directory).filter(n=>n.startsWith(prefix)).sort();
 const first=names(),returned=first.filter(n=>/\.returned\.json$/.test(n));need(returned.length===5);
 const expected=new Set([prefix+'.guard']);const archives=[],consumed=[];
 const raw=name=>{
  const path=join(directory,name),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const a=fstatSync(fd);need(a.isFile()&&a.uid===process.getuid()&&(a.mode&0o077)===0&&a.nlink===1&&a.size<=16384);
   const value=readFileSync(fd),b=fstatSync(fd),p=lstatSync(path);need(value.length===a.size&&a.ino===b.ino&&a.ctimeMs===b.ctimeMs&&a.ino===p.ino&&a.dev===p.dev);return value;
  }finally{closeSync(fd);}
 };
 for(const name of returned) {
  const originalName=name.replace(/\.returned\.json$/,'.returned.original.json');expected.add(name);expected.add(originalName);
  const originalRaw=raw(originalName),receiptRaw=raw(name),original=JSON.parse(originalRaw),receipt=JSON.parse(receiptRaw);
  consumed.push([originalName,digest(originalRaw)],[name,digest(receiptRaw)]);
  need(original.protocol==='commander-owner-turn-v1'&&original.status==='reserved'&&receipt.status==='returned'
   &&receipt.original_sha256===digest(originalRaw)&&/^[a-f0-9]{64}$/.test(receipt.response_sha256||''));
  for(const [key,value]of Object.entries({...identity,session}))need(original[key]===value&&receipt[key]===value);
  need(typeof original.transport_nonce==='string'&&name===prefix+'.'+original.transport_nonce+'.returned.json'&&receipt.transport_nonce===original.transport_nonce);
  archives.push({original_sha256:digest(originalRaw),receipt_sha256:digest(receiptRaw),response_sha256:receipt.response_sha256});
 }
 need(first.every(n=>expected.has(n)));
 const describe=await get('sessions.describe',{key:session,agentId:'work-commander'});
 const history=await get('chat.history',{sessionKey:session,agentId:'work-commander',limit:1,maxBytes:1024});
 // 限定353本轮本应没有任何执行child；不只查active直系而漏掉已结束父child的活孙。
 const children=await get('sessions.list',{spawnedBy:session,archived:'all',limit:50,includeLastMessage:false,includeDerivedTitles:false});
 need(describe?.session===null||describe.session?.key===session&&describe.session.hasActiveRun===false);
 need(history?.sessionKey===session&&history.sessionInfo?.key===session&&history.sessionInfo.hasActiveRun===false
  &&Array.isArray(history.sessionInfo.activeRunIds)&&history.sessionInfo.activeRunIds.length===0
  &&history.pendingInputs?.total===0&&Array.isArray(history.pendingInputs.items)&&history.pendingInputs.items.length===0&&!history.inFlightRun);
 need(children?.count===0&&children.totalCount===0&&children.hasMore===false&&children.nextOffset===null&&Array.isArray(children.sessions)&&children.sessions.length===0);
 noPending();need(digest(first)===digest(names()));
 for(const [name,sha256]of consumed)need(digest(raw(name))===sha256);
 return {status:'verified_inactive',domain:'exact_original_commander_owner',os_full_stop:false,session,returned_turns:5,
  archives_sha256:digest(archives),official_sha256:digest({describe,history,children}),observed_at_ms:Date.now()};
}
