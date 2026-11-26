import {isIPv4} from 'node:net';
// 轻量且唯一的冻结epoch引用：不加载维护执行器或完整业务运行内核。
import {lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,constants,writeSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';import {userInfo} from 'node:os';import {createHash} from 'node:crypto';
const need=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});},uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:canonical(value)).digest('hex');
const sha=digest,same=(a,b)=>canonical(a)===canonical(b);
export const FENCE_ACTIONS=Object.freeze(['install_private_policy','start_private_server','disconnect_old_serial','connect_private_serial','archive_old_quarantine','release_maintenance_lease']);
export function approvalScopeFor({scope,instance,sourceCommit}){return {serial:scope.serial,old_endpoint:scope.endpoint,old_daemon_pid:scope.old_daemon.pid,old_daemon_start_identity:scope.old_daemon.start_identity,old_policy_sha256:scope.old_daemon.policy_sha256,new_instance_id:instance.instance_id,new_endpoint:instance.endpoint??instance.policy.endpoint,new_policy_path:instance.policy_path,new_policy_sha256:instance.policy_sha256,source_commit:sourceCommit};}
export function writeAll(fd,raw,writer=writeSync){let offset=0;while(offset<raw.length){const n=writer(fd,raw,offset,raw.length-offset);need(Number.isSafeInteger(n)&&n>0&&n<=raw.length-offset,'EPOCH_WRITE_INCOMPLETE');offset+=n;}}
export function bytes(path){
 let fd;try{need(realpathSync(path)===resolve(path),'REVIEW_PATH');fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid()&&!(s.mode&0o022)&&s.nlink===1&&s.size<=32*1024*1024,'REVIEW_FILE');const b=Buffer.alloc(s.size+1);let n=0,k;while(n<b.length&&(k=readSync(fd,b,n,b.length-n,null))>0)n+=k;const e=fstatSync(fd);need(n===s.size&&e.dev===s.dev&&e.ino===s.ino&&e.ctimeMs===s.ctimeMs&&e.mtimeMs===s.mtimeMs,'REVIEW_FILE_DRIFT');return b.subarray(0,n);}finally{if(fd!==undefined)closeSync(fd);}
}
export function readPrivatePolicy(path){const s=lstatSync(path);need(s.uid===process.getuid()&&(s.mode&0o777)===0o600,'EPOCH_POLICY_MODE');return bytes(path);}
export function recordBytes(path){const s=lstatSync(path),root=lstatSync(dirname(path));need(s.uid===process.getuid()&&(s.mode&0o777)===0o600&&root.isDirectory()&&!root.isSymbolicLink()&&(root.mode&0o777)===0o700,'EPOCH_RECORD_MODE');return bytes(path);}
// Business locks use the hardware serial; ADB uses a fixed network locator.
export function epochTransportSerial(resource){
 const locator=resource.adb_serial;
 if(locator===undefined)return resource.serial;
 const match=typeof locator==='string'&&locator.match(/^([^:]+):([1-9]\d{0,4})$/);
 need(match&&isIPv4(match[1])&&Number(match[2])<=65535
  &&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(resource.serial||''),'EPOCH_DEVICE_IDENTITY');
 return locator;
}
const cleanAuthority = 'approved-clean-route-migration/v1';
const reviewedAuthority = 'old-route-fenced-observed-noninterference/v1';
const cloudAuthority = 'approved-existing-cloud-route-fence/v1';
const cloudSerial = '47.100.213.173:10001';
const cloudAccount = '77980009922';
const cloudProfile = 'cloud-phone-test';
const cloudOperatorApprovalTask = '8c3b3479-3565-4f62-b211-9abbb898d740';
const cloudOriginal = {
 task_id:'0874e3fc-b7c2-46a6-b97e-cdc1264a693c',
 run_id:'867d15ae-69d7-455b-b8db-4f0299bce291'
};
const cloudOld = 'tcp:127.0.0.1:5041', cloudNew = 'tcp:127.0.0.1:5042', cloudInstance = 'mmv-cloud-epoch2';
const cleanTask = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const cleanSerial = 'B114E2190975', cleanLocator = '127.0.0.1:15555';
const cleanOld = 'tcp:127.0.0.1:5044', cleanNew = 'tcp:127.0.0.1:5045', cleanInstance = 'mmv-yuesheng-direct';
const hex = /^[a-f0-9]{64}$/;
const leaseFields = ['device_name', 'locked_by', 'locked_at', 'expires_at', 'lease_version'];
const leaseVersion = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 4_294_967_295;
export const isYueshengCleanEpoch = record => record?.authority_basis === cleanAuthority;
export const isCloudExistingEpoch = record => record?.authority_basis === cloudAuthority;

