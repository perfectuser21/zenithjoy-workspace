import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {SCOPE,validateRequest,planBatch}=require('../qualification-quarantine-recovery-102n.js');
const videos=['7690206754872817819','7701984906457456467'];
const request={op:'recover_102n_qualification',line:'jinuo',run:'qualification_recovery_102n',
 decision_id:'e7c48034-723b-4dc4-9927-b2593a5a0a7d',maintenance_task_id:'630fead3-9b17-4132-9208-92df60b1db3e',video_id:videos[0]};

test('102n恢复范围只含原101n/102n、公司v14与两条隔离VID',()=>{
 assert.deepEqual(SCOPE.video_ids,videos);
 assert.equal(SCOPE.original_101_run,'accept7252_jinuo101n_20261031T0251');
 assert.equal(SCOPE.original_102_run,'accept7252_jinuo102n_20261031T0303');
 assert.equal(SCOPE.original_source_commit,'7252b6d2d6f279768753f086abc8c29ba968ea45');
 assert.equal(SCOPE.company_config_version,14);
 assert.equal(SCOPE.allow_direct_messages,false);
});

test('单VID入口不收第三条、批量、错运行及请求自带终止证明',()=>{
 assert.equal(validateRequest(request).video_id,videos[0]);
 assert.equal(validateRequest({...request,video_id:videos[1]}).video_id,videos[1]);
 for(const change of [{video_id:'7699316353698753663'},{video_ids:videos},{run:'foreign'},
  {source_run:'foreign'},{old_execution_stopped:true},{line:'yuesheng'}]){
  assert.throws(()=>validateRequest({...request,...change}),/RECOVERY_102N_/);
 }
});

test('批计划逐条独立，第一条成功第二条失败不冒称整批成功',()=>{
 const summary=planBatch(videos,[{video_id:videos[0],status:'applied'},
  {video_id:videos[1],status:'blocked',reason:'RESOURCE_UNKNOWN'}]);
 assert.equal(summary.status,'partial');
 assert.deepEqual(summary.applied,[videos[0]]);
 assert.deepEqual(summary.blocked,[{video_id:videos[1],reason:'RESOURCE_UNKNOWN'}]);
 assert.equal(planBatch(videos,[{video_id:videos[0],status:'commit_unknown'}]).status,'unknown');
 assert.throws(()=>planBatch(videos,[{video_id:videos[0],status:'applied'},
  {video_id:videos[0],status:'applied'}]),/RECOVERY_102N_/);
});
