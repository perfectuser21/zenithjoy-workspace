// 每个事件先落盘再联网；固定body与状态分离，不持久化认证信息。
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join,dirname } from 'node:path';
function atomic(path,value){const temp=`${path}.${randomUUID()}.tmp`;writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});const fd=openSync(temp,'r');fsyncSync(fd);closeSync(fd);renameSync(temp,path);const parent=openSync(dirname(path),'r');fsyncSync(parent);closeSync(parent);}
const id = key => createHash('sha256').update(key).digest('hex');
export function occurrence(dir,slot,start=false,startedAt=null) {
  mkdirSync(join(dir,'occurrences'),{recursive:true,mode:0o700});const file=join(dir,'occurrences',`${id(slot)}.json`);
  if(!start&&existsSync(file))return JSON.parse(readFileSync(file,'utf8'));
  const value={key:randomUUID(),slot,started_at:startedAt||new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};atomic(file,value);return value;
}
export function enqueue(dir,{key,endpoint,body}) {
  if(!/^https?:\/\//.test(endpoint))throw Error('outbox endpoint缺失');
  const url=new URL(endpoint);if(url.username||url.password||url.search)throw Error('outbox endpoint不能含凭据');
  const folder=join(dir,'outbox');mkdirSync(folder,{recursive:true,mode:0o700});
  const event_id=id(key);const file=join(folder,`${event_id}.json`);
  if(existsSync(file))return JSON.parse(readFileSync(file,'utf8'));
  const event={event_id,occurrence_key:key,endpoint,body,state:'pending',attempts:0,created_at:new Date().toISOString()};atomic(file,event);return event;
}
export async function flush(dir,{send,limit=20}={}) {
  const folder=join(dir,'outbox');if(!existsSync(folder))return {pending:0,sent:0,blocked:0};
  let count=0;
  for(const name of readdirSync(folder).filter(n=>n.endsWith('.json')).sort()){
    const file=join(folder,name);const event=JSON.parse(readFileSync(file,'utf8'));
    if(event.state!=='pending'||count++>=limit)continue;
    let code=0;try{code=await send(event);}catch{ /* 网络失败只保留pending；不记录可能含token的错误文本。 */ }
    event.attempts++;event.last_attempt_at=new Date().toISOString();event.http_status=code;
    if(code>=200&&code<300)event.state='sent';else if(code===409)event.state='blocked';
    atomic(file,event);
  }
  const status={pending:0,sent:0,blocked:0};for(const n of readdirSync(folder).filter(n=>n.endsWith('.json')))status[JSON.parse(readFileSync(join(folder,n),'utf8')).state]++;
  atomic(join(dir,'evidence-status.json'),status);return status;
}