function validateCloudEpoch(record, home) {
 const { resource, old_route: old, new_route: next, cloud_migration: m, original } = record;
 const release = m?.central_release, scope = release?.scope, expected = release?.expected, current = release?.current;
 need(resource.serial === cloudSerial && !Object.hasOwn(resource, 'adb_serial') && resource.profile === cloudProfile
  && resource.expected_account === cloudAccount && resource.line === 'yuesheng'
  && uuid.test(resource.company?.company_id ?? '') && uuid.test(resource.company?.tenant_id ?? '')
  && Number.isSafeInteger(resource.company.version) && resource.company.version > 0
  && typeof resource.company.policy_id === 'string' && resource.company.policy_id.trim().length > 0
  && same(original,cloudOriginal) && original.task_id !== record.epoch_id
  && !Object.hasOwn(record, 'original_quarantine') && !Object.hasOwn(record, 'migration'), 'EPOCH_CLOUD_SCOPE');
 need(old?.endpoint === cloudOld && next?.endpoint === cloudNew && next.instance_id === cloudInstance
  && old.policy_path === join(home, '.config/zenithjoy/adb-service.json')
  && next.policy_path === join(home, '.config/zenithjoy/adb-instances', cloudInstance + '.json')
  && old.pid !== next.pid && [old, next].every(route => Number.isSafeInteger(route.pid) && route.pid > 0
   && route.uid === process.getuid() && typeof route.start_identity === 'string' && route.start_identity.length > 0
   && typeof route.command === 'string' && route.command.length > 0
   && typeof route.executable === 'string' && route.executable.startsWith('/')
   && hex.test(route.executable_sha256 ?? '') && hex.test(route.policy_sha256 ?? '')), 'EPOCH_CLOUD_ROUTES');
 need(same(Object.keys(m ?? {}).sort(), ['approval_sha256','boot_id_sha256','central_release','completion_sha256',
  'hardware_serial_sha256','journal_path','observation_id','plan_sha256','release_id','wire_sha256'])
  && m.journal_path === join(home,'.local/share/zenithjoy/device-epoch-migrations',cloudSerial,'cloud-test-5041-to-5042',record.epoch_id)
  && [m.plan_sha256,m.approval_sha256,m.completion_sha256,m.wire_sha256,m.hardware_serial_sha256,m.boot_id_sha256].every(hash => hex.test(hash ?? ''))
  && uuid.test(m.release_id ?? '') && uuid.test(m.observation_id ?? '')
  && /^[a-f0-9]{40}$/.test(record.runtime_source?.commit ?? ''), 'EPOCH_CLOUD_JOURNAL');
 need(scope?.maintenance_task_id === record.epoch_id && scope.serial === cloudSerial
  && typeof scope.claim?.claimed_by === 'string' && scope.claim.claimed_by.trim().length > 0
  && Date.parse(scope.claim.claimed_at) <= Date.parse(expected?.locked_at) && Date.parse(expected?.locked_at) < Date.parse(expected?.expires_at)
  && expected.device_name === cloudSerial && expected.locked_by === record.epoch_id && leaseVersion(expected.lease_version)
  && current?.device_name === cloudSerial && current.locked_by === null && current.locked_at === null && current.expires_at === null
  && leaseVersion(current.lease_version) && current.lease_version !== expected.lease_version, 'EPOCH_CLOUD_RELEASE');
}

