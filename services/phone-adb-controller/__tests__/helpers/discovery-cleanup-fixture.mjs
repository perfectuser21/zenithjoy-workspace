// 原handler/execInput/managed wrapper/Darwin C leaf均真实；只隔离设备及PG边界。
import {collectionFixture} from './collection-recovery-fixture.mjs';
import {readFileSync,writeFileSync,readdirSync,statSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
export const discoveredId='7681632828384394202';
export async function discoveryFixture(t,{empty=false,stop=true,guardUnknown=false,slowLeaf=false,codeOneLeaf=false,unknownAfterLink=false,attemptLimit,screenLimit=false,rpcFailure=false}={}){
 const f=await collectionFixture(t),load=name=>import(pathToFileURL(join(f.runtime,name)));
 if(slowLeaf){
  const c=join(f.d,'slow-leaf.c'),client=f.frozen.collection_phone_scope.policy.adb_bin;
  writeFileSync(c,'#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <unistd.h>\nint main(int n,char**a){if(n==2&&!strcmp(a[1],"version"))puts("Android Debug Bridge version 1.0.41");else if(!strcmp(a[n-1],"sleep-probe")){char p[4096];snprintf(p,sizeof p,"%s/slow-leaf-entered",getenv("COLLECTION_FIXTURE_DIR"));FILE*f=fopen(p,"w");if(!f)return 4;fputs("entered",f);fclose(f);sleep(30);}else if(!strcmp(a[n-1],"telephony.registry"))puts("mCallState=0");else puts("device");return 0;}\n');
  const r=spawnSync('cc',[c,'-o',client],{encoding:'utf8'});if(r.status)throw Error(r.stderr);
  f.frozen.collection_phone_scope.policy.adb_sha256=createHash('sha256').update(readFileSync(client)).digest('hex');writeFileSync(f.env.ZJ_ADB_HOST_CONFIG,JSON.stringify(f.frozen.collection_phone_scope.policy),{mode:0o600});
 }
 if(codeOneLeaf||unknownAfterLink){
  const c=join(f.d,'client.c'),client=f.frozen.collection_phone_scope.policy.adb_bin;
  writeFileSync(c,readFileSync(c,'utf8').replace('else puts("device");',`else if(!strcmp(a[n-1],"${unknownAfterLink?'probe-unknown':'probe-one'}"))return ${unknownAfterLink?137:1};else puts("device");`));
  const r=spawnSync('cc',[c,'-o',client],{encoding:'utf8'});if(r.status)throw Error(r.stderr);
  f.frozen.collection_phone_scope.policy.adb_sha256=createHash('sha256').update(readFileSync(client)).digest('hex');writeFileSync(f.env.ZJ_ADB_HOST_CONFIG,JSON.stringify(f.frozen.collection_phone_scope.policy),{mode:0o600});
 }
 const ctl=join(f.runtime,'douyin-phone-adb');
 writeFileSync(ctl,'#!/bin/zsh\nexec node "${0:A:h}/fixture-discovery-controller.cjs" "$@"\n',{mode:0o755});
 writeFileSync(join(f.runtime,'fixture-discovery-controller.cjs'),`const fs=require('fs'),p=require('path'),cp=require('child_process');let a=process.argv.slice(2);if(a[2]==='--lock-owner')a.splice(2,2);const cmd=a[2],args=a.slice(3),d=process.env.COLLECTION_FIXTURE_DIR,root=process.env.DOUYIN_PHONE_TMP_ROOT,owner=p.join(root,'locks','NO-DEVICE.lock','owner');
fs.appendFileSync(p.join(d,'phone-calls'),JSON.stringify({cmd,args,scoped:!!process.env.WFR_COLLECTION_LEAF_SOCKET})+'\\n');
if(cmd==='lock-acquire'){fs.mkdirSync(p.dirname(owner),{recursive:true});fs.writeFileSync(owner,'scope-owner\\n');console.log('lock=acquired');process.exit(0);}
if(cmd==='lock-refresh'){if(fs.readFileSync(owner,'utf8')!=='scope-owner\\n')process.exit(4);console.log('lock=refreshed owner=scope-owner ttl=300s');process.exit(0);}
if(cmd==='lock-release'){if(fs.readFileSync(owner,'utf8')!=='scope-owner\\n')process.exit(4);fs.unlinkSync(owner);console.log('lock=released');process.exit(0);}
const r=cp.spawnSync(process.env.DOUYIN_PYTHON_BIN||'python3',[p.join(__dirname,'adb-managed-client.py'),'-s','NO-DEVICE','get-state'],{encoding:'utf8',env:process.env});if(r.status){process.stderr.write(r.stderr);process.exit(r.status||2);}
const evidence=p.join(root,'evidence','scope-profile');fs.mkdirSync(evidence,{recursive:true});
switch(cmd){case 'preflight':console.log('serial=NO-DEVICE');break;case 'account-current':console.log('douyin_id=fixture-account');break;
case 'close-app':console.log('foreground=com.example.launcher/.Home');break;
case 'return-safe-desktop':console.log('launcher=com.example.launcher\\nforeground_package=com.example.launcher\\nforeground=com.example.launcher/.Home');break;
case 'snapshot-evidence':{const file=p.join(evidence,args[0]+'.png');fs.writeFileSync(file,Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(50),Buffer.from('49454e44ae426082','hex')]));console.log(file);break;}
case 'ui-evidence':{const file=p.join(evidence,args[0]+'.xml');fs.writeFileSync(file,'<hierarchy><node package="com.example.launcher"/></hierarchy>');console.log(file);break;}
case 'search-time-layer':console.log('sort='+args[2]+'\\ntime_layer='+args[0]+'\\nduration='+args[3]+'\\nscope='+args[4]+'\\nlocation='+args[5]);break;
case 'search-video-cards':{const file=p.join(evidence,'grid.xml');fs.writeFileSync(file,'<hierarchy><node resource-id="com.ss.android.ugc.aweme:id/et_search_kw" text="AI"/></hierarchy>');console.log('340\\t540\\t00:20\\t真实目标\\t甲\\n350\\t550\\t00:20\\t下一目标\\t乙\\nvideo_tab=1\\nloading=0\\nend_of_results=1\\nevidence='+file);break;}
case 'search-kw-matches':console.log('kw_matches=1');break;
case 'current-video-link':{if(${guardUnknown}){fs.writeFileSync(process.env.WFR_NATIVE_UNKNOWN_FILE,'guard_exception');process.stderr.write('NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN\\n');process.exit(7);}const id='${discoveredId}',eid=args[0]+'-t1',file=p.join(evidence,eid+'-share.xml');fs.writeFileSync(file,'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢67，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论4，按钮"/></hierarchy>');console.log('video_id='+id+'\\nshort_url=https://v.douyin.com/fixture/\\nresolved_url=https://www.douyin.com/video/'+id+'\\ncontent_type=video\\nreturn_mode=results\\nmetrics_evidence='+file+'\\nmetrics_evidence_id='+eid);break;}}
`);
 if(unknownAfterLink){
  const controller=join(f.runtime,'fixture-discovery-controller.cjs');
  writeFileSync(controller,readFileSync(controller,'utf8').replace(`const id='${discoveredId}',eid=`,`const unknown=cp.spawnSync(process.env.DOUYIN_PYTHON_BIN||'python3',[p.join(__dirname,'adb-managed-client.py'),'-s','NO-DEVICE','shell','probe-unknown'],{encoding:'utf8',env:process.env});if(unknown.status!==137)process.exit(8);const id='${discoveredId}',eid=`));
 }
 const scope={...f.frozen.collection_phone_scope,run_id:'douyin_video_discovery-scope-owner__a1',expected_account:'fixture-account'};
 delete f.frozen.collection_phone_scope;f.frozen.discovery_phone_scope=scope;f.frozen.workflow_version.payload.key='douyin_video_discovery';
 f.env.LEADGEN_EVIDENCE_DIR=scope.evidence_root;f.env.WF_BRAIN_WORKFLOW='douyin_video_discovery';f.env.WFR_RUN_ID='douyin_video_discovery-scope-owner';f.env.LEADGEN_SOURCE_RUN='';f.env.LEADGEN_LOCATION='unlimited';f.env.LEADGEN_LIMIT=screenLimit?'10':stop?'0':'1';f.env.WF_STOP_FILE=join(f.d,'stop');f.env.WF_RUN_START_TS=String(Math.floor(Date.now()/1000));f.env.WF_RUN_MAX_SECONDS='1800';
 if(screenLimit){
  f.env.LEADGEN_MAX_SCREENS='1';
  const controller=join(f.runtime,'fixture-discovery-controller.cjs');
  writeFileSync(controller,readFileSync(controller,'utf8').replace('end_of_results=1','end_of_results=0'));
 }
 const hash=b=>createHash('sha256').update(b).digest('hex');f.frozen.files={};
 const visit=dir=>{for(const n of readdirSync(dir)){const p=join(dir,n);if(statSync(p).isDirectory())visit(p);else f.frozen.files['runtime/'+p.slice(f.runtime.length+1)]=hash(readFileSync(p));}};visit(f.runtime);
 if(attemptLimit!==undefined){
  f.env.LEADGEN_SOURCE_KIND='keyword';f.env.LEADGEN_MAX_SCREENS='1';f.env.LEADGEN_DISCOVERY_MAX_ATTEMPTS=String(attemptLimit);f.env.LEADGEN_LIMIT='0';
  f.env.LEADGEN_SOURCES_FILE=join(f.d,'keywords.txt');writeFileSync(f.env.LEADGEN_SOURCES_FILE,'AI\n');
  f.frozen.discovery_input={schema_version:2,workflow_key:'douyin_video_discovery',run_tag:f.env.WFR_TAG,profile:f.env.P,serial:f.env.SERIAL,line:f.env.LEADGEN_LINE,max_attempts:attemptLimit,max_screens:1,source_kind:'keyword',sources:['AI'],source_sha256:hash(Buffer.from('AI\n'))};
  const controller=join(f.runtime,'fixture-discovery-controller.cjs');
  writeFileSync(controller,readFileSync(controller,'utf8').replace('video_tab=1','360\\t560\\t00:20\\t第三目标\\t丙\\n370\\t570\\t00:20\\t第四目标\\t丁\\nvideo_tab=1'));
  f.frozen.files={};visit(f.runtime);
 }
 const {digest}=await load('runtime-definition.mjs');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));
 writeFileSync(join(f.d,'run-bindings/a1.request.json'),JSON.stringify({runtime_snapshot_sha256:f.frozen.snapshot_sha256,run_id:scope.run_id,body:{task_id:'scope-task'}}));writeFileSync(join(f.d,'run-bindings/a1.ack.json'),JSON.stringify({binding:{id:'scope-binding',run_id:scope.run_id,task_id:'scope-task'}}));
 const stored=[],rpcCalls=[],rpcOptions=[],{createHandlers}=await load('leadgen-handlers.mjs'),{execInput}=await load('leadgen-client.mjs');
 const h=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',execute:(command,args,opts)=>command==='/bin/sleep'?Promise.resolve({code:0,stdout:'',stderr:''}):execInput(command,args,opts),rpc:async(body,options)=>{
  rpcCalls.push(body);rpcOptions.push(options);if(body.kind==='keywords')return {result:['AI']};const q=body.request;
  if(q?.op==='discover'){if(rpcFailure&&stored.length===1)throw Error('EXECUTION_DEADLINE');stored.push(q.video);if(stop)writeFileSync(f.env.WF_STOP_FILE,'stop');return {result:{status:'pending',inserted:true,metrics_verified:true,metrics_digest:q.video.metrics.digest}};}
  if(q?.op==='inspect_videos'){if(rpcFailure)throw Error('RPC_RECEIPT_MISSING');return {result:q.video_ids.map(video_id=>({video_id,line_key:'jinuo'}))};}return {result:{}};
 }});
 h.state.currentActivity='preflight';await h.preflight();
 h.state.currentActivity='collect_videos';h.state.budgetDeadline=Date.now()+(empty?30000:1200000);
 const context={run_id:scope.run_id,task_id:'scope-task',source_commit:'a'.repeat(40),activity:'collect_videos'};
 return {...f,h,context,load,stored,rpcCalls,rpcOptions,workDeadline:h.state.budgetDeadline,ownerFile:join(scope.evidence_root,'..','..','locks','NO-DEVICE.lock','owner'),scopeLedgers:()=>{const dir=join(f.d,'discovery-phone-scopes','collect');return existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith('.jsonl')).map(n=>readFileSync(join(dir,n),'utf8')):[];}};
}
