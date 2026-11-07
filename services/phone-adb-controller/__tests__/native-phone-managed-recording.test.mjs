import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../native-phone-managed-recording.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('录制组合层必须提供私有品牌接口',()=>{
 for(const name of ['createNativePhoneManagedRecording','isNativePhoneManagedRecording','readNativeManagedCapture'])assert.equal(typeof api[name],'function');
});
test('普通JSON和布尔不能冒充录制cap或manager',()=>{
 for(const fake of [{},{execution_stopped:true},{path:'/tmp/fake',sha256:'a'.repeat(64)},true,null]){
  assert.equal(api.isNativePhoneManagedRecording(fake,{source:{},scope:{}}),false);
  assert.throws(()=>api.readNativeManagedCapture(fake,{scope:{}}),/CAPTURE_BRAND/);
 }
});
test('缺少genuine audio、scope或来源时禁止构造且不运行Worker callback',async()=>{
 let called=0;const fake={run:async()=>{called++;return 'native_audio_state=started';}};
 await assert.rejects(api.createNativePhoneManagedRecording({audio:fake,assertResources:async()=>true}),/NATIVE_MANAGED_RECORDING_/);
 assert.equal(called,0);
});
function options(overrides={}){
 const end=Date.now()+30000,scope={task_id:'11111111-1111-4111-8111-111111111111',run_id:'processing-fixture__a1',binding_id:'22222222-2222-4222-8222-222222222222',profile:'fixture',serial:'fixture-serial',source_commit:'a'.repeat(40),run:'fixture',worker_deadline_ms:end,receipt_deadline_ms:end+10000};
 const readScope={...scope,protocol:'native-phone-adb-read/v1',endpoint:'tcp:127.0.0.1:12345',epoch:1,claim:{claimed_by:'fixture'},cleanup_deadline_ms:scope.receipt_deadline_ms};
 return {source:{commit:scope.source_commit,files:[]},scope,readScope,context:{run:scope.run,profile:scope.profile,serial:scope.serial,package:'com.ss.android.ugc.aweme',deviceSdk:31,brokerHost:'fixture-host',endpoint:readScope.endpoint,adbReadScope:readScope,allowedVideoIds:['1234567890123456789']},...overrides};
}
test('完整外形的Worker audio、JSON或闭包不获得genuine音频品牌',async()=>{
 let calls=0;for(const audio of [{run:async()=>{calls++;return 'native_audio_state=started';}},Object.freeze({commands:['native-audio-evidence'],run:async()=>{calls++;return 'native_audio_state=started';}}),true])await assert.rejects(api.createNativePhoneManagedRecording(options({audio,assertResources:async()=>true})),/AUDIO_BRAND/);
 assert.equal(calls,0);
});
test('VID白名单/音频来源之前就拒绝扩预算、丢claim读域与跨scope上下文',async()=>{
 const mutations=[o=>{o.context.allowedVideoIds=['../escape'];},o=>{o.context.allowedVideoIds.push(o.context.allowedVideoIds[0]);},o=>{o.readScope={...o.readScope,cleanup_deadline_ms:o.readScope.cleanup_deadline_ms+1};},o=>{o.readScope={...o.readScope,serial:'other'};},o=>{o.context={...o.context,run:'foreign'};},o=>{o.context={...o.context,endpoint:'tcp:127.0.0.1:23456'};}];
 for(const mutate of mutations){const o=options({audio:{run:async()=>{throw Error('MUST_NOT_RUN');}},assertResources:async()=>true});mutate(o);await assert.rejects(api.createNativePhoneManagedRecording(o),/NATIVE_MANAGED_RECORDING_SCOPE/);}
});
