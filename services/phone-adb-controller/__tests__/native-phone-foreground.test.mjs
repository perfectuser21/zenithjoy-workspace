import test from 'node:test';import assert from 'node:assert/strict';
import {firstNativePhoneFocus,authorizeNativePhoneCleanupTransition} from '../native-phone-runtime.mjs';
test('actual phone factory applies original first non-null current-focus rule before original PYFOCUS',()=>{
 const current='mCurrentFocus=Window{a com.ss.android.ugc.aweme/.MainActivity}',app='mFocusedApp=ActivityRecord{b com.ss.android.ugc.aweme/.MainActivity}';
 assert.equal(firstNativePhoneFocus('unrelated\n  mCurrentFocus=null\r\n  '+current+'\r\n  '+app),current);
 assert.equal(firstNativePhoneFocus('  '+app+'\n'+current),app);assert.equal(firstNativePhoneFocus('mCurrentFocus=null\n'),'unknown');
});
test('serialized phone runtime or Commander reply cannot authorize cleanup routing',()=>{for(const runtime of [{},{verified:true,execution_stopped:true},{modelStopped:true,always_run:['cleanup']}])assert.throws(()=>authorizeNativePhoneCleanupTransition(runtime,{request:{activity_key:'cleanup'}}),/NATIVE_PHONE_CLEANUP_ROUTE/);});
