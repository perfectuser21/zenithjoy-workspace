import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validateVideoInput}=require('../video-activities.js');
const {runWorkflowActivity}=require('../keyword-workflow-activity.js');
const input={run_tag:'freeze',line_key:'jinuo',device:{profile:'jinoshengyuan-work',serial:'fixture',lock_holder:'freeze'},video:{video_id:'7412345678901234567',title:'fixture'},execution:{gateway:{host:'isolated',cwd:'/tmp/frozen',node:'/usr/bin/node',env_file:'/tmp/home/.credentials/fake.env'}}};
test('资格包装保留显式冻结网关',async()=>{
 let native;
 await runWorkflowActivity('qualification',input,{invoke:async(entry,args,value)=>{if(entry==='video-activity.js')native=value;throw Error('fixture');}});
 assert.deepEqual(native.execution,input.execution);
});
test('非法或部分网关在手机动作前拒绝',()=>{
 for(const gateway of [null,{}, {...input.execution.gateway,cwd:'/tmp/../production'}, {...input.execution.gateway,node:'node'}, {...input.execution.gateway,env_file:'/tmp/home/.credentials/fake'}, {...input.execution.gateway,cwd:'/tmp/\u0001frozen'}]){
 assert.throws(()=>validateVideoInput({...input,execution:{gateway}}),/网关/);
 }
});
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),service=resolve(import.meta.dirname,'..');
test('原设备角色冒充网关确实漏fetch-seen CLI；gateway快照应完整',async t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-role-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const device=join(home,'device');mkdirSync(device);
 const deploy=readFileSync(join(service,'deploy.sh'),'utf8');
 for(const group of ['DEVICE_SH_FILES','DEVICE_NODE_FILES','DEVICE_PLAN_FILES']){
  for(const file of new RegExp('^'+group+'=\\(([\\s\\S]*?)\\)','m').exec(deploy)[1].trim().split(/\s+/)){
   mkdirSync(resolve(device,file,'..'),{recursive:true});copyFileSync(join(service,file),join(device,file));
  }
 }
 const old=spawnSync(process.execPath,[join(device,'fetch-seen-videos.js'),'--line','jinuo'],{env:{HOME:home,PATH:process.env.PATH},encoding:'utf8'});
 assert.match(old.stderr,/MODULE_NOT_FOUND/);
 const {prepareSnapshot,verifySnapshot}=await import('../gateway-snapshot.mjs');
 const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const gateway=join(home,'gateway');prepareSnapshot({root,commit:sha,role:'gateway',directory:gateway});
 assert.equal(verifySnapshot({root,commit:sha,role:'gateway',directory:gateway}).role,'gateway');
 const own=spawnSync(process.execPath,[join(gateway,'check-own-account.js'),'fixture-nonowner','fixture-nonowner'],{env:{HOME:home,PATH:'/usr/bin:/bin'},encoding:'utf8'});
 assert.equal(own.stderr,'','静态config资产必须与冻结JS一起携带');assert.equal(own.stdout.trim(),'not_own');
 for(const config of ['config/own-accounts.json','config/dm-rate-ramp.json'])assert.deepEqual(readFileSync(join(gateway,config)),execFileSync('git',['-C',root,'show',`${sha}:services/phone-adb-controller/${config}`]));
 assert.throws(()=>verifySnapshot({root,commit:'0'.repeat(40),role:'gateway',directory:gateway}),/固定commit/);
 const preparedDevice=join(home,'prepared-device');const dm=prepareSnapshot({root,commit:sha,role:'device',directory:preparedDevice});
 assert.throws(()=>verifySnapshot({root,role:'gateway',directory:preparedDevice}),/角色/);
 const gm=JSON.parse(readFileSync(join(gateway,'snapshot-manifest.json')));
 for(const entry of dm.files.filter(f=>gm.files.some(g=>g.path===f.path)))assert.deepEqual(readFileSync(join(preparedDevice,entry.path)),readFileSync(join(gateway,entry.path)));
 const forged={...dm,role:'gateway'};writeFileSync(join(preparedDevice,'snapshot-manifest.json'),JSON.stringify(forged));
 assert.throws(()=>verifySnapshot({root,role:'gateway',directory:preparedDevice}),/清单不完整/);
 const intact=readFileSync(join(gateway,'fetch-seen-videos.js'));writeFileSync(join(gateway,'fetch-seen-videos.js'),'//tampered');
 assert.throws(()=>verifySnapshot({root,role:'gateway',directory:gateway}),/字节/);writeFileSync(join(gateway,'fetch-seen-videos.js'),intact);
 for(const file of ['fetch-seen-videos.js','video-delivery-storage.js','workflow-probe.js','config/own-accounts.json','config/dm-rate-ramp.json']){
  const bytes=readFileSync(join(gateway,file));rmSync(join(gateway,file));
  assert.throws(()=>verifySnapshot({root,role:'gateway',directory:gateway}),/快照/);
  writeFileSync(join(gateway,file),bytes);
 }
 assert.throws(()=>prepareSnapshot({root,commit:sha,role:'gateway',directory:gateway}),/存在/);
});
import {gatewayFixture} from './gateway-cli-fixture.mjs';
test('永久真实CLI在冻结gateway执行历史/资格三命令/评分配送与探针', {timeout:60000},async t=>{
 const f=await gatewayFixture(t);const result=await f.run();
 if(process.env.GATEWAY_FREEZE_REPORT_DIR){const out=process.env.GATEWAY_FREEZE_REPORT_DIR;mkdirSync(out,{recursive:true});for(const name of ['actual-remote.jsonl','actual-ssh.jsonl','actual-pg.jsonl','calls','pg.json','receipt.json']){try{copyFileSync(join(f.home,name),join(out,name));}catch{}}}
 assert.equal(result.receipt.status,'completed',JSON.stringify(result.receipt.activities.map(a=>[a.key,a.status,a.attempts?.map(r=>r.reason_code)])));
 const calls=readFileSync(join(f.home,'actual-ssh.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const entry of ['fetch-seen-videos.js','qualify-video.js','comment-activity.js','workflow-probe.js'])assert.ok(calls.some(call=>call.entry===entry),entry);
 const sql=readFileSync(join(f.home,'actual-pg.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(sql.every(row=>row.entry===join(f.home,'gateway','qualify-video.js')));
 assert.ok(sql.some(row=>row.sql.includes("SET process_status = '评论已采'")));
 assert.equal(f.read('phone-state.json').owner,null);
 assert.equal(f.pool.size,1);assert.equal(f.videos.size,2);
 const entries=readFileSync(join(f.home,'actual-entry.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(row=>row.entry?.startsWith(join(f.home,'gateway')));
 assert.ok(entries.length>0);assert.ok(entries.every(row=>row.cwd===realpathSync(join(f.home,'gateway'))),'gateway.cwd必须是所有冻结CLI真实cwd');
});
test('前置检查使用平铺gateway解析pg，仅检查虚构0600凭据/账号/键',async t=>{
 const {preflight}=await import('../gateway-preflight.mjs');
 const home=mkdtempSync(join(tmpdir(),'gateway-preflight-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const directory=join(home,'gateway');mkdirSync(directory);copyFileSync(join(service,'line-routes.js'),join(directory,'line-routes.js'));
 mkdirSync(join(home,'.credentials'));const envFile=join(home,'.credentials/fake.env');
 writeFileSync(envFile,'FEISHU_ACCOUNT=jinoshengyuan\nFEISHU_APP_ID=fake\nFEISHU_APP_SECRET=fake\nOPENROUTER_API_KEY=fake\nDATABASE_URL=postgres://fake:fake@127.0.0.1/fake\n',{mode:0o600});
 assert.throws(()=>preflight({directory,envFile,lineKey:'jinuo'}),/Cannot find module 'pg'/);
 mkdirSync(join(directory,'node_modules/pg'),{recursive:true});writeFileSync(join(directory,'node_modules/pg/index.js'),'exports.Pool=class {};');
 assert.equal(preflight({directory,envFile,lineKey:'jinuo'}).pg_loadable,true);
 writeFileSync(envFile,'FEISHU_ACCOUNT=wrong\n');assert.throws(()=>preflight({directory,envFile,lineKey:'jinuo'}),/account_mismatch/);
});
test('真实共享音频资格分支上传和judge同一host/path，SCP失败保留标题判定',async t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-audio-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const bin=join(home,'bin');mkdirSync(bin);const calls=join(home,'calls');
 const executable=(name,text)=>{const file=join(bin,name);writeFileSync(file,text,{mode:0o700});return file;};
 const ctl=executable('phone',`#!/bin/sh\ncase "$3" in\n record-stop) echo 'record_stopped duration_seconds=30 mean_volume_db=-20';;\n record-extract-audio) echo "audio_extracted path=$HOME/audio.wav";;\nesac\n`);
 executable('scp',`#!/bin/sh\nprintf 'SCP %s\\n' "$*" >> "$HOME/calls"\nexit "\${FAIL_SCP:-0}"\n`);
 executable('ssh',`#!/bin/sh\nprintf 'SSH %s\\n' "$*" >> "$HOME/calls"\ncase "$*" in *discover*) echo 'QUAL_DISCOVER {"status":"pending","has_transcript":false}';; *judge*) echo 'QUAL_RESULT {"verdict":"matched"}';; esac\n`);
 const harness=join(home,'run.zsh');writeFileSync(harness,`setopt extendedglob\nsource ${JSON.stringify(join(service,'harvest-keyword-lib.sh'))}\nqsq(){ print -r -- "'\${1//\\'/\\'\\\\\\'\\'}'"; }\nwf_run_bounded(){ shift; "$@"; }\nlog(){ :; }; nap(){ :; }; activity_should_stop(){ return 1; }\nC=${JSON.stringify(ctl)}; P=fixture; LINE=jinuo; VID=7412345678901234567; VURL=https://fixture; TITLE=fixture; KWTXT=fixture; HBATCH=audio-test; TAG=audio-test; i=1; DUR=00:30; BUDGET=0\nVIDEO_ACTIVITY_MODE=1; QUAL_GATEWAY_HOST=frozen-host; QUAL_GATEWAY_CWD='/tmp/frozen dir'; QUAL_GATEWAY_NODE=/usr/bin/node; QUAL_GATEWAY_ENV_FILE=\nqualify_current_video\n`);
 for(const fail of ['0','1']){
  writeFileSync(calls,'');const out=spawnSync('/bin/zsh',[harness],{env:{HOME:home,PATH:bin+':/usr/bin:/bin',FAIL_SCP:fail},encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/QUAL\t7412345678901234567\tmatched/);
  const log=readFileSync(calls,'utf8');assert.match(log,/SCP .*frozen-host:\/tmp\/qa-audio-test-7412345678901234567.wav/);
  const judge=log.split('\n').find(line=>line.startsWith('SSH')&&line.includes('judge'));
  assert.match(judge,/frozen-host/);assert.ok(judge.includes("'/tmp/frozen dir/qualify-video.js'"));
  assert.equal(judge.includes('/tmp/qa-audio-test-7412345678901234567.wav'),fail==='0');
 }
});
test('未传gateway保留旧默认mmv路径，拒绝继承脏gateway环境',t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-default-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 mkdirSync(join(home,'bin'));writeFileSync(join(home,'bin/ssh'),'#!/bin/sh\nprintf "%s\\n" "$*" > "$HOME/calls"\necho \'QUAL_DISCOVER {"status":"pending"}\'\n',{mode:0o700});
 const code=`source ${JSON.stringify(join(service,'harvest-keyword-lib.sh'))}\nqsq(){ print -r -- "'$1'"; }; wf_run_bounded(){ shift; "$@"; }\nqual_remote discover --line jinuo\n`;
 const result=spawnSync('/bin/zsh',['-c',code],{env:{HOME:home,PATH:join(home,'bin')+':/usr/bin:/bin',QUAL_GATEWAY_HOST:'dirty-host',QUAL_GATEWAY_CWD:'/tmp/dirty'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const call=readFileSync(join(home,'calls'),'utf8');
 assert.match(call,/BatchMode=yes mmv/);assert.match(call,/leadgen-scripts && node qualify-video.js/);assert.ok(!call.includes('dirty'));
});
for(const missing of ['fetch-seen-videos.js','video-delivery-storage.js','workflow-probe.js']){
 test(`真实CLI缺冻结${missing}不回退生产，保留产物并释放锁`,{timeout:60000},async t=>{
  const f=await gatewayFixture(t);if(missing==='workflow-probe.js')f.env.DELETE_PROBE_AFTER_COLLECTION='1';else rmSync(join(f.home,'gateway',missing));
  const result=await f.run();
  if(process.env.GATEWAY_FREEZE_REPORT_DIR)writeFileSync(join(process.env.GATEWAY_FREEZE_REPORT_DIR,missing+'.receipt.json'),JSON.stringify(result.receipt,null,2));
  assert.notEqual(result.receipt.status,'completed');
  assert.equal(f.read('phone-state.json').owner,null);
  assert.equal(result.receipt.outputs.comments.length,missing==='fetch-seen-videos.js'?0:1);
  const calls=readFileSync(join(f.home,'actual-ssh.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.every(call=>call.host==='fixture-gateway'));
  const remote=readFileSync(join(f.home,'actual-remote.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  if(missing==='video-delivery-storage.js') {
    assert.ok(remote.some(row=>row.command.includes('comment-activity.js')&&row.stdout.includes('storage_unavailable')));
    const missingModule=spawnSync(process.execPath,['-e',`require(${JSON.stringify(join(f.home,'gateway',missing))})`],{env:{HOME:f.home,PATH:'/usr/bin:/bin'},encoding:'utf8'});
    assert.match(missingModule.stderr,/MODULE_NOT_FOUND/);
  } else assert.ok(remote.some(row=>row.stderr.includes('MODULE_NOT_FOUND')&&row.command.includes(missing)));
  assert.equal(result.receipt.activities.at(-1).key,'cleanup');assert.equal(result.receipt.activities.at(-1).status,'completed');
  if(process.env.GATEWAY_FREEZE_REPORT_DIR)writeFileSync(join(process.env.GATEWAY_FREEZE_REPORT_DIR,missing+'.negative.json'),JSON.stringify({receipt:result.receipt,remote,pg:f.read('pg.json'),phone:f.read('phone-state.json')},null,2));
 });
}
test('直接配送CLI缺存储依赖在validate之后保留原评论和仅已确认视频，非法input不保留',t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-direct-delivery-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const deploy=readFileSync(join(service,'deploy.sh'),'utf8');
 const files=new RegExp('^DEVICE_NODE_FILES=\\(([\\s\\S]*?)\\)','m').exec(deploy)[1].trim().split(/\s+/);
 for(const file of files){mkdirSync(resolve(home,file,'..'),{recursive:true});copyFileSync(join(service,file),join(home,file));}
 rmSync(join(home,'video-delivery-storage.js'));
 const comment={id:'confirmed',fields:{评论原文:'已采评论'}};
 const video={video_id:'7412345678901234567',title:'已采视频',keyword:'fixture',judgment_status:'matched',collection_receipt:{video_id:'7412345678901234567',batch:'direct',comment_count:1,title:'已采视频',keyword:'fixture',url:'https://v.douyin.com/fixture/'}};
 const request={run_tag:'direct',line_key:'jinuo',comments:[comment],videos:[video,{video_id:'7412345678901234568',judgment_status:'rejected'}]};
 const run=value=>JSON.parse(spawnSync(process.execPath,[join(home,'comment-activity.js'),'raw-delivery'],{env:{HOME:home,PATH:'/usr/bin:/bin'},input:JSON.stringify(value),encoding:'utf8'}).stdout);
 const out=run(request);assert.equal(out.reason_code,'storage_unavailable');assert.equal(out.status,'failed');
 assert.deepEqual(out.outputs.comments,[comment]);assert.deepEqual(out.outputs.pending_comments,[comment]);
 assert.deepEqual(out.outputs.videos,request.videos);assert.deepEqual(out.outputs.pending_videos,[video]);
 const forged=run({...request,videos:[{...video,collection_receipt:{...video.collection_receipt,url:'broken'}}]});assert.deepEqual(forged.outputs.pending_videos,[]);
 const invalid=run({...request,comments:[{...comment,verdict:{grade:'invalid'}}]});assert.equal(invalid.reason_code,'invalid_input');assert.deepEqual(invalid.outputs,{comments:[]});
});
test('旧partial bindings无execution仍兼容；显式gateway变体生成投影逐字节一致',()=>{
 const original=JSON.parse(readFileSync(join(service,'plans/keyword_activities.bindings.json')));
 assert.ok(Object.values(original.activities).every(a=>!Object.hasOwn(a.runtime.input,'execution')));
 const optIn=join(service,'plans/keyword_gateway_activities.bindings.json');
 const compiled=execFileSync(process.execPath,[join(root,'scripts/product-map/wf-plan.mjs'),'keyword_acquisition','--json','--bindings',optIn],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(compiled),JSON.parse(readFileSync(join(service,'plans/keyword_gateway_activities.contract.json'))));
 assert.ok(JSON.parse(compiled).contract.activities.every(a=>a.runtime.input.execution==='$.execution'));
});
test('真实video CLI非法partial网关在手机及remote前拒绝',t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-invalid-cli-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const bin=join(home,'bin');mkdirSync(bin);for(const name of ['ssh','scp','douyin-phone-adb'])writeFileSync(join(bin,name),'#!/bin/sh\necho touched > "$HOME/touched"\nexit 97\n',{mode:0o700});
 for(const gateway of [null,{}, {...input.execution.gateway,node:'node'}, {...input.execution.gateway,cwd:'/tmp/../production'}]){
  const out=spawnSync(process.execPath,[join(service,'video-activity.js'),'qualification'],{env:{HOME:home,PATH:bin+':/usr/bin:/bin',DOUYIN_PHONE_CONTROLLER:join(bin,'douyin-phone-adb')},input:JSON.stringify({...input,execution:{gateway}}),encoding:'utf8'});
  assert.equal(out.status,1);assert.equal(JSON.parse(out.stdout).status,'failed');assert.throws(()=>readFileSync(join(home,'touched')),/ENOENT/);
 }
});
test('显式env_file缺失直接收失败并清理锁，绝不加载旧生产镜像', {timeout:60000},async t=>{
 const f=await gatewayFixture(t);f.input.execution.gateway.env_file=join(f.home,'.credentials','missing.env');
 const result=await f.run();assert.notEqual(result.receipt.status,'completed');assert.equal(f.read('phone-state.json').owner,null);
 const rows=readFileSync(join(f.home,'actual-remote.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(rows.some(r=>r.stderr.includes('missing.env')));assert.ok(rows.every(r=>!r.command.includes('zenithjoy-db.env')));
});
test('直接已评分delivery CLI存储初始化失败保留原comments及pending_comments和既有持久ID',t=>{
 const home=mkdtempSync(join(tmpdir(),'gateway-direct-scored-delivery-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const files=new RegExp('^DEVICE_NODE_FILES=\\(([\\s\\S]*?)\\)','m').exec(readFileSync(join(service,'deploy.sh'),'utf8'))[1].trim().split(/\s+/);
 for(const file of files){mkdirSync(resolve(home,file,'..'),{recursive:true});copyFileSync(join(service,file),join(home,file));}
 rmSync(join(home,'comment-delivery-storage.js'));
 const comment={id:'id-existing',pool_record_id:'id-existing',lead_record_id:'lead-existing',fields:{评论原文:'已评分评论'},verdict:{grade:'A',relevance:'相关',reason:'fixture'}};
 const input={run_tag:'direct-scored',line_key:'jinuo',comments:[comment]};
 const result=spawnSync(process.execPath,[join(home,'comment-activity.js'),'delivery'],{env:{HOME:home,PATH:'/usr/bin:/bin'},input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(result.status,1);const out=JSON.parse(result.stdout);
 assert.equal(out.reason_code,'storage_unavailable');assert.equal(out.failure_class,'retryable');assert.equal(out.status,'failed');
 assert.deepEqual(out.outputs.comments,[comment]);assert.deepEqual(out.outputs.pending_comments,[comment]);
});