export function readCloudExistingEpochCompletion(record, { home = userInfo().homedir } = {}) {
 validateCloudEpoch(record, home);
 const m = record.cloud_migration, release = m.central_release, journal = m.journal_path;
 try { lstatSync(join(journal,'unknown.json')); need(false,'EPOCH_CLOUD_JOURNAL'); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
 const read = name => recordBytes(join(journal, name));
 const stored = JSON.parse(read('plan.json')), plan = stored?.plan;
 const route = {serial:cloudSerial,profile:cloudProfile,old_endpoint:cloudOld,new_endpoint:cloudNew,instance_id:cloudInstance};
 need(plan?.protocol === 'cloud-phone-101-route-fence-plan/v1' && plan.task_id === record.epoch_id
  && plan.operator_approval_task_id === cloudOperatorApprovalTask && same(plan.route,route) && same(plan.original,record.original)
  && same(plan.resource,record.resource)
  && plan.source_commit === record.runtime_source.commit && plan.release_id === m.release_id
  && plan.observation_id === m.observation_id && hex.test(plan.manifest_sha256 ?? '')
  && same(plan.claim,release.scope.claim) && plan.lease?.expired === false
  && leaseFields.every(key=>plan.lease[key]===release.expected[key])
  && stored.plan_sha256 === m.plan_sha256 && sha(plan) === m.plan_sha256
  && stored.approval_sha256 === m.approval_sha256, 'EPOCH_CLOUD_JOURNAL');
 need(same(JSON.parse(read('central-release-result.json')),release),'EPOCH_CLOUD_RELEASE');

 const approval = JSON.parse(read('approval.json'));
 need(same(Object.keys(approval).sort(), ['actions','approval_ref','approved_at','approved_by','plan_sha256','protocol'])
  && approval.protocol === 'cloud-phone-101-route-fence-approval/v1'
  && approval.approved_by === 'authenticated-operator' && approval.approval_ref === 'task:' + plan.operator_approval_task_id + ':phone_101_single_device_switch'
  && same(approval.actions,['disconnect_old_serial']) && approval.plan_sha256 === m.plan_sha256
  && sha(approval) === m.approval_sha256,'EPOCH_CLOUD_APPROVAL');
 const completeRaw = read('complete.json'), done = JSON.parse(completeRaw);
 const beforeRaw = read('before.json'), before = JSON.parse(beforeRaw);
 const afterRaw = read('after.json'), after = JSON.parse(afterRaw);
 const completionSha256 = sha(completeRaw);
 const identityFields = ['provider_binding_sha256','hardware_serial_sha256','boot_id_sha256','old_daemon_sha256','new_daemon_sha256'];
 const locked = Date.parse(release.expected.locked_at), expires = Date.parse(release.expected.expires_at);
 const planAt = Date.parse(plan.before?.observed_at), beforeAt = Date.parse(before.observed_at), afterAt = Date.parse(after.observed_at);
 need(completionSha256 === m.completion_sha256 && done.protocol === 'cloud-test-adb-fence-transaction/v1'
  && done.status === 'observed' && done.original_execution_stopped === false && done.plan_sha256 === m.plan_sha256
  && done.before_sha256 === sha(beforeRaw) && done.after_sha256 === sha(afterRaw) && done.wire_sha256 === m.wire_sha256
  && done.hardware_serial_sha256 === m.hardware_serial_sha256 && done.boot_id_sha256 === m.boot_id_sha256
  && locked <= planAt && planAt <= Date.parse(approval.approved_at) && Date.parse(approval.approved_at) <= beforeAt
  && beforeAt < afterAt && afterAt < expires
  && identityFields.every(key=>hex.test(before[key] ?? '') && plan.before[key] === before[key] && before[key] === after[key])
  && hex.test(before.consumer_readback_sha256 ?? '') && plan.before.consumer_readback_sha256 === before.consumer_readback_sha256
  && before.consumer_readback_sha256 === after.consumer_readback_sha256
  && [plan.before,before,after].every(value=>hex.test(value.noninterference_sha256 ?? ''))
  && before.hardware_serial_sha256 === m.hardware_serial_sha256 && before.boot_id_sha256 === m.boot_id_sha256
  && before.old_daemon_sha256 === sha(record.old_route) && before.new_daemon_sha256 === sha(record.new_route)
  && before.old_device?.serial === cloudSerial && before.old_device.state === 'unauthorized' && typeof before.old_device.properties === 'string'
  && same(plan.before.old_device,before.old_device) && after.old_device === null
  && before.new_device?.serial === cloudSerial && before.new_device.state === 'device' && typeof before.new_device.properties === 'string'
  && same(plan.before.new_device,before.new_device) && same(before.new_device,after.new_device), 'EPOCH_CLOUD_JOURNAL');

 const scope = {endpoint:cloudOld,serial:cloudSerial};
 const intent = JSON.parse(read('disconnect-intent.json')), wireResult = JSON.parse(read('disconnect-wire/result.json'));
 const globalIntent = JSON.parse(recordBytes(join(dirname(journal),'disconnect-intent.json')));
 const raw = read('disconnect-wire/host-response.raw'), response = raw.subarray(8).toString('utf8');
 const wireAt = Date.parse(intent.at);
 need(intent.plan_sha256 === m.plan_sha256 && same(intent.scope,scope) && beforeAt <= wireAt && wireAt < afterAt
  && same(globalIntent,{...intent,task_id:record.epoch_id})
  && same(wireResult,JSON.parse(read('disconnect-result.json'))) && same(wireResult.scope,scope)
  && wireResult.protocol === 'device-epoch-fence-host-operation/v1' && wireResult.operation === 'disconnect'
  && wireResult.wire_complete === true && wireResult.action_confirmed === true && wireResult.write_attempted === true
  && wireResult.write_acknowledged === true && wireResult.peer_eof === true && wireResult.socket_closed === true
  && wireResult.error_code === null && wireResult.action_error_code === null && wireResult.pending === 0 && wireResult.retry_allowed === false && wireResult.original_execution_stopped === false
  && wireResult.raw_sha256 === m.wire_sha256 && sha(raw) === m.wire_sha256
  && /^OKAY[0-9a-fA-F]{4}$/.test(raw.subarray(0,8).toString('ascii'))
  && Number.parseInt(raw.subarray(4,8).toString('ascii'),16) === raw.length - 8
  && Buffer.from(response,'utf8').equals(raw.subarray(8)) && response === wireResult.response
  && response.replace(/\r?\n$/,'') === 'disconnected ' + cloudSerial, 'EPOCH_CLOUD_WIRE');
 return {completion_sha256:completionSha256,manifest_sha256:plan.manifest_sha256};
}

function validateCleanEpoch(record, home) {
 const { resource, old_route: old, new_route: next, migration: m } = record;
 const release = m?.central_release, scope = release?.scope, expected = release?.expected, current = release?.current;
 need(record.epoch_id === cleanTask && resource.serial === cleanSerial && resource.adb_serial === cleanLocator
  && resource.profile === 'wuying_android14' && resource.line === 'yuesheng'
  && uuid.test(resource.company?.company_id ?? '') && uuid.test(resource.company?.tenant_id ?? '')
  && Number.isSafeInteger(resource.company.version) && resource.company.version > 0 && typeof resource.company.policy_id === 'string'
  && resource.company.policy_id.trim().length > 0 && !Object.hasOwn(record, 'original_quarantine') && !Object.hasOwn(record, 'original'), 'EPOCH_CLEAN_SCOPE');
 need(old?.endpoint === cleanOld && old.daemon_binding?.endpoint === cleanOld && old.daemon_binding.kind === 'external_existing'
  && next?.endpoint === cleanNew && next.instance_id === cleanInstance && next.daemon_binding?.endpoint === cleanNew
  && next.daemon_binding.kind === 'managed' && next.daemon_binding.startup?.source_commit === record.runtime_source?.commit
  && next.policy_path === join(home, '.config/zenithjoy/adb-instances', cleanInstance + '.json') && hex.test(next.policy_sha256 ?? '')
  && [old, next].every(route => Number.isSafeInteger(route.daemon_binding.child?.pid) && route.daemon_binding.child.pid > 0), 'EPOCH_CLEAN_ROUTES');
 need(m?.journal_path === join(home, '.local/share/zenithjoy/device-epoch-migrations', cleanSerial, 'yuesheng-5044-to-5045')
  && hex.test(m.plan_sha256 ?? '') && hex.test(m.approval_sha256 ?? '') && hex.test(m.completion_sha256 ?? '')
  && uuid.test(m.release_id ?? '') && uuid.test(m.observation_id ?? '')
  && /^[a-f0-9]{40}$/.test(record.runtime_source?.commit ?? '')
  && Object.keys(m.binding_sha256 ?? {}).sort().join(',') === 'device-epoch-fence-yuesheng-host-reads.mjs,yuesheng-adb-daemon-binding.py'
  && Object.values(m.binding_sha256).every(hash => hex.test(hash)), 'EPOCH_CLEAN_JOURNAL');
 need(scope?.maintenance_task_id === record.epoch_id && scope.serial === cleanSerial
  && typeof scope.claim?.claimed_by === 'string' && scope.claim.claimed_by.trim().length > 0
  && Date.parse(scope.claim.claimed_at) <= Date.parse(expected?.locked_at) && Date.parse(expected?.locked_at) < Date.parse(expected?.expires_at)
  && expected.device_name === cleanSerial && expected.locked_by === record.epoch_id && leaseVersion(expected.lease_version)
  && current?.device_name === cleanSerial && current.locked_by === null && current.locked_at === null && current.expires_at === null
  && leaseVersion(current.lease_version) && current.lease_version !== expected.lease_version, 'EPOCH_CLEAN_RELEASE');
}

export function readYueshengEpochCompletion(record, { home = userInfo().homedir } = {}) {
 validateCleanEpoch(record, home);
 const m = record.migration, release = m.central_release;
 const journal = m.journal_path;
 try { lstatSync(join(journal, 'unknown.json')); need(false, 'EPOCH_CLEAN_JOURNAL'); }
 catch (error) { if (error.code !== 'ENOENT') throw error; }
 const completeRaw = recordBytes(join(journal, 'complete.json'));
 const completionSha = sha(completeRaw);
 need(completionSha === m.completion_sha256, 'EPOCH_CLEAN_JOURNAL');
 const storedRelease = JSON.parse(recordBytes(join(journal, 'central-release-result.json')));
 need(same(storedRelease, release), 'EPOCH_CLEAN_RELEASE');
 const stored = JSON.parse(recordBytes(join(journal, 'plan.json'))), plan = stored?.plan;
 const done = JSON.parse(completeRaw), observation = done?.observation;
 need(plan?.protocol === 'yuesheng-adb-migration-plan/v1' && plan.task_id === record.epoch_id && uuid.test(plan.pending_action_id ?? '')
  && plan.source_commit === record.runtime_source.commit && plan.release_id === m.release_id && plan.observation_id === m.observation_id
  && plan.physical_serial === cleanSerial && plan.transport_serial === cleanLocator && plan.old_endpoint === cleanOld && plan.new_endpoint === cleanNew
  && plan.new_instance_id === cleanInstance && same(plan.claim, release.scope.claim) && plan.lease?.expired === false
  && leaseFields.every(key => plan.lease[key] === release.expected[key]) && stored.plan_sha256 === m.plan_sha256
  && sha(plan) === m.plan_sha256 && stored.approval_sha256 === m.approval_sha256, 'EPOCH_CLEAN_JOURNAL');
 need(done?.protocol === 'yuesheng-adb-migration-transaction/v1' && done.status === 'observed' && done.plan_sha256 === m.plan_sha256
  && observation?.protocol === 'yuesheng-adb-migration-observation/v1' && observation.authorization === 'none'
  && observation.task_id === plan.task_id && observation.lease_version === plan.lease.lease_version && observation.source_commit === plan.source_commit
  && observation.release_id === plan.release_id && observation.observation_id === plan.observation_id
  && observation.physical_serial === cleanSerial && observation.transport_serial === cleanLocator
  && observation.old_endpoint === cleanOld && observation.new_endpoint === cleanNew && hex.test(observation.readback_sha256 ?? '')
  && Date.parse(release.expected.locked_at) <= Date.parse(observation.before_at) && Date.parse(observation.before_at) < Date.parse(observation.after_at)
  && Date.parse(observation.after_at) < Date.parse(release.expected.expires_at), 'EPOCH_CLEAN_JOURNAL');
 return completionSha;
}

export function validateEpochRecord(record,spec,{home=userInfo().homedir}={}){
 need(record?.protocol==='device-epoch-fence-record/v1'&&uuid.test(record.epoch_id||'')&&record.status==='fenced'&&[reviewedAuthority,cleanAuthority,cloudAuthority].includes(record.authority_basis)&&record.original_execution_stopped===false&&record.android_internal==='not_attested','EPOCH_RECORD');
 need(spec?.policy?.schema_version===2&&record.resource?.serial===spec.serial&&record.resource.profile===spec.profile&&record.resource.expected_account===spec.expected_account&&record.new_route?.instance_id===spec.policy.instance_id&&record.new_route.endpoint===spec.policy.endpoint&&record.runtime_source?.commit===spec.source_commit,'EPOCH_RECORD_SCOPE');
 epochTransportSerial(record.resource);
 if(isYueshengCleanEpoch(record))validateCleanEpoch(record,home);
 if(isCloudExistingEpoch(record)){
  need(spec.target === 'mmv' && spec.policy.host_id === 'mmv' && spec.policy.transport === 'tcp','EPOCH_CLOUD_SCOPE');
  validateCloudEpoch(record,home);
 }
 return record;
}
export function freezeFenceReference({scope,epochId,home=userInfo().homedir}){
 need(uuid.test(epochId||'')&&typeof scope?.serial==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(scope.serial),'EPOCH_REFERENCE');const path=join(home,'.local/share/zenithjoy/device-epoch-fences',scope.serial,epochId+'.json'),raw=recordBytes(path),record=validateEpochRecord(JSON.parse(raw),scope,{home});need(record.epoch_id===epochId,'EPOCH_REFERENCE_ID');
 const policyRaw=readPrivatePolicy(record.new_route.policy_path);need(sha(policyRaw)===record.new_route.policy_sha256&&same(JSON.parse(policyRaw),scope.policy),'EPOCH_REFERENCE_POLICY');if(isYueshengCleanEpoch(record))readYueshengEpochCompletion(record,{home});
 if(isCloudExistingEpoch(record))readCloudExistingEpochCompletion(record,{home});
 return {protocol:'device-epoch-fence-reference/v1',epoch_id:epochId,path,sha256:sha(raw)};
}
