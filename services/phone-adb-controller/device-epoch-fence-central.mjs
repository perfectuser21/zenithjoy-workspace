// 仅本次真正强CAS成功且fresh读回free才签发进程内cap；网络未知永不自动重试。
const receipts=new WeakMap(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const version=v=>typeof v==='string'&&/^[1-9][0-9]{0,9}$/.test(v)&&BigInt(v)<=4294967295n;
const row=value=>({device_name:value.device_name,locked_by:value.locked_by,locked_at:value.locked_at,expires_at:value.expires_at,lease_version:value.lease_version});
async function request(path,method='GET',body){
 need(path==='/api/brain/device-locks'||path==='/api/brain/device-locks/release'||/^\/api\/brain\/tasks\/[a-f0-9-]{36}$/.test(path),'CENTRAL_PATH');const token=process.env.BRAIN_INTERNAL_TOKEN;need(typeof token==='string'&&token&&!/[\r\n]/.test(token),'CENTRAL_CREDENTIAL');const r=await fetch('http://127.0.0.1:5221'+path,{method,headers:{'X-Internal-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)}),raw=await r.text();need(r.headers.get('content-type')?.startsWith('application/json')&&Buffer.byteLength(raw)<=8*1024*1024,'CENTRAL_RESPONSE');return {status:r.status,body:JSON.parse(raw)};
}
const readDefault=async path=>{const r=await request(path);need(r.status===200,'CENTRAL_READ');return r.body;};
const postDefault=(path,body)=>request(path,'POST',body);
export function readReleaseProof(cap){const r=receipts.get(cap);need(r,'CENTRAL_RECEIPT');return structuredClone(r);}
export async function releaseCentralLease({scope,lease,read=readDefault,post=postDefault,readAuthority}={}){
 need(uuid.test(scope?.maintenance_task_id||'')&&typeof scope.serial==='string'&&scope.claim?.claimed_by&&Number.isFinite(Date.parse(scope.claim.claimed_at)),'CENTRAL_SCOPE');need(version(lease?.lease_version),'CENTRAL_LEASE_VERSION');
 const taskValue=await read('/api/brain/tasks/'+scope.maintenance_task_id),task=taskValue.task??taskValue;need(task.id===scope.maintenance_task_id&&task.status==='in_progress'&&task.claimed_by===scope.claim.claimed_by&&task.claimed_at===scope.claim.claimed_at,'CENTRAL_TASK');
 const rows=await read('/api/brain/device-locks'),found=rows.locks?.filter(r=>r.device_name===scope.serial);need(rows.success===true&&found?.length===1&&found[0].locked_by===scope.maintenance_task_id&&canonical(row(found[0]))===canonical(row(lease))&&Date.parse(found[0].expires_at)>Date.now()+5000,'CENTRAL_LEASE_DRIFT');
 await readAuthority?.();let response=null,failure=null;try{response=await post('/api/brain/device-locks/release',{device_name:scope.serial,locked_by:scope.maintenance_task_id,expected_lease_version:lease.lease_version});}catch{failure='CENTRAL_ACK_UNKNOWN';}
 // 即使ACK错误/断连，也仅GET一次实际状态；从不补发release。
 let readback=null;try{const current=await read('/api/brain/device-locks'),matches=current.locks?.filter(r=>r.device_name===scope.serial);need(current.success===true&&matches?.length===1,'CENTRAL_READBACK');readback=matches[0];}catch{failure??='CENTRAL_READBACK_UNKNOWN';}
 const released=response?.body?.released;
 if(failure||response?.status!==200||response.body?.success!==true||!released||released.device_name!==scope.serial||released.locked_by!==null||released.locked_at!==null||released.expires_at!==null||!version(released.lease_version)||released.lease_version===lease.lease_version||!readback||canonical(row(released))!==canonical(row(readback)))return {status:'unknown',error_code:failure??'CENTRAL_RELEASE_NOT_CONFIRMED',ack:response,readback,receipt:null,retry_allowed:false};
 const cap=Object.freeze({protocol:'device-epoch-fence-central-release/v1',expected_lease_version:lease.lease_version,released_lease_version:released.lease_version});receipts.set(cap,{scope:structuredClone(scope),expected:row(lease),current:row(readback)});
 return {status:'released',ack:response,readback,receipt:cap,retry_allowed:false};
}
