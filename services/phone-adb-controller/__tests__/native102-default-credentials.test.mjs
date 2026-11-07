// Only synthetic OS HOME and private fixture files. No real cache, provider,
// phone, Brain, deployment metadata or account is accessed.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';
import {defaultCollectionPhoneScope,readCollectionPhoneScopeInput} from '../collection-phone-scope.mjs';
import {createNativePhoneCredentialReader} from '../native-phone-credentials.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const directory=fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(),'native102-default-creds-'))),home=join(directory,'os-home'),root=join(directory,'deployment');fs.mkdirSync(home,{mode:0o700});fs.mkdirSync(join(home,'.credentials'),{mode:0o700});fs.mkdirSync(join(root,'config'),{recursive:true});
 const original=os.userInfo;t.mock.method(os,'userInfo',()=>({...original(),homedir:home}));syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();fs.rmSync(directory,{recursive:true,force:true});});
 const credentials={};for(const [provider,key]of [['openrouter','OPENROUTER_API_KEY'],['dashscope','DASHSCOPE_API_KEY']]){const path=join(home,'.credentials',provider+'.env');fs.writeFileSync(path,key+'=synthetic-test-only-token\n',{mode:0o600});credentials[provider]={path,sha256:sha(fs.readFileSync(path))};}
 const host={target:'mmv',profile:'fixture',serial:'47.100.213.173:10001',evidence_root:join(directory,'evidence'),expected_account:'fixture-account',policy:{host_id:'mmv',endpoint:'tcp:127.0.0.1:5041'},executables:{}};const raw=JSON.stringify({version:1,hosts:[host]});fs.writeFileSync(join(root,'config/collection-phone-hosts.json'),raw);fs.writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify({source_repo:'test/repo',target:'mmv',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/config/collection-phone-hosts.json',deployed_path:'config/collection-phone-hosts.json',content_sha256:sha(raw)}]}));
 const env={WF_BRAIN_WORKFLOW:'douyin_video_processing',LEADGEN_EXECUTION_MODE:'agent',LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'8',P:host.profile,SERIAL:host.serial,WFR_RUN_DIR:join(directory,'run'),WFR_RUN_ID:'douyin_video_processing-fixture',WFR_TAG:'fixture',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source101',LEADGEN_COMMENT_LIMIT:'1',LEADGEN_LIMIT:'1',WF_RUN_MAX_SECONDS:'1800',WF_RUN_START_TS:String(Date.now()/1000)};
 return {directory,home,root,env,credentials,scope:()=>defaultCollectionPhoneScope({root,env})};
}
test('default raw Agent102 scope snapshots both actual fixed private provider files',t=>{
 const f=fixture(t),scope=f.scope();assert.deepEqual(scope.credentials,f.credentials);assert.equal(JSON.stringify(scope).includes('synthetic-test-only-token'),false);for(const provider of ['openrouter','dashscope'])assert.equal(createNativePhoneCredentialReader({provider,frozen:{collection_phone_scope:scope}})(),'synthetic-test-only-token');
});
test('explicit scope credentials schema accepts only both canonical current private descriptors',t=>{
 const f=fixture(t),scope={...f.scope(),credentials:f.credentials},path=join(f.directory,'explicit.json');fs.writeFileSync(path,JSON.stringify(scope),{mode:0o600});assert.deepEqual(readCollectionPhoneScopeInput(path).credentials,f.credentials);
 for(const credentials of [{openrouter:f.credentials.openrouter},{...f.credentials,extra:f.credentials.openrouter},{...f.credentials,dashscope:{...f.credentials.dashscope,path:join(f.directory,'foreign.env')}},{...f.credentials,dashscope:{...f.credentials.dashscope,sha256:'0'.repeat(64)}}]){fs.writeFileSync(path,JSON.stringify({...scope,credentials}));assert.throws(()=>readCollectionPhoneScopeInput(path),/CREDENTIAL/);}
 fs.chmodSync(f.credentials.dashscope.path,0o644);assert.throws(()=>readCollectionPhoneScopeInput(path),/CREDENTIAL/);
});
test('missing native cache rejects before any execution while old Code defaults remain unchanged',t=>{
 const f=fixture(t);fs.unlinkSync(f.credentials.dashscope.path);assert.throws(f.scope,/CREDENTIAL/);const code=defaultCollectionPhoneScope({root:f.root,env:{...f.env,LEADGEN_EXECUTION_MODE:'code',LEADGEN_EXECUTION_TRANSPORT:undefined}});assert.equal(Object.hasOwn(code,'credentials'),false);assert.equal(code.profile,'fixture');
});
