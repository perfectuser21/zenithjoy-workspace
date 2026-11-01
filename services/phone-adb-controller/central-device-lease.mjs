import {openSync,closeSync,writeFileSync,readFileSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
const TASK_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function persistCentralTaskAssociation(dir,receipt){
  const path=join(dir,'central-task-association.json'),bytes=JSON.stringify(receipt);
  if(receipt?.kind!=='verified_external_task_association'||Buffer.byteLength(bytes)>4096)throw Error('CENTRAL_TASK_ASSOCIATION_INVALID');
  let fd;
  try{fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);writeFileSync(fd,bytes);return receipt;}
  catch(error){if(error.code!=='EEXIST')throw error;}
  finally{if(fd!==undefined)closeSync(fd);}
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.size>4096||readFileSync(fd,'utf8')!==bytes)throw Error('CENTRAL_TASK_ASSOCIATION_CHANGED');}
  finally{closeSync(fd);}
  return receipt;
}

// Brain external run bindings have no task_id field. This derived receipt keeps
// that public binding intact while requiring the actual Task and live lease.
export async function verifyCentralTaskAssociation({lease,workflowKey,companyLine,sourceCommit,runTag,taskId,projectId,deviceName,runId,binding,scope,snapshotSha256}){
  if(!TASK_ID.test(taskId||'')||projectId&&!TASK_ID.test(projectId)||!binding?.id||binding.run_id!==runId
    ||binding.task_id!==null||scope?.task_id!==taskId||scope.run_id!==runId||scope.serial!==deviceName
    ||scope.source_commit!==sourceCommit||lease?.taskId!==taskId||lease.runId!==runId||lease.deviceName!==deviceName
    ||!/^[a-f0-9]{64}$/.test(snapshotSha256||''))throw Error('CENTRAL_TASK_ASSOCIATION_MISMATCH');
  const task=await lease.verifyTask({workflowKey,companyLine,sourceCommit,runTag});
  if(task.id!==taskId||!TASK_ID.test(task.project_id||'')||projectId&&task.project_id!==projectId)throw Error('CENTRAL_TASK_ASSOCIATION_MISMATCH');
  await lease.verifyHeld();
  return {version:1,kind:'verified_external_task_association',task_id:taskId,project_id:task.project_id,run_id:runId,
    binding_id:binding.id,source_commit:sourceCommit,device_name:deviceName,workflow_key:workflowKey,
    runtime_snapshot_sha256:snapshotSha256,central_owner:taskId};
}

export function createCentralDeviceLease({brainUrl,token,deviceName,taskId,runId,expectedProjectId,fetcher=globalThis.fetch,now=Date.now,runSeconds=1800}){
  if(!TASK_ID.test(taskId||'')||!runId)throw Error('CENTRAL_LOCK_TASK_REQUIRED');
  if(expectedProjectId&&!TASK_ID.test(expectedProjectId))throw Error('CENTRAL_LOCK_PROJECT_INVALID');
  if(!/^https?:\/\/[^/]+$/.test((brainUrl||'').replace(/\/$/,''))||!token||!deviceName)throw Error('CENTRAL_LOCK_CONFIG_REQUIRED');
  if(!Number.isSafeInteger(Number(runSeconds))||Number(runSeconds)<1||Number(runSeconds)>86400)throw Error('CENTRAL_LOCK_BUDGET_INVALID');
  const base=brainUrl.replace(/\/$/,'')+'/api/brain';
  const ttlMinutes=Math.max(50,Math.ceil(Number(runSeconds)/60)+10);
  let held=false,attempted=false,lastVerified=0,expiresAt=0;
  async function request(path,body){
    let response,data;
    try{
      response=await fetcher(base+path,{method:body?'POST':'GET',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});
      data=await response.json();
    }catch{throw Error('CENTRAL_LOCK_UNKNOWN');}
    if(!response.ok||!data||typeof data!=='object')throw Error('CENTRAL_LOCK_UNKNOWN');
    return data;
  }
  async function readback(expected){
    const data=await request('/device-locks');
    const rows=data.locks?.filter(row=>row.device_name===deviceName);
    if(data.success!==true||rows?.length!==1)throw Error('CENTRAL_LOCK_UNKNOWN');
    const lock=rows[0];
    if(lock.locked_by!==expected)throw Error('CENTRAL_LOCK_OWNER_MISMATCH');
    if(expected){
      const expires=Date.parse(lock.expires_at||'');
      if(!Number.isFinite(expires)||expires<=now()+5000)throw Error('CENTRAL_LOCK_EXPIRED');
      expiresAt=expires;
    }else expiresAt=0;
    lastVerified=now();return lock;
  }
  async function acquire(){
    attempted=true;
    const result=await request('/device-locks/acquire',{device_name:deviceName,locked_by:taskId,ttl_minutes:ttlMinutes});
    if(result.acquired===false){attempted=false;throw Error('CENTRAL_LOCK_BUSY');}
    if(result.acquired!==true||result.lock?.device_name!==deviceName||result.lock?.locked_by!==taskId)throw Error('CENTRAL_LOCK_UNKNOWN');
    held=true;await readback(taskId);return result.lock;
  }
  async function renew(){
    if(!held)throw Error('CENTRAL_LOCK_NOT_HELD');
    return acquire();
  }
  async function ensure(){
    if(!held)throw Error('CENTRAL_LOCK_NOT_HELD');
    if(now()-lastVerified>=60000||expiresAt<=now()+120000)await renew();
  }
  async function verifyHeld(){
    if(!held)throw Error('CENTRAL_LOCK_NOT_HELD');
    return readback(taskId);
  }
  async function release(){
    if(!held&&!attempted)return false;
    if(!held){const current=await readback(taskId);if(!current)throw Error('CENTRAL_LOCK_UNKNOWN');held=true;}
    const result=await request('/device-locks/release',{device_name:deviceName,locked_by:taskId});
    if(result.success!==true||result.released?.device_name!==deviceName||result.released?.locked_by!==null)throw Error('CENTRAL_LOCK_RELEASE_UNKNOWN');
    await readback(null);held=false;attempted=false;return true;
  }
  async function verifyTask({workflowKey,companyLine,sourceCommit,runTag}){
    const task=await request('/tasks/'+taskId);
    const p=task.payload;
    if(task.id!==taskId||task.status!=='in_progress'||!TASK_ID.test(task.project_id||'')
      ||(expectedProjectId&&task.project_id!==expectedProjectId)
      ||!p||p.workflow_key!==workflowKey||p.device_serial!==deviceName||p.company_line!==companyLine
      ||p.source_commit!==sourceCommit||p.run_tag!==runTag)throw Error('CENTRAL_LOCK_TASK_MISMATCH');
    return task;
  }
  return {verifyTask,acquire,renew,ensure,verifyHeld,release,get held(){return held;},get attempted(){return attempted;},taskId,runId,deviceName};
}
