import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const scope={workflow:'douyin_video_processing',run:'metadata_fixture',line:'yuesheng',profile:'fixture',serial:'fixture-serial',source_run:'source101',limit:2};
const input={kind:'queue',request:{op:'company_config',step:'102',line:'yuesheng',run:'metadata_fixture',source_run:'source101',limit:2,device_binding:{profile:'fixture',device_serial:'fixture-serial'}}};
test('PG adapter never exposes connection URL, raw error or stack in failure or journal',async t=>{
 const {createPreflightMetadata}=await import('../preflight-metadata.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-metadata-secret-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const secret='postgresql://fixture:DO_NOT_LEAK@127.0.0.1:15532/zenithjoy';
 const metadata=createPreflightMetadata({directory,scope,source:{commit:'a'.repeat(40)},verify:()=>{},createPool:async()=>{throw Error('malformed DATABASE_URL '+secret);}});
 let error;try{await metadata(input,{scope:{deadline_ms:Date.now()+10000}});}catch(e){error=e;}
 assert.equal(error.code,'PREFLIGHT_METADATA_UNKNOWN');assert.equal(error.message,'PREFLIGHT_METADATA_UNKNOWN');assert.equal(error.cause,undefined);assert.equal(error.stack.includes('DO_NOT_LEAK'),false);
 const records=readdirSync(directory).map(p=>readFileSync(join(directory,p),'utf8')).join('');assert.equal(records.includes('DO_NOT_LEAK'),false);assert.equal(records.includes('postgresql:'),false);
 await assert.rejects(()=>metadata(input,{scope:{deadline_ms:Date.now()+10000}}),{code:'PREFLIGHT_METADATA_UNKNOWN'});
});
test('metadata admission rejects bare RPC and drift before allocating a PG transport',async t=>{
 const {createPreflightMetadata}=await import('../preflight-metadata.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-metadata-scope-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let allocated=0;const metadata=createPreflightMetadata({directory,scope,source:{commit:'a'.repeat(40)},verify:()=>{},createPool:async()=>{allocated++;throw Error('must not connect');}});
 for(const bad of [{kind:'outreach'}, {...input,request:{...input.request,op:'score'}}, {...input,request:{...input.request,run:'other'}}, {...input,request:{...input.request,device_binding:{profile:'other',device_serial:'fixture-serial'}}}])await assert.rejects(()=>metadata(bad,{scope:{deadline_ms:Date.now()+10000}}),{code:'PREFLIGHT_METADATA_SCOPE'});
 assert.equal(allocated,0);
});
