// Public Agent/Skill entry contract: local component proofs alone never enable a phone slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandlers} from '../leadgen-handlers.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../runtime-definition.mjs';
const api=await import('../native-phone-runtime.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../native-phone-runtime.mjs',import.meta.url).href)return {};throw error;});
const source='a'.repeat(40),task='11111111-1111-4111-8111-111111111111';
function rig(t){
 const directory=mkdtempSync(join(tmpdir(),'native-phone-public-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const body={execution_mode:'agent',deployment:{source_commit:source,target:'mmv'},files:{}};
 writeFileSync(join(directory,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
 const env={HOME:directory,WFR_RUN_DIR:directory,WFR_TAG:'native_fixture',WFR_RUN_ID:'douyin_video_discovery-native_fixture',WFR_ATTEMPT:'a1',P:'fixture',SERIAL:'SERIAL',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',WF_BRAIN_WORKFLOW:'douyin_video_discovery'};
 let outer=0;const handlers=createHandlers({root:directory,env,taskId:task,sourceCommit:source,execute:async()=>{outer++;throw Error('PUBLIC_NATIVE_PHONE_MUST_NOT_FALL_BACK_TO_OUTER_CLI');},rpc:async()=>{throw Error('PUBLIC_NATIVE_PHONE_MUST_NOT_FALL_BACK_TO_RPC_OUTER');}});
 return {directory,body,env,handlers,outer:()=>outer};
}
test('public native phone factory is Code-owned and missing remote command proof remains unsupported before any old CLI',async t=>{
 const f=rig(t);assert.equal(typeof api.createNativePhoneRuntime,'function','normal Skill handlers need the actual native phone runtime factory, not an isolated component or true support flag');
 // Missing Source/lock/account/command provenance cannot be completed by an Agent JSON object.
 assert.throws(()=>api.createNativePhoneRuntime({root:f.directory,env:f.env,frozen:f.body,binding:{id:'22222222-2222-4222-8222-222222222222',task_id:task},taskId:task,command_source:{verified:true,execution_stopped:true}}),/NATIVE_PHONE_(SOURCE|SCOPE|UNSUPPORTED)/);
 assert.equal(await f.handlers.agentSupportsNativeScope({key:'collect_videos'}),false);assert.equal(f.outer(),0);
});
