import test from 'node:test';import assert from 'node:assert/strict';
import {createPhoneOperationAdmission} from '../phone-operation-admission.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('USB leaf scope只复用同root/frozen/Task/scope的真实admission，不把JSON或另一scope当授权',async()=>{
 const module=await import('../phone-scope-admission.mjs');const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),taskId=randomUUID(),runId=randomUUID(),binding={id:randomUUID(),run_id:runId},env={WFR_RUN_DIR:'/tmp/not-created-phone-scope-fixture',P:'xiaolongxia',SERIAL:'ANGYVB4311010223',WFR_TAG:'scope-fixture'},scope={run_id:runId,task_id:taskId,binding_id:binding.id,source_commit:'a'.repeat(40),snapshot_sha256:'b'.repeat(64),profile:env.P,serial:env.SERIAL,run:env.WFR_TAG,activity:'collect_videos',workflow:'douyin_video_discovery',worker_deadline_ms:Date.now()+10000,receipt_deadline_ms:Date.now()+11000,deadline_ms:Date.now()+12000};
 const files={};for(const path of ['config/collection-phone-hosts.json','config/native-phone-command-sources.json','config/native-phone-reviews/xiaolongxia-sdk35-xian-m4.md'])files['runtime/'+path]=createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
 const policy=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.find(h=>h.profile===env.P&&h.serial===env.SERIAL).policy;
 const frozen={files,primary_host:'official-child-v1',snapshot_sha256:scope.snapshot_sha256,deployment:{source_commit:scope.source_commit},agent_input:{task_id:taskId,profile:env.P,serial:env.SERIAL,run_tag:env.WFR_TAG,workflow_key:'douyin_video_discovery'},discovery_phone_scope:{run_id:runId,target:'xian-m4',profile:env.P,serial:env.SERIAL,expected_account:'90915521618',policy,policy_binding:{usb_local:{protocol:'usb-local-lease/v1',device_sdk:35,transport:{serial:env.SERIAL,transport_id:'1',usb_path:'1-1'},daemon:{endpoint:'tcp:127.0.0.1:5037'}}}}},context={root,env,frozen,state:{},scope,binding,taskId,assertAuthority:async()=>({authorized:true})};
 const admission=createPhoneOperationAdmission(context);assert.equal(typeof module.phoneScopeAdmission({...context,operationAdmission:{admission,context}}),'function');
 for(const candidate of [{admission:{...admission},context},{admission,context:{...context,scope:{...scope,activity:'collection'}}},undefined])assert.throws(()=>module.phoneScopeAdmission({...context,operationAdmission:candidate}),/PHONE_SCOPE_ADMISSION/);
});
