// 原handler/逐视频脚本/execInput/broker/nofork均真实，仅手机、PG和Agent传输为隔离夹具。
import {mkdtempSync,cpSync,writeFileSync,readFileSync,mkdirSync,readdirSync,statSync,realpathSync,symlinkSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const vids=['7681632828384394202','7681632828384394203'];
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function collectionFixture(t){
 const d=mkdtempSync(join(tmpdir(),'collection-real-recovery-')),runtime=join(d,'runtime'),source=new URL('../../',import.meta.url).pathname;
 cpSync(source,runtime,{recursive:true,filter:path=>!path.includes('/__tests__')&&!path.includes('/runtime/')});
 const sockets=new Set(),server=createServer(c=>{sockets.add(c);c.on('close',()=>sockets.delete(c));c.on('error',()=>{});let b='';c.on('data',s=>{b+=s;if(b.length<4)return;const n=parseInt(b.slice(0,4),16);if(b.length<4+n)return;const q=b.slice(4,4+n),out=q==='host:version'?'0029':q==='host:devices'?'NO-DEVICE\tdevice\n':null;if(out===null){c.end('FAIL0003bad');return;}c.end('OKAY'+Buffer.byteLength(out).toString(16).padStart(4,'0')+out);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const c of sockets)c.destroy();server.close();});
 const c=join(d,'client.c'),client=join(d,'adb'),bin=join(d,'bin');mkdirSync(bin);
 writeFileSync(c,'#include <stdio.h>\n#include <string.h>\nint main(int n,char **a){if(n==2&&!strcmp(a[1],"version"))puts("Android Debug Bridge version 1.0.41");else if(!strcmp(a[n-1],"telephony.registry"))puts("mCallState=0");else puts("device");return 0;}\n');
 const cc=spawnSync('cc',[c,'-o',client],{encoding:'utf8'});if(cc.status)throw Error(cc.stderr);symlinkSync(client,join(bin,'adb'));
 const policy={schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:'+server.address().port,forbidden_ports:[],adb_bin:client,adb_sha256:hash(readFileSync(client))};
 const policyFile=join(d,'baseline-policy.json');writeFileSync(policyFile,JSON.stringify(policy),{mode:0o600});
 const controller=join(runtime,'douyin-phone-adb');
 writeFileSync(controller,`#!/usr/bin/env node
const fs=require('fs'),path=require('path'),cp=require('child_process');const a=process.argv.slice(2),d=process.env.COLLECTION_FIXTURE_DIR;if(a[2]==='--lock-owner')a.splice(2,2);const cmd=a[2],args=a.slice(3);fs.appendFileSync(path.join(d,'phone-calls'),JSON.stringify({cmd,args})+'\\n');
const r=cp.spawnSync('python3',[path.join(${JSON.stringify(runtime)},'adb-managed-client.py'),'-s','NO-DEVICE','get-state'],{encoding:'utf8',env:process.env});if(r.status){process.stderr.write(r.stderr);process.exit(r.status||2);}
switch(cmd){case 'preflight':console.log('serial=NO-DEVICE');break;case 'account-current':console.log('douyin_id=fixture-account');break;case 'lock-acquire':console.log('lock=acquired');break;case 'lock-refresh':console.log('lock=refreshed owner=scope-owner ttl=300s');break;case 'open-video':fs.writeFileSync(path.join(d,'active'),args[0]);break;case 'current-video-link':{let vid=fs.readFileSync(path.join(d,'active'),'utf8');if(args[0].includes('-collection-')&&vid===${JSON.stringify(vids[1])}&&!fs.existsSync(path.join(d,'repaired')))vid='7999999999999999999';console.log('content_type=video\\nvideo_id='+vid);break;}case 'open-comments':console.log('reason=no_comments_on_this_video');break;case 'back-evidence':fs.writeFileSync(path.join(d,'repaired'),'yes');break;}
`,{mode:0o755});
 const python=realpathSync(spawnSync('sh',['-c','command -v python3'],{encoding:'utf8'}).stdout.trim()),node=realpathSync(process.execPath),zsh=realpathSync('/bin/zsh');
 const scope={version:1,task_id:'scope-task',run_id:'scope-run__a1',attempt:'a1',source_commit:'a'.repeat(40),profile:'scope-profile',serial:'NO-DEVICE',target:'xian-m4',evidence_root:join(d,'phone','evidence','scope-profile'),policy,executables:Object.fromEntries(Object.entries({python,node,zsh}).map(([key,path])=>[key,{path,sha256:hash(readFileSync(path))}]))};
 mkdirSync(join(d,'.config/openclaw'),{recursive:true});writeFileSync(join(d,'.config/openclaw/douyin-account-routes.tsv'),'scope-profile\tfixture-account\n');
 const method='skills/douyin-leadgen-activity-102-collection/SKILL.md',text=readFileSync(join(runtime,method),'utf8'),version=text.match(/^  version: (.+)$/m)[1];
 const files={};const visit=folder=>{for(const name of readdirSync(folder)){const path=join(folder,name);if(statSync(path).isDirectory())visit(path);else files['runtime/'+path.slice(runtime.length+1)]=hash(readFileSync(path));}};visit(runtime);
 const frozen={files,collection_phone_scope:scope,deployment:{source_commit:scope.source_commit,target:'xian-m4',observation_id:'scope-observation'},snapshot_sha256:null,release:{id:'scope-release'},workflow_version:{id:'scope-workflow',payload:{key:'douyin_video_processing'}},activities:[{reference:{slot_key:'collection',reference_id:'scope-ref'},version:{id:'scope-av',payload:{definition_key:'douyin_video_processing.collection',contract:{key:'collection'},implementation_bindings:[{kind:'skill',name:'douyin-leadgen-activity-102-collection',version,path:'services/phone-adb-controller/'+method}]}}}]};
 const {digest}=await import(pathToFileURL(join(runtime,'runtime-definition.mjs')));delete frozen.snapshot_sha256;frozen.snapshot_sha256=digest(frozen);writeFileSync(join(d,'run-definition.json'),JSON.stringify(frozen));
 mkdirSync(join(d,'run-bindings'));writeFileSync(join(d,'run-bindings/a1.request.json'),JSON.stringify({runtime_snapshot_sha256:frozen.snapshot_sha256,run_id:'scope-run__a1',body:{task_id:'scope-task'}}));writeFileSync(join(d,'run-bindings/a1.ack.json'),JSON.stringify({binding:{id:'scope-binding',run_id:'scope-run__a1',task_id:'scope-task'}}));
 const env={...process.env,HOME:d,PATH:bin+':'+process.env.PATH,WFR_RUN_DIR:d,WFR_RUN_ID:'scope-run',WFR_ATTEMPT:'a1',WFR_TAG:'scope-owner',P:'scope-profile',SERIAL:'NO-DEVICE',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:'scope-source101',DOUYIN_PHONE_ADB:controller,DOUYIN_PHONE_TMP_ROOT:join(d,'phone'),COLLECTION_FIXTURE_DIR:d,ZJ_ADB_HOST_CONFIG:policyFile,HARVEST_KEYWORD_TESTING:'1'};
 const dbCalls=[],stored=new Map();
 const queue=async q=>{dbCalls.push(q);const base={video_id:q.video_id,video_url:q.video_url};switch(q.op){case 'company_config':return {company_id:'fixture-company',version:1};case 'claim_videos':return vids.map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,judgment_status:'matched',judgment_config:{company_id:'fixture-company',version:1}}));case 'renew_video':return {renewed:true};case 'comment_history':return {version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'scope-owner',source_run:'scope-source101',...base,rows:[]};case 'collect':stored.set(q.video_id,true);return {comments:0,inserted:0,history_verified:0,coverage:0};case 'comment_history_readback':return {...base,verified:true,ids:[],history_verified:0};case 'sample_readback':return {...base,verified:true,coverage:0,rows:[]};case 'inspect_videos':return q.video_ids.map(video_id=>({video_id,line_key:'jinuo',judgment_status:'matched',judgment_config:{company_id:'fixture-company',version:1},process_status:stored.has(video_id)?'评论已采':'处理中:scope-owner',harvest_batch:'scope-owner'}));default:return {};}};
 return {d,runtime,frozen,env,dbCalls,stored,queue,phoneCalls:()=>readFileSync(join(d,'phone-calls'),'utf8').trim().split('\n').map(JSON.parse)};
}
