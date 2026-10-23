import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {collectionFixture} from './helpers/collection-recovery-fixture.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
async function aliasFixture(t){
 const f=await collectionFixture(t),load=n=>import(pathToFileURL(join(f.runtime,n)));
 const canonical=join(f.d,'Application Support','phone-runtime'),alias=join(f.d,'phone');
 mkdirSync(join(canonical,'evidence',f.env.P),{recursive:true,mode:0o700});symlinkSync(canonical,alias);
 const relative='config/collection-phone-hosts.json',config=join(f.runtime,relative);
 const host={...f.frozen.collection_phone_scope,expected_account:'fixture-account',evidence_alias:{path:alias,target:canonical}};
 writeFileSync(config,JSON.stringify({version:1,hosts:[host]}));
 writeFileSync(join(f.runtime,'deployment-manifest.json'),JSON.stringify({target:'xian-m4',source_commit:'a'.repeat(40),files:[{deployed_path:relative,path:'services/phone-adb-controller/'+relative,content_sha256:sha(readFileSync(config))}]}));
 for(const path of [relative,'deployment-manifest.json'])f.frozen.files['runtime/'+path]=sha(readFileSync(join(f.runtime,path)));
 const {defaultCollectionPhoneScope,startCollectionPhoneScope}=await load('collection-phone-scope.mjs');
 const emptyRun=join(f.d,'not-yet-frozen');
 const scope=defaultCollectionPhoneScope({root:f.runtime,env:{...f.env,WF_BRAIN_WORKFLOW:'douyin_video_processing',WFR_RUN_DIR:emptyRun}});
 scope.task_id='scope-task';
 const freeze=async()=>{f.frozen.collection_phone_scope=scope;const {digest}=await load('runtime-definition.mjs');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));const p=join(f.d,'run-bindings/a1.request.json'),q=JSON.parse(readFileSync(p));q.runtime_snapshot_sha256=f.frozen.snapshot_sha256;writeFileSync(p,JSON.stringify(q));};
 await freeze();
 const start=()=>startCollectionPhoneScope({root:f.runtime,env:f.env,state:{currentActivity:'collection',account:'fixture-account',budgetDeadline:Date.now()+60000},sourceCommit:'a'.repeat(40),taskId:'scope-task',qualifiedVideoIds:[]});
 return {...f,canonical,alias,scope,start};
}

test('现役授权alias在freeze固定canonical身份，实际collection执行不再消费可变alias',{skip:process.platform!=='darwin'},async t=>{
 const f=await aliasFixture(t);
 assert.equal(f.scope.evidence_identity?.canonical_root,join(f.canonical,'evidence',f.env.P),'freeze必须记录实际目录身份');
 const scope=await f.start();t.after(()=>scope.close());
 assert.equal(scope.env.DOUYIN_PHONE_TMP_ROOT,f.canonical);
 assert.equal(realpathSync(join(scope.env.DOUYIN_PHONE_TMP_ROOT,'evidence',f.env.P)),f.scope.evidence_identity.canonical_root);
});

test('正式冻结scope存在时0qualified只交空工件，不创建collection leaf producer',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t),{createHandlers}=await import(pathToFileURL(join(f.runtime,'leadgen-handlers.mjs')));
 const handlers=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',rpc:async()=>{throw Error('零项不得访问业务队列');},execute:async()=>{throw Error('零项不得操作手机');}});
 handlers.state.currentActivity='collection';handlers.state.account='fixture-account';handlers.state.budgetDeadline=Date.now()+60000;
 const result=await handlers.collection();
 assert.equal(result.comments,0);assert.equal(result.videos_processed,0);assert.deepEqual(result.sampling_receipts,[]);
 assert.equal(readFileSync(join(f.d,'comments.tsv'),'utf8'),'');
 assert.equal(existsSync(join(f.d,'collection-phone-scopes')),false,'0项不能先建立设备执行服务');
});

test('授权alias冻结后改指另一目录仍拒绝',{skip:process.platform!=='darwin'},async t=>{
 const f=await aliasFixture(t),other=join(f.d,'other-runtime');mkdirSync(join(other,'evidence',f.env.P),{recursive:true});
 rmSync(f.alias);symlinkSync(other,f.alias);
 await assert.rejects(f.start(),/COLLECTION_.*(?:EVIDENCE|RECORDING)/);
});
