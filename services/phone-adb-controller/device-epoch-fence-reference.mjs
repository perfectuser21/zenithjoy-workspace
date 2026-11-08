// 轻量且唯一的冻结epoch引用：不加载维护执行器或完整业务运行内核。
import {lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';import {userInfo} from 'node:os';import {createHash} from 'node:crypto';
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:canonical(value)).digest('hex');
const sha=digest,same=(a,b)=>canonical(a)===canonical(b);
export function bytes(path){
 let fd;try{need(realpathSync(path)===resolve(path),'REVIEW_PATH');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid()&&!(s.mode&0o022)&&s.nlink===1&&s.size<=32*1024*1024,'REVIEW_FILE');const b=Buffer.alloc(s.size+1);let n=0,k;while(n<b.length&&(k=readSync(fd,b,n,b.length-n,null))>0)n+=k;const e=fstatSync(fd);need(n===s.size&&e.dev===s.dev&&e.ino===s.ino&&e.ctimeMs===s.ctimeMs&&e.mtimeMs===s.mtimeMs,'REVIEW_FILE_DRIFT');return b.subarray(0,n);}finally{if(fd!==undefined)closeSync(fd);}
}
export function recordBytes(path){const s=lstatSync(path),root=lstatSync(dirname(path));need(s.uid===process.getuid()&&(s.mode&0o777)===0o600&&root.isDirectory()&&!root.isSymbolicLink()&&(root.mode&0o777)===0o700,'EPOCH_RECORD_MODE');return bytes(path);}
export function validateEpochRecord(record,spec){
 need(record?.protocol==='device-epoch-fence-record/v1'&&uuid.test(record.epoch_id||'')&&record.status==='fenced'&&record.authority_basis==='old-route-fenced-observed-noninterference/v1'&&record.original_execution_stopped===false&&record.android_internal==='not_attested','EPOCH_RECORD');
 need(spec?.policy?.schema_version===2&&record.resource?.serial===spec.serial&&record.resource.profile===spec.profile&&record.resource.expected_account===spec.expected_account&&record.new_route?.instance_id===spec.policy.instance_id&&record.new_route.endpoint===spec.policy.endpoint&&record.runtime_source?.commit===spec.source_commit,'EPOCH_RECORD_SCOPE');return record;
}
export function freezeFenceReference({scope,epochId,home=userInfo().homedir}){
 need(uuid.test(epochId||'')&&typeof scope?.serial==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(scope.serial),'EPOCH_REFERENCE');const path=join(home,'.local/share/zenithjoy/device-epoch-fences',scope.serial,epochId+'.json'),raw=recordBytes(path),record=validateEpochRecord(JSON.parse(raw),scope);need(record.epoch_id===epochId,'EPOCH_REFERENCE_ID');
 const policyRaw=bytes(record.new_route.policy_path);need(sha(policyRaw)===record.new_route.policy_sha256&&same(JSON.parse(policyRaw),scope.policy),'EPOCH_REFERENCE_POLICY');return {protocol:'device-epoch-fence-reference/v1',epoch_id:epochId,path,sha256:sha(raw)};
}
