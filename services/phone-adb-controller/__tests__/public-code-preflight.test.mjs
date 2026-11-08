import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreflightPhoneDriver} from '../preflight-phone-driver.mjs';

test('account reader cannot publish or tap after its public Activity cancellation during a slow dump',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'public-code-cancel-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const signal=new AbortController(),calls=[];
 const driver=createPreflightPhoneDriver({evidenceRoot:directory,owner:'test_run',profile:'test',serial:'SERIAL',model:'MODEL',expectedAccount:'expected',deadlineMs:Date.now()+300000,signal:signal.signal,assertResources:async()=>{},
  local:{run:async()=>JSON.stringify({kind:'none',me:{x:10,y:10}})},
  adb:async(...args)=>{calls.push(args);if(args.includes('displays'))return 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}';if(args.includes('dump')){signal.abort();return '';}if(args[0]==='pull')writeFileSync(args[2],'<hierarchy/>');return '';}});
 await assert.rejects(()=>driver.run('account-current','test_run-account'),/PREFLIGHT_PHONE_CLOSED/);
 assert.equal(calls.some(args=>args.includes('tap')||args[0]==='pull'),false,'no new native leaf may follow cancelled dump');
 assert.equal(existsSync(join(directory,'test_run-account-profile.xml')),false);
});

test('public Code preflight has a separate canonical native factory and refuses unbranded admission before IO',async()=>{
 const {createPublicCodePreflight}=await import('../public-code-preflight.mjs');
 assert.throws(()=>createPublicCodePreflight({}),/PUBLIC_CODE_PREFLIGHT_/);
});
