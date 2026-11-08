// Synthetic ROM/Android/Brain replies only. Product issuer, shell-v2 framing,
// parent nofork producer, account parser, lock/receipt and cleanup stay real.
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {startNativePhoneAdbFixture} from './native-phone-public-fixture.mjs';
import {preflightTestPython} from '../helpers/preflight-test-python.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function publicCodeNativeFixture(t,{workflow='douyin_video_discovery',slowDump=false,deviceProfile='fixture',deviceSerial='192.0.2.31:10001',expectedAccount='expected',onDump=()=>{},sourceTransform=()=>{}}={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'public-code-native-'))),root=join(directory,'runtime'),home=join(directory,'home'),evidence=join(directory,'evidence');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(home,{mode:0o700});mkdirSync(evidence,{mode:0o700});
 cpSync(new URL('../../',import.meta.url),root,{recursive:true,filter:p=>!p.split('/').some(x=>['__tests__','node_modules','__pycache__','_dependencies'].includes(x))});
 // The fixed Python leaf retains its original production root validation;
 // the fixture substitutes ONLY the home-root selector before freezing bytes.
 const lockSource=join(root,'phone-lock-root.py');let text=readFileSync(lockSource,'utf8');text=text.replace('home = Path(pwd.getpwuid(os.geteuid()).pw_dir)',`home = Path(${JSON.stringify(home)})`);text=text.replace("record['legacy_root'] == '/private/tmp/openclaw-phone/locks'",`record['legacy_root'] == ${JSON.stringify(join(home,'legacy'))}`);writeFileSync(lockSource,text);
 const locks=join(home,'.local/share/zenithjoy/phone-locks');mkdirSync(locks,{recursive:true,mode:0o700});writeFileSync(join(locks,'.migration-complete.json'),JSON.stringify({schema_version:1,state:'complete',source_sha256:'a'.repeat(64),legacy_root:join(home,'legacy')}));
 const binary=join(directory,'adb-fixture'),c=binary+'.c';writeFileSync(c,'#include <stdio.h>\nint main(){puts("device");return 0;}');const cc=spawnSync('cc',[c,'-o',binary],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const serial=deviceSerial,profile=deviceProfile,account=expectedAccount,rom=Buffer.from('synthetic-reviewed-ROM'),programs=['getprop','dumpsys','input','wm','monkey','uiautomator','screencap','am','cmd'];
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082','hex');
 let desktop=false,dumpStartedResolve;const dumpStarted=new Promise(r=>dumpStartedResolve=r),calls=[];
 const xml=()=>desktop?'<hierarchy><node package="com.android.launcher3"/></hierarchy>':'<hierarchy><node text="抖音号：'+account+'"/><node text="编辑主页"/></hierarchy>';
 const adb=await startNativePhoneAdbFixture(t,{serial,readFile:async path=>path.startsWith('/system/')?rom:path.endsWith('.png')?png:Buffer.from(xml()),command:async command=>{
  calls.push(command);let stdout='';if(command.includes('ro.product.model'))stdout='Fixture';else if(command.includes('ro.build.version.sdk'))stdout='31';else if(command.includes('telephony.registry'))stdout='mCallState=0';else if(command.includes("'window' 'displays'"))stdout='mCurrentFocus=Window{abc u0 '+(desktop?'com.android.launcher3/.Home':'com.ss.android.ugc.aweme/.MainActivity')+'}';
  else if(command.includes('resolve-activity'))stdout='com.android.launcher3/.Home';else if(command.includes('force-stop'))desktop=true;
  if(command.includes('uiautomator')){onDump();dumpStartedResolve();if(slowDump)await new Promise(r=>setTimeout(r,120));}
  return {stdout:Buffer.from(stdout)};
 }});
 const policy={schema_version:1,host_id:'mmv',transport:'tcp',endpoint:adb.endpoint,forbidden_ports:[],adb_bin:binary,adb_realpath:binary,adb_sha256:hash(readFileSync(binary))},policyPath=join(directory,'adb-service.json');writeFileSync(policyPath,JSON.stringify(policy),{mode:0o600});
 const reviewPath='config/native-phone-reviews/fixture-public-code.md';writeFileSync(join(root,reviewPath),'SYNTHETIC ROM FOR LOOPBACK TEST ONLY');
 writeFileSync(join(root,'config/native-phone-command-sources.json'),JSON.stringify({schema_version:1,device_sources:[{profile,serial,package:'com.ss.android.ugc.aweme',width:1,height:1,device_sdk:31,review:{path:reviewPath,sha256:hash(readFileSync(join(root,reviewPath)))},program_files:programs.map(p=>({path:'/system/bin/'+p,sha256:hash(rom)})),commands:['sdk','model','telecom','foreground','window','wake','unlock','open-app','tap','dump-file','screenshot-file','close-app','home-resolve','keyevent']}]}));
 const registry=join(directory,'profiles.tsv');writeFileSync(registry,'profile\tserial\tmodel\twidth\theight\tenabled\n'+profile+'\t'+serial+'\tFixture\t1\t1\ttrue\n');
 const identity={mode:'formal',run_id:randomUUID(),task_id:randomUUID(),machine_id:'us-mac-m4',profile_sha256:'a'.repeat(64),run_binding:{run_binding_id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:randomUUID(),attempt_key:'fixture-task:1',activities:{preflight:{reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()}}}};
 const env={...process.env,HOME:home,WFR_RUN_DIR:directory,WF_BRAIN_WORKFLOW:workflow,WFR_TAG:'fixture_public',WFR_ATTEMPT:'a1',P:profile,SERIAL:serial,LEADGEN_LINE:'yuesheng',ZJ_ADB_HOST_CONFIG:policyPath,DOUYIN_PHONE_REGISTRY:registry};
 sourceTransform({root,env,policy});
 const load=n=>import(pathToFileURL(join(root,n)).href),authority=await load('public-domain-authority.mjs'),definitions=await load('runtime-definition.mjs');
 const state={run_id:identity.run_id,task_id:identity.task_id,source_commit:'a'.repeat(40),budgetDeadline:Date.now()+300000,company_config:{expected_sender:account}},deadline=Date.now()+300000;
 const unregister=authority.registerPublicDomainAuthority({runDirectory:directory,identity,deadline_ms:deadline,cleanup_deadline_ms:deadline+120000,business_scope:{run:env.WFR_TAG,run_id:identity.run_id,task_id:identity.task_id,source_commit:state.source_commit,profile,serial,attempt:'a1'}});t.after(unregister);
 const files={};function inventory(base,prefix=''){for(const row of readdirSync(base,{withFileTypes:true})){const relative=prefix+row.name,path=join(base,row.name);if(row.isDirectory())inventory(path,relative+'/');else files['runtime/'+relative]=hash(readFileSync(path));}}inventory(root);
 const frozen={execution_mode:'code',deployment:{source_commit:state.source_commit},preflight_profile:(await load('preflight-control-scope.mjs')).freezePreflightProfile({env}),files,[workflow==='douyin_video_discovery'?'discovery_phone_scope':'collection_phone_scope']:{policy,executables:{python:{path:realpathSync(preflightTestPython),sha256:hash(readFileSync(preflightTestPython))}},profile,serial,expected_account:account,evidence_root:evidence}};frozen.snapshot_sha256=definitions.digest(frozen);writeFileSync(join(directory,'run-definition.json'),JSON.stringify(frozen));
 const claim={claimed_by:'common-runner',claimed_at:new Date().toISOString()};let held=true;
 const lease={attempted:true,verifyTask:async()=>({...claim}),verifyHeld:async()=>{assert.equal(held,true);},release:async()=>{held=false;return true;}};
 return {directory,root,home,locks,env,state,frozen,lease,load,calls,dumpStarted,registry};
}
