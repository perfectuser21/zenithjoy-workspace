import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityFixture,digest} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-authority.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('qualification-maintenance-authority.mjs'))return null;
  throw error;
});
const authorize=f=>{assert.equal(typeof api?.authorizeMaintenance,'function','缺少正式Task与原owner委托授权验证');return api.authorizeMaintenance(f);};

test('真实data/operations形状与default路由tenant有效，原e62可保持in_progress资源hold',()=>{
  const f=authorityFixture(),before=structuredClone(f);
  assert.deepEqual(authorize(f).scope,f.scope);
  assert.deepEqual(f,before,'授权验证不得改Task或补写原null native task_id');
});
for(const [name,change] of [
  ['开发Task',f=>f.maintenanceTask.payload.work_kind='coding_mutation'],
  ['只读Task',f=>f.maintenanceTask.payload.read_only=true],
  ['无操作授权',f=>f.maintenanceTask.payload.operational_mutation=false],
  ['维护Task无owner',f=>f.maintenanceTask.claimed_by=null],
  ['原owner漂移',f=>f.originalTask.claimed_by='someone-else'],
  ['维护Task排队',f=>f.maintenanceTask.status='queued'],
  ['原Task排队',f=>f.originalTask.status='queued'],
  ['跨项目',f=>f.maintenanceTask.project_id='99999999-9999-4999-8999-999999999999'],
  ['无原owner委托',f=>delete f.originalTask.result.qualification_maintenance_delegation],
  ['委托别Task',f=>f.originalTask.result.qualification_maintenance_delegation.maintenance_task_id=f.originalTask.id],
  ['合同摘要不符',f=>f.originalTask.result.qualification_maintenance_delegation.contract_sha256='0'.repeat(64)],
  ['设备不符',f=>f.maintenanceTask.payload.resources.devices=['another-serial']],
  ['范围不符',f=>f.maintenanceTask.payload.allowed_video_ids=['7700112581541257551']],
  ['多VID',f=>f.scope.video_ids.push('7700112581541257551')],
  ['别consumer程序',f=>f.scope.consumer_source='d'.repeat(40)],
  ['缺独立维护候选',f=>delete f.scope.maintenance_source],
  ['调用者停止布尔',f=>f.scope.execution_stopped=true],
  ['force字段',f=>f.scope.force=true],
  ['无原租约续期委托',f=>f.originalTask.result.qualification_maintenance_delegation.actions=f.scope.actions.filter(a=>a!=='renew-original-lease')],
])test(name+'在副作用前拒绝',()=>{
  const f=authorityFixture();change(f);
  assert.throws(()=>authorize(f),/MAINTENANCE_(?:AUTHORITY|SCOPE|SOURCE)/);
});

test('新scope来自规范Task但不能超出原OpsTask唯一VID，不能靠同步改hash自授',()=>{
  const f=authorityFixture();f.scope.video_ids=['7700112581541257551'];
  f.maintenanceTask.payload.allowed_video_ids=[...f.scope.video_ids];
  f.originalTask.result.qualification_maintenance_delegation.contract_sha256=digest(f.scope);
  assert.throws(()=>authorize(f),/MAINTENANCE_SCOPE/);
});
