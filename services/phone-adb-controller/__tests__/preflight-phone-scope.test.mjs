import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {fileURLToPath,pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(new URL('../preflight-phone-scope.mjs',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const {SourceTextModule,SyntheticModule}=vm;
 const directory=realpathSync(mkdtempSync(join(os.tmpdir(),'preflight-scope-real-'))),runtime=join(directory,'runtime'),home=join(directory,'home'),evidence=join(directory,'evidence');mkdirSync(runtime);mkdirSync(home);mkdirSync(evidence);
 const originalUser=os.userInfo;os.userInfo=()=>({...originalUser(),homedir:home});syncBuiltinESMExports();
 try{
  const lockRoot=join(home,'.local/share/zenithjoy/phone-locks');mkdirSync(lockRoot,{recursive:true,mode:0o700});writeFileSync(join(lockRoot,'.migration-complete.json'),JSON.stringify({schema_version:1,state:'complete',source_sha256:'a'.repeat(64),legacy_root:join(home,'empty-legacy')}));
  const files={};for(const name of ['preflight-local-step.py','phone-lock-root.py','phone-lock-helper.py','adb-existing-route.py','discovery-cleanup-readback.mjs']){
   let bytes=readFileSync(join(root,name));
   // Only the production HOME selector is replaced. The migrated root validator,
   // actual guard/receipt logic, sandbox, and all phone/parser leaves stay real.
   if(name==='preflight-local-step.py')bytes=Buffer.from(bytes.toString().replace("roots.verify_root(request['root'])","roots.verify(request['root'])"));
   writeFileSync(join(runtime,name),bytes,{mode:0o600});files['runtime/'+name]=sha(bytes);
  }
  const c=join(directory,'adb.c'),binary=join(directory,'adb');writeFileSync(c,"#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\nint main(int n,char**v){\n const char*last=v[n-1];\n if(!strcmp(last,\"version\")){puts(\"Android Debug Bridge version 1.0.41\");return 0;}\n if(!strcmp(last,\"get-state\")){puts(\"device\");return 0;}\n if(!strcmp(last,\"ro.product.model\")){puts(\"Fixture\");return 0;}\n if(!strcmp(last,\"telephony.registry\")){puts(\"mCallState=0\");return 0;}\n if(!strcmp(last,\"displays\")){puts(\"mCurrentFocus=Window{a u0 com.android.launcher/.Home}\");return 0;}\n if(n>2&&!strcmp(v[n-3],\"pull\")){\n  FILE*f=fopen(last,\"wb\");if(!f)return 3;\n  if(strstr(v[n-2],\".xml\"))fputs(\"<hierarchy><node package=\\\"com.android.launcher\\\"/></hierarchy>\",f);\n  else{const char*h=\"89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082\";for(int i=0;h[i];i+=2){unsigned x;sscanf(h+i,\"%2x\",&x);fputc(x,f);}}\n  fclose(f);return 0;\n }\n if(!strcmp(last,\"android.intent.category.HOME\")){puts(\"com.android.launcher/.Home\");return 0;}\n if(!strcmp(last,\"com.ss.android.ugc.aweme\")||!strcmp(last,\"3\")||strstr(last,\"/sdcard/preflight-\"))return 0;\n return 2;\n}\n");assert.equal(spawnSync('cc',[c,'-o',binary]).status,0);
  const {createServer}=await import('node:net'),sockets=new Set(),server=createServer(s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));s.once('data',b=>{const q=b.subarray(4).toString(),body=q==='host:version'?'0029':q==='host:devices'?'SERIAL\tdevice\n':null;s.end(body===null?'FAIL0003bad':'OKAY'+Buffer.byteLength(body).toString(16).padStart(4,'0')+body);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const policy={schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:'+server.address().port,forbidden_ports:[],adb_bin:binary,adb_sha256:sha(readFileSync(binary))};
   // Existing route's schema separates the pinned client fields from host config.
   const config=join(directory,'adb.json');writeFileSync(config,JSON.stringify(policy),{mode:0o600});
   const profile=join(directory,'profiles');writeFileSync(profile,'profile\tserial\tmodel\twidth\theight\tenabled\nfixture\tSERIAL\tFixture\t720\t1280\ttrue\n',{mode:0o600});
   const task='11111111-1111-4111-8111-111111111111',binding={id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_video_discovery-fixture__a1',task_id:task},source='a'.repeat(40);
   const frozen={snapshot_sha256:'b'.repeat(64),deployment:{source_commit:source},files,agent_input:{workflow_key:'douyin_video_discovery',run_tag:'fixture',line:'yuesheng',profile:'fixture',serial:'SERIAL',source_run:null,limit:2},discovery_phone_scope:{version:1,task_id:task,run_id:binding.run_id,source_commit:source,profile:'fixture',serial:'SERIAL',expected_account:'actual',evidence_root:evidence,policy,executables:{python:{path:'/usr/bin/python3',sha256:sha(readFileSync('/usr/bin/python3'))}}}};
   const mocks={ './runtime-definition.mjs':{readFrozen:()=>frozen},'./runtime-binding.mjs':{readBinding:()=>binding},'./leadgen-client.mjs':{rpcSource:()=>({})},'./preflight-metadata.mjs':{createPreflightMetadata:()=>({snapshot:()=>({unknown:false})})},'./preflight-control-scope.mjs':{createPreflightPoolFactory:()=>()=>{throw Error('UNEXPECTED_PG');}}};
   const module=new SourceTextModule(readFileSync(join(root,'preflight-phone-scope.mjs'),'utf8'),{identifier:pathToFileURL(join(root,'preflight-phone-scope.mjs')).href});
   await module.link(async name=>{const exports=mocks[name]||await import(name.startsWith('.')?new URL(name,module.identifier).href:name);return new SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);});});await module.evaluate();
   const {createPreflightRuntime}=module.namespace,env={HOME:home,P:'fixture',SERIAL:'SERIAL',WFR_TAG:'fixture',WFR_RUN_DIR:directory,WFR_ATTEMPT:'a1',DOUYIN_PHONE_REGISTRY:profile,ZJ_ADB_HOST_CONFIG:config};const factory=createPreflightRuntime({root:runtime,env,frozen,binding,taskId:task}),now=Date.now(),scope={workflow:'douyin_video_discovery',activity:'preflight',task_id:task,run_id:binding.run_id,binding_id:binding.id,source_commit:source,worker_deadline_ms:now+15000,receipt_deadline_ms:now+20000};
   const context={state:{source_commit:source,task_id:task,company_config:{expected_sender:'actual'}},assertResources:async()=>{}};
   const handle=await factory.prepare(scope,context);assert.equal(handle.snapshot().owned,true);assert.equal(handle.snapshot().facts.call_state_idle,true);
   const proof={execution_stopped:true,receipt:{source_commit:source,execution_stopped:true,owner_execution_stopped:true,child_execution_stopped:true,child_run_id:'33333333-3333-4333-8333-333333333333',terminal:{runId:'33333333-3333-4333-8333-333333333333',endedAt:Date.now()}}};
   if(process.argv.includes('--wrong-source')){proof.receipt.source_commit='c'.repeat(40);await assert.rejects(()=>handle.close(proof),/OFFICIAL_STOP/);assert.equal(handle.snapshot().closed,true);assert.equal(factory.nativeState().execution_unknown,true);await assert.rejects(()=>factory.prepare({...scope,activity:'cleanup'},context),/CLEANUP_AUTHORITY/);return {unknown:true};}
   assert.equal((await handle.close(proof)).execution_stopped,true);assert.equal(factory.nativeState().execution_unknown,false);assert.throws(()=>factory.desktopVerificationOptions(),/DESKTOP_AUTHORITY/);
   const cleanup=await factory.prepare({...scope,activity:'cleanup'},context);try{
   const close_stdout=await cleanup.phone('close-app'),desktop_stdout=await cleanup.phone('return-safe-desktop'),id='fixture-a1-cleanup-desktop';
   const xmlFile=(await cleanup.phone('ui-evidence',id)).trim(),pngFile=(await cleanup.phone('snapshot-evidence',id)).trim(),xml=readFileSync(xmlFile,'utf8'),png=readFileSync(pngFile);
   assert.equal((await cleanup.close(proof,{close_stdout,desktop_stdout,xml,png})).execution_stopped,true);
   const options=factory.desktopVerificationOptions(),{verifyAgentDesktopNative}=await import('../discovery-cleanup-readback.mjs');assert.equal(verifyAgentDesktopNative(close_stdout,desktop_stdout,xml,png,options),'com.android.launcher');
   assert.throws(()=>verifyAgentDesktopNative(close_stdout,desktop_stdout,xml+' ',png,options),/DESKTOP_BINDING/);
   await assert.rejects(()=>cleanup.phone('close-app'),/PREFLIGHT_PHONE_CLOSED/);
   assert.deepEqual(await factory.release(),{lock_released:1,no_lock:true});await assert.rejects(()=>factory.release(),/RELEASE_AUTHORITY/);
   return {owned:cleanup.snapshot().owned,closed:cleanup.snapshot().closed,supports:factory.supports({key:'preflight'})};}finally{await cleanup.close(proof);}
  }finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
 }finally{os.userInfo=originalUser;syncBuiltinESMExports();rmSync(directory,{recursive:true,force:true});}
}
if(process.argv.includes('--scope-fixture')){try{console.log(JSON.stringify(await fixture()));}catch(error){console.error(error);process.exitCode=1;}}
else test('actual preflight factory owns nofork route/device/local lock and requires independent official stop',{skip:process.platform!=='darwin'},()=>{
 const p=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'--scope-fixture'],{encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);assert.deepEqual(JSON.parse(p.stdout),{owned:false,closed:true,supports:false});
});

if(!process.argv.includes('--scope-fixture'))test('wrong official source still seals owned host leaves but never grants cleanup authority',{skip:process.platform!=='darwin'},()=>{const p=spawnSync(process.execPath,['--experimental-vm-modules',fileURLToPath(import.meta.url),'--scope-fixture','--wrong-source'],{encoding:'utf8',timeout:30000});assert.equal(p.status,0,p.stderr);assert.deepEqual(JSON.parse(p.stdout),{unknown:true});});
