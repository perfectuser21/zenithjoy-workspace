// 宿主内部批准绑定；不提供Agent工具、订单操作或发送入口。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)+'\n';
const need=(ok,code)=>{if(!ok)throw Error('LEADGEN_AUTH_INTENT_'+code);};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SCOPE=['company_id','tenant_id','line','account','sender_id','host','profile','serial','adb_serial','policy_id','policy_version','message_sha256','scope'];
const ORDER=['record_id','comment_id','lead_id','target_douyin_id','profile_url','source_102_run','source_103_run'];
const INTENT=['schema','machine_id','decision_id','authorizing_root_task_id','scope','message','message_sha256','max_new_recipients','max_send_attempts','test_execution_daily_cap','company_policy_changed','requires_current_pause_and_daily_count_readback'];
function keys(value,expected){
 need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'OBJECT');
 need(Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k)),'FIELDS');
}
function text(value){need(typeof value==='string'&&value.trim().length>0&&value.length<=4096,'STRING');}
function scope(value){
 keys(value,SCOPE);keys(value.scope,ORDER);
 for(const key of SCOPE.filter(k=>!['policy_version','scope'].includes(k)))text(value[key]);
 for(const key of ORDER)text(value.scope[key]);
 need(Number.isSafeInteger(value.policy_version)&&value.policy_version>0&&SHA.test(value.message_sha256),'SCOPE');
}
function actualPath(file){need(typeof file==='string'&&path.isAbsolute(file)&&path.resolve(file)===file&&fs.realpathSync(file)===file,'PATH');}
function directory(file){
 actualPath(file);const stat=fs.lstatSync(file);
 need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700,'DIRECTORY');
}
function privateBytes(file){
 actualPath(file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const stat=fs.fstatSync(fd);need(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600&&stat.size<=65536,'FILE');return fs.readFileSync(fd);}
 finally{fs.closeSync(fd);}
}
function syncDirectory(file){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function createFile(file,bytes){
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
/** 同步：调用方必须来自已验证配置与真实run，不可将本API交给Agent或业务input。 */
export function bindAuthorizationIntent({intentAsset,stateRoot,machineId,taskId,runId,expectedScope}){
 keys(intentAsset,['path','sha256']);need(SHA.test(intentAsset.sha256),'DIGEST');
 need(/^[a-zA-Z0-9_.-]{1,100}$/.test(machineId??'')&&UUID.test(taskId??'')&&UUID.test(runId??''),'RUN_IDENTITY');
 scope(expectedScope);directory(stateRoot);
 const bytes=privateBytes(intentAsset.path);need(hash(bytes)===intentAsset.sha256,'DIGEST');
 const intent=JSON.parse(bytes);keys(intent,INTENT);scope(intent.scope);
 need(intent.schema==='leadgen-send-authorization-intent/v1'&&intent.machine_id===machineId,'MACHINE_OR_SCHEMA');
 text(intent.decision_id);need(UUID.test(intent.authorizing_root_task_id??''),'AUTHORIZING_ROOT');
 need(canonical(intent.scope)===canonical(expectedScope),'SCOPE_MISMATCH');
 need(typeof intent.message==='string'&&intent.message.length>0&&intent.message.length<=600&&!/[\r\n"&<>]/.test(intent.message),'MESSAGE');
 need(SHA.test(intent.message_sha256)&&hash(intent.message)===intent.message_sha256&&intent.message_sha256===expectedScope.message_sha256,'MESSAGE_DIGEST');
 need(intent.max_new_recipients===1&&intent.max_send_attempts===1&&intent.test_execution_daily_cap===100&&intent.company_policy_changed===false&&intent.requires_current_pause_and_daily_count_readback===true,'LIMITS');
 // stateRoot由可信全机配置固定，不能按Task/run/cwd派生；目录存在即代表该意图已消费。
 const reservation=path.join(stateRoot,intentAsset.sha256),authPath=path.join(reservation,'authorization.json'),receiptPath=path.join(reservation,'binding-receipt.json');
 const authorization={schema:'run-send-authorization/v1',decision_id:intent.decision_id,root_task_id:taskId,message:intent.message,message_sha256:intent.message_sha256,max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
 const authorizationBytes=canonical(authorization),authorizationAsset={path:authPath,sha256:hash(authorizationBytes)};
 // 每次均由固定intent+真实Task/run重算，不信任磁盘receipt自报的body或hash。
 const receipt={schema:'leadgen-authorization-binding/v1',intent_asset:{path:intentAsset.path,sha256:intentAsset.sha256},state_root:stateRoot,machine_id:machineId,task_id:taskId,run_id:runId,authorizing_root_task_id:intent.authorizing_root_task_id,decision_id:intent.decision_id,scope:expectedScope,authorization_asset:authorizationAsset};
 const receiptBytes=canonical(receipt),bindingReceipt={path:receiptPath,sha256:hash(receiptBytes)};
 let recovered=false;
 try{fs.mkdirSync(reservation,{mode:0o700});}
 catch(error){if(error.code!=='EEXIST')throw error;recovered=true;}
 directory(reservation);
 if(!recovered){
  // 占位先落盘；中断后不删除、不自动补缺，禁止新的Task/run再次领取。
  syncDirectory(stateRoot);
  createFile(authPath,authorizationBytes);
  const pending=path.join(reservation,'.binding-receipt.pending');createFile(pending,receiptBytes);
  // link是不可覆盖的原子发布；若中断留下pending或多硬链，恢复检查会拒绝。
  fs.linkSync(pending,receiptPath);fs.unlinkSync(pending);syncDirectory(reservation);
 }
 need(canonical(fs.readdirSync(reservation).sort())===canonical(['authorization.json','binding-receipt.json']),'INCOMPLETE');
 need(privateBytes(authPath).equals(Buffer.from(authorizationBytes))&&privateBytes(receiptPath).equals(Buffer.from(receiptBytes)),'BINDING_CHANGED');
 return {authorization_asset:authorizationAsset,binding_receipt:bindingReceipt,recovered};
}
