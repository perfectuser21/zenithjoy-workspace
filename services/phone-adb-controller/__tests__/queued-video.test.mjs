import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync,chmodSync,symlinkSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const historyHelper=createRequire(import.meta.url)('../queued-comment-history.js');
const script=path.resolve('services/phone-adb-controller/process-queued-video.sh');
const vid='7646309328911907195';
// 单元测试明确模拟native controller回执，真实原始SHA由实机独立验收核对。
function fakeNativeFields(eid,phase,state='started'){
 const prefix=eid+'-playback-'+phase;return ' playback_proof_kind=native_audio native_audio_state='+state+' native_audio_uid=10203 native_audio_pid=528 native_audio_piid=73615 native_audio_package_uid_verified=true native_audio_foreign_started=0 '+[['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].map(([k,s])=>'native_audio_'+k+'_file='+prefix+'.'+s+' native_audio_'+k+'_sha256='+('a'.repeat(64))).join(' ');
}
function recordedQualification({volume='1',db='-35',startFail=false,playback=true,endState=3}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'qv-record-proof-'));try{
  const ctl=path.join(dir,'ctl'),remote=path.join(dir,'remote');
  writeFileSync(ctl,`#!/bin/zsh
print "$3" >> "$FIXTURE/calls"
case "$3" in
lock-refresh) print 'lock=refreshed';;
current-video-link) print 'content_type=video';print 'video_id=${vid}';;
record-start) ${startFail?'exit 4':`print "record_started media_volume=${volume}${playback?' playback_verified=true playback_package=com.ss.android.ugc.aweme playback_state=1'+fakeNativeFields('$4','start'):''}"`};;
record-stop) print "record_stopped duration_seconds=25.1 mean_volume_db=${db} audio_streams=1 playback_package=com.ss.android.ugc.aweme playback_state=1${fakeNativeFields('$4','end',endState===3?'started':'unknown')}";;
record-extract-audio) print "audio_extracted path=$FIXTURE/record.wav";;
esac
`,{mode:0o755});
  writeFileSync(remote,`#!/bin/zsh\nprint remote >> "$FIXTURE/calls"\nprint 'QUAL_RESULT {"verdict":"matched"}'\n`,{mode:0o755});
  writeFileSync(path.join(dir,'scp'),'#!/bin/zsh\nexit 0\n',{mode:0o755});
  const run='record-proof',runDir=path.join(dir,'run');
  const r=spawnSync('zsh',[script,'qualification','jinoshengyuan-work',vid,'https://www.douyin.com/video/'+vid,Buffer.from('标题').toString('base64'),Buffer.from('AI').toString('base64'),run,'jinuo'],{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,FIXTURE:dir,DOUYIN_PHONE_ADB:ctl,QUEUED_VIDEO_QUALIFY_CMD:remote,WFR_RUN_DIR:runDir,HARVEST_KEYWORD_TESTING:'1'},encoding:'utf8',timeout:7000});
  const proofPath=path.join(runDir,`${run}-recording-${vid}.json`);
  return {...r,calls:readFileSync(path.join(dir,'calls'),'utf8').trim().split('\n'),proof:existsSync(proofPath)?JSON.parse(readFileSync(proofPath)):null};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('实际死寂音轨不得经标题或旧转写回matched，音量回读与音轨事实分别保留',()=>{
 const r=recordedQualification({db:'-91'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/QUAL\t7646309328911907195\trejected\trecording_silent/);assert.ok(!r.calls.includes('remote'));assert.equal(r.proof.media_volume,1);assert.equal(r.proof.mean_volume_db,-91);assert.equal(r.proof.audio_status,'silent');assert.equal(r.proof.run,'record-proof');assert.equal(r.proof.video_id,vid);
});
for(const volume of ['0','unknown',''])test('录前媒体音量必须真实正数，未知或零不能通过 '+JSON.stringify(volume),()=>{
 const r=recordedQualification({volume});assert.equal(r.status,5,r.stderr);assert.ok(!r.calls.includes('remote'));assert.ok(r.calls.includes('record-stop'));assert.equal(r.proof.media_volume_verified,false);
});
test('真实正数媒体音量与有效音轨才能上传判定并留下本VID工件',()=>{
 const r=recordedQualification({volume:'2'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/\tmatched\tjudged/);assert.equal(r.proof.media_volume_verified,true);assert.equal(r.proof.audio_status,'usable');assert.equal(r.proof.version,2);assert.equal(r.proof.playback_state,1);assert.equal(r.proof.native_audio.start.state,'started');assert.equal(r.proof.native_audio.start.uid,10203);assert.equal(r.proof.video_id,vid);assert.ok(r.calls.includes('remote'));
});
test('未知音轨电平或录制启动失败保pending，不能伪静音拒绝或内容matched',()=>{
 for(const opts of [{db:'unknown'},{startFail:true}]){const r=recordedQualification(opts);assert.equal(r.status,5,r.stderr);assert.ok(!r.calls.includes('remote'));assert.ok(!r.stdout.includes('\trejected\t'));assert.ok(!r.stdout.includes('\tmatched\t'));}
});
test('two queued videos in one run each deliver their own recording to qualification',()=>{
 const d=mkdtempSync(path.join(tmpdir(),'queued-multi-audio-'));
 try {
  const ctl=path.join(d,'ctl'), qualify=path.join(d,'qualify'), scp=path.join(d,'scp');
  writeFileSync(ctl,`#!/usr/bin/env node
const fs=require('fs'),p=require('path');const [flag,profile,cmd,...args]=process.argv.slice(2);const d=process.env.FIXTURE;
const active=()=>fs.readFileSync(p.join(d,'active'),'utf8');
fs.appendFileSync(p.join(d,'calls'),JSON.stringify({cmd,args})+'\\n');
switch(cmd){
case 'lock-refresh': console.log('lock=refreshed owner=multi-video-run');break;
case 'open-video':fs.writeFileSync(p.join(d,'active'),args[0]);fs.writeFileSync(p.join(d,args[1]+'.xml'),args[0]);break;
case 'current-video-link':fs.writeFileSync(p.join(d,args[0]+'.xml'),active());console.log('content_type=video\\nvideo_id='+active());break;
case 'open-comments':console.log('reason=no_comments_on_this_video');break;
case 'record-start':try{fs.writeFileSync(p.join(d,args[0]+'.mkv'),active(),{flag:'wx'});}catch{console.error('recording artifact already exists');process.exit(1);}console.log('record_started media_volume=1 playback_verified=true playback_package=com.ss.android.ugc.aweme playback_state=1'+(${fakeNativeFields.toString()})(args[0],'start'));break;
case 'record-stop':console.log('record_stopped duration_seconds=25.1 mean_volume_db=-35 audio_streams=1 playback_package=com.ss.android.ugc.aweme playback_state=1'+(${fakeNativeFields.toString()})(args[0],'end'));break;
case 'record-extract-audio':{
 const wav=p.join(d,args[0]+'.wav');fs.writeFileSync(wav,fs.readFileSync(p.join(d,args[0]+'.mkv')),{flag:'wx'});console.log('audio_extracted path='+wav);break;}
}
`,{mode:0o755});
  writeFileSync(scp,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),a=process.argv.slice(2);
fs.copyFileSync(a.at(-2),p.join(process.env.FIXTURE,p.basename(a.at(-1))));
`,{mode:0o755});
  writeFileSync(qualify,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),a=process.argv.slice(2),i=a.indexOf('--audio'),v=a[a.indexOf('--video-id')+1];
const audio=i<0?null:fs.readFileSync(p.join(process.env.FIXTURE,p.basename(a[i+1])),'utf8');
fs.appendFileSync(p.join(process.env.FIXTURE,'judgments'),JSON.stringify({video_id:v,audio})+'\\n');
console.log('QUAL_RESULT {"verdict":"matched"}');
`,{mode:0o755});
  const videos=[vid,'7646309328911907196'];
  for(const id of videos)for(const mode of ['identity','qualification','collection']){
   const r=spawnSync('zsh',[script,mode,'jinoshengyuan-work',id,`https://www.douyin.com/video/${id}`,Buffer.from('测试视频').toString('base64'),Buffer.from('人工智能训练师').toString('base64'),'multi-video-run','金诺盛源'],{env:{...process.env,PATH:d+path.delimiter+process.env.PATH,FIXTURE:d,DOUYIN_PHONE_ADB:ctl,QUEUED_VIDEO_QUALIFY_CMD:qualify,HARVEST_KEYWORD_TESTING:'1',WFR_RUN_DIR:path.join(d,'run')},encoding:'utf8',timeout:7000});
   assert.equal(r.status,0,r.stderr);
  }
  const judgments=readFileSync(path.join(d,'judgments'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(judgments,videos.map(video_id=>({video_id,audio:video_id})), 'each model call must receive audio from its actual video');
  const calls=readFileSync(path.join(d,'calls'),'utf8').trim().split('\n').map(JSON.parse);
  const starts=calls.filter(c=>c.cmd==='record-start').map(c=>c.args[0]);
  assert.equal(new Set(starts).size,2,'recording artifacts cannot share an ID');
  for(const cmd of ['record-stop','record-extract-audio'])assert.deepEqual(calls.filter(c=>c.cmd===cmd).map(c=>c.args[0]),starts);
  assert.deepEqual(calls.filter(c=>c.cmd==='lock-refresh').map(c=>c.args[0]),Array(6).fill('multi-video-run'),'video-specific evidence must preserve run lock ownership');
  for(const id of videos)for(const mode of ['identity','qualification','collection'])for(const step of ['open','identity']){
   assert.equal(readFileSync(path.join(d,`multi-video-run-v${id}-${mode}-${step}.xml`),'utf8'),id,'VID/MODE证据必须独立并保留原字节');
  }
  for(const id of videos){const proof=JSON.parse(readFileSync(path.join(d,'run',`multi-video-run-identity-${id}.json`)));assert.equal(proof.evidence_id,`multi-video-run-v${id}-collection-identity`);assert.equal(proof.observed_video_id,id);assert.equal(proof.verified,true);}
  for(const eid of starts)assert.ok(existsSync(path.join(d,eid+'.mkv')),'prior evidence stays intact');
 } finally {rmSync(d,{recursive:true,force:true});}
});
function run(mode,extra={}) {
 const d=mkdtempSync(path.join(tmpdir(),'queued-video-'));
 const ctl=path.join(d,'ctl'); const log=path.join(d,'calls');
 writeFileSync(ctl,`#!/bin/zsh
print -r -- "$3" >> "$CALLS"
print -r -- "$3|\${DOUYIN_DETAIL_PLAYBACK:-standard}|$4|$5" >> "$STRATEGIES"
case "$3" in
 lock-refresh) [[ -z "$LOCK_FAIL" ]] || exit 3;print 'lock=refreshed owner=cmd100822-new';;
 open-video) if [[ -n "$AFTER_CARD_OPEN_FAIL" && "$5" == *after-card* ]];then exit 4;fi;rm -f "$CARD_STATE"; print 'video_id=${vid}';;
 current-video-link) if [[ "$4" == *after-card* ]];then [[ -z "$AFTER_CARD_LINK_FAIL" ]] || exit 1;[[ -z "$AFTER_CARD_NOTE" ]] || export CONTENT_TYPE=note;fi;if [[ -f "$CARD_STATE" ]];then print -u2 'NOT_ON_VIDEO_DETAIL';exit 1;fi;print "content_type=\${CONTENT_TYPE:-video}";if [[ -n "$DRIFT_AFTER_CARD" && "$(grep -c '^current-video-link$' "$CALLS")" -gt 1 ]]; then print 'video_id=7646309328911907196';else print "video_id=\${OBSERVED_ID:-${vid}}";fi;;
 open-comments) if [[ "$4" == *after-card* && -n "$AFTER_CARD_COMMENTS_FAIL" ]];then exit 6;fi;if [[ -n "$NO_COMMENTS" ]]; then print 'reason=no_comments_on_this_video'; else print 'comments_opened=1'; print "comment_count=\${FIXTURE_COMMENT_COUNT:-1}"; fi;;
 collect-comments) if [[ -n "$CLIPPED_FIRST" ]];then
if [[ "$4" == *rescan* && -n "$CLIPPED_COLLECT_FAIL" ]];then exit 2;fi
if [[ "$4" == *rescan* && -n "$CLIPPED_NOT_FOUND" ]];then print 'exhausted=0';exit 0;fi
if [[ "$4" == *rescan* && -n "$CLIPPED_RECOVERS" ]];then xy='700 800';else xy=' ';fi
if [[ "$(grep -c '^commenter-identity$' "$CALLS")" -eq 0 ]];then print "甲\\t裁切评论\\t今天\\t北京\\treader\\ttap=$xy\\tb64=55Sy";fi
print "甲\\t可操作评论\\t今天\\t北京\\treader\\ttap=900 1000\\tb64=55Sy";print 'exhausted=1';exit 0;fi;if [[ -n "$DEREGISTERED_FIRST" ]];then if [[ "$(grep -c '^commenter-identity$' "$CALLS")" -eq 0 ]];then print "甲\\t注销候选\\t今天\\t北京\\treader\\ttap=100 200\\tb64=55Sy";fi;for j in {1..5};do print "甲\\t合法$j\\t今天\\t北京\\treader\\ttap=900 $((300+j))\\tb64=55Sy";done;print 'exhausted=1';exit 0;fi;if [[ -n "$BULK_NEW" ]];then for j in {1..8};do print "甲\\t新评论$j\\t今天\\t北京\\treader\\ttap=100 $((200+j))\\tb64=55Sy";done;print 'exhausted=1';exit 0;fi;if [[ -n "$REORDER_AFTER_HISTORY" ]];then if [[ "$(grep -c '^commenter-identity$' "$CALLS")" -gt 0 ]];then xy=900;else xy=300;fi;print "甲\\t咨询价格\\t今天\\t北京\\treader\\ttap=100 200\\tb64=55Sy";print "乙\\t新咨询\\t今天\\t北京\\treader\\ttap=$xy 200\\tb64=5LmZ";print 'exhausted=1';exit 0;fi;if [[ -n "$BULK_HISTORY" ]];then for j in {1..51};do print "甲\\t历史$j\\t今天\\t北京\\treader\\ttap=100 $((200+j))\\tb64=55Sy";done;print 'exhausted=1';exit 0;fi;n=100;if [[ -n "$RELOCATE" && "$(grep -c '^collect-comments$' "$CALLS")" -gt 1 ]];then n=300;fi;print "甲\\t咨询价格\\t今天\\t北京\\treader\\ttap=$n 200\\tb64=55Sy"; if [[ -n "$NEXT_NEW_ROW" ]];then print '甲\\t新咨询\\t今天\\t北京\\treader\\ttap=300 200\\tb64=55Sy';fi;print 'exhausted=1';;
 commenter-identity) print "$4 $5" >> "$CALLS_COORD";if [[ -n "$DEREGISTERED_FIRST" && "$4" == 100 ]];then print 'nickname=甲';print 'douyin_id=';print 'profile_status=unavailable';print 'unavailable_reason=account_deregistered';print "profile_evidence=$DEREGISTERED_ROOT/$7-profile.xml";print "return_evidence=$DEREGISTERED_ROOT/$7-returned.xml";print "comment_evidence=$DEREGISTERED_ROOT/$7-comments.xml";for suffix in comments returned;do print '<hierarchy><node package="com.ss.android.ugc.aweme" text="4条评论"/><node package="com.ss.android.ugc.aweme" content-desc="放大评论区"/><node package="com.ss.android.ugc.aweme" content-desc="关闭"/></hierarchy>' > "$DEREGISTERED_ROOT/$7-$suffix.xml";done;print '<hierarchy><node package="com.ss.android.ugc.aweme" text="甲" resource-id="com.ss.android.ugc.aweme:id/tj1" content-desc="甲，复制名字和修改备注"/><node package="com.ss.android.ugc.aweme" text="暂无作品"/><node package="com.ss.android.ugc.aweme" text="账号已经注销"/></hierarchy>' > "$DEREGISTERED_ROOT/$7-profile.xml";exit 0;fi;[[ -z "$IDENTITY_FAIL" ]] || exit 1;if [[ -n "$RELOCATE" && "$(grep -c '^commenter-identity$' "$CALLS")" -eq 1 ]];then exit 1;fi;if [[ -n "$REORDER_AFTER_HISTORY" && "$4" != 100 ]];then if [[ "$4" == 900 ]];then print 'nickname=乙';else print 'nickname=错位';fi;print 'douyin_id=person999';else print 'nickname=甲';[[ -n "$UNKNOWN_OID" ]] || print 'douyin_id=person123';fi;print 'account_type=personal';if [[ -n "$QUEUED_COMMENT_HISTORY_FILE" ]];then mkdir -p "$DOUYIN_PHONE_TMP_ROOT/evidence/jinoshengyuan-work";pf="$DOUYIN_PHONE_TMP_ROOT/evidence/jinoshengyuan-work/$7-profile.xml";rf="$DOUYIN_PHONE_TMP_ROOT/evidence/jinoshengyuan-work/$7-returned.xml";print '<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：person123" /></hierarchy>' > "$pf";print '<hierarchy><node package="com.ss.android.ugc.aweme" text="评论 1" /><node package="com.ss.android.ugc.aweme" class="android.widget.EditText" text="发条评论" /></hierarchy>' > "$rf";print "profile_evidence=$pf";print "return_evidence=$rf";fi;;
 commenter-card-link) [[ -z "$CARD_RETURNS_OFF_DETAIL" ]] || touch "$CARD_STATE";print 'profile_url=https://www.douyin.com/user/a';;
 record-start) print "record_started media_volume=1 playback_verified=true playback_package=com.ss.android.ugc.aweme playback_state=1${fakeNativeFields('$4','start')}";;
 record-stop) print "record_stopped duration_seconds=25.1 mean_volume_db=-35 audio_streams=1 playback_package=com.ss.android.ugc.aweme playback_state=1${fakeNativeFields('$4','end')}";;
 record-extract-audio) print "audio_extracted path=$FIXTURE_AUDIO";;
 *) ;;
esac
`,{mode:0o755});
 const qualify=path.join(d,'qualify');
 writeFileSync(path.join(d,'scp'),'#!/bin/zsh\nexit 0\n',{mode:0o755});
 writeFileSync(qualify,`#!/bin/zsh
print -r -- "remote-$1" >> "$CALLS"
if [[ -n "$MODEL_HANG" ]]; then sleep 30; fi
print 'QUAL_RESULT {"verdict":"pending","kind":"api_error"}'
`,{mode:0o755});
 const own=path.join(d,'own.json');
 writeFileSync(own,JSON.stringify({nicknames:extra.OWN_NICK?['甲']:[],ids:[]}));
 const coords=path.join(d,'coords');
 const evidence=path.join(d,'run');
 const historyPath=path.join(evidence,'history-'+vid+'.json');
 if(extra.HISTORY){requireHistoryDir();writeFileSync(historyPath,JSON.stringify({version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'cmd100822-new',source_run:'source101',video_id:vid,video_url:'https://www.douyin.com/video/'+vid,observed_at:new Date().toISOString(),rows:[{id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'咨询价格'}],...extra.HISTORY}),{mode:0o600});}
 function requireHistoryDir(){mkdirSync(evidence,{recursive:true});}
 if(extra.DEREGISTERED_PROOF_EXISTS){mkdirSync(evidence,{recursive:true});writeFileSync(path.join(evidence,'cmd100822-new-v'+vid+'-collection-person1-t1-unavailable.json'),'old-proof',{mode:0o600});}
 const deregRoot=path.join(d,'phone','evidence','jinoshengyuan-work');if(extra.DEREGISTERED_FIRST)mkdirSync(deregRoot,{recursive:true});
 const r=spawnSync('zsh',[script,mode,'jinoshengyuan-work',vid,`https://www.douyin.com/video/${vid}`,Buffer.from('测试视频').toString('base64'),Buffer.from('人工智能训练师').toString('base64'),'cmd100822-new',extra.HISTORY?'jinuo':'金诺盛源'],{env:{...process.env,PATH:d+path.delimiter+process.env.PATH,FIXTURE_AUDIO:path.join(d,'audio.wav'),DOUYIN_PHONE_ADB:ctl,CALLS:log,STRATEGIES:path.join(d,'strategies'),CALLS_COORD:coords,CARD_STATE:path.join(d,'off-detail'),WFR_RUN_DIR:evidence,HARVEST_KEYWORD_TESTING:'1',QUEUED_VIDEO_QUALIFY_CMD:qualify,OWN_ACCOUNTS_CONF:own,DEREGISTERED_ROOT:deregRoot,...extra,...(extra.DEREGISTERED_FIRST?{DOUYIN_PHONE_TMP_ROOT:path.join(d,'phone')}:{ }),...(extra.HISTORY?{LEADGEN_SOURCE_RUN:'source101',QUEUED_COMMENT_HISTORY_FILE:historyPath,DOUYIN_PHONE_TMP_ROOT:path.join(d,'phone')}:{})},encoding:'utf8',timeout:extra.FIXTURE_TIMEOUT_MS||7000});
 const calls=existsSync(log)?readFileSync(log,'utf8').trim().split('\n'):[];
 const coordinates=existsSync(coords)?readFileSync(coords,'utf8').trim().split('\n'):[];
 const receipt=path.join(evidence,`cmd100822-new-identity-${vid}.json`);
 const identity=existsSync(receipt)?JSON.parse(readFileSync(receipt,'utf8')):null;
 const strategies=existsSync(path.join(d,'strategies'))?readFileSync(path.join(d,'strategies'),'utf8').trim().split('\n').map(line=>line.split('|')):[];
 rmSync(d,{recursive:true,force:true}); return {...r,calls,coordinates,identity,strategies};
}
test('queued collection deep-opens and independently verifies identity before comments',()=>{
 const r=run('collection');assert.equal(r.status,0,r.stderr);
 assert.ok(r.stdout.includes('LEAD\t甲\tperson123\tpersonal\t咨询价格'));
 assert.equal(r.stdout.split('\n').find(line=>line.startsWith('LEAD\t')).split('\t')[10],'https://www.douyin.com/user/a');
 assert.deepEqual(r.calls.slice(0,4),['lock-refresh','open-video','current-video-link','open-comments']);
 assert.ok(!r.calls.some(c=>c.startsWith('lock-acquire')||c==='lock-release'));
});
test('echoed expected open-video id cannot conceal actual wrong target',()=>{
 const r=run('collection',{OBSERVED_ID:'7646309328911907196'});assert.notEqual(r.status,0);
 assert.ok(!r.calls.includes('open-comments'));assert.ok(!r.stdout.includes('LEAD'));
 assert.equal(r.identity.verified,false);assert.equal(r.identity.observed_video_id,'7646309328911907196');
});
test('identity artifact preserves actual controller output and excludes non-video content',()=>{
 const good=run('collection');assert.equal(good.identity.verified,true);assert.equal(good.identity.expected_video_id,good.identity.observed_video_id);
 assert.match(good.identity.controller_stdout,/content_type=video/);
 const note=run('collection',{CONTENT_TYPE:'note'});assert.equal(note.status,4);assert.equal(note.identity.verified,false);assert.ok(!note.calls.includes('open-comments'));
});
test('cached matched identity mode verifies real target without recording or judging again',()=>{
 const r=run('identity');assert.equal(r.status,0,r.stderr);assert.equal(r.identity.verified,true);
 assert.match(r.stdout,/IDENTITY\t7646309328911907195\tverified/);
 assert.deepEqual(r.calls,['lock-refresh','open-video','current-video-link']);
 const bad=run('identity',{OBSERVED_ID:'7646309328911907196'});assert.equal(bad.status,4);assert.equal(bad.identity.verified,false);
 assert.ok(!bad.stdout.includes('IDENTITY'));
});
test('zero comments is a normal explicit outcome, with no retry or collected write',()=>{
 const r=run('collection',{NO_COMMENTS:'1'});assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/COLLECTION\t7646309328911907195\tno_comments\t0/);
 assert.equal(r.calls.filter(c=>c==='open-comments').length,1);
});
test('caller must own an existing lock before any phone navigation',()=>{
 const r=run('collection',{LOCK_FAIL:'1'});assert.equal(r.status,3);
 assert.deepEqual(r.calls,['lock-refresh']);
});
test('own accounts never become leads',()=>{
 const r=run('collection',{OWN_NICK:'1'});assert.equal(r.status,0,r.stderr);
 assert.ok(!r.stdout.includes('LEAD'));assert.ok(!r.calls.includes('commenter-identity'));
});
test('identity retry rescans current screen rather than blindly reusing coordinates',()=>{
 const r=run('collection',{IDENTITY_FAIL:'1'});assert.equal(r.status,6,r.stderr);
 const first=r.calls.indexOf('commenter-identity');
 assert.deepEqual(r.calls.slice(first+1,first+6),['back','current-video-link','open-comments','collect-comments','commenter-identity']);
 assert.ok(!r.stdout.includes('LEAD'));
});
test('identity retry uses newly observed coordinates after page reorder',()=>{
 const r=run('collection',{RELOCATE:'1'});assert.equal(r.status,0,r.stderr);
 assert.deepEqual(r.coordinates.slice(0,2),['100 200','300 200']);
 assert.equal(r.stdout.split('\n').filter(s=>s.startsWith('LEAD\t')).length,1);
 assert.match(r.stdout,/RESCAN\t7646309328911907195\t1/);
});
test('card recovery drift is rejected before attributing comments to queued video',()=>{
 const r=run('collection',{DRIFT_AFTER_CARD:'1'});assert.equal(r.status,4,r.stderr);
 assert.ok(!r.stdout.includes('LEAD'));assert.ok(!r.stdout.includes('COLLECTION'));
 assert.equal(r.identity.verified,false,'drift overwrites initial verified receipt');
});
test('card link return outside detail reopens and verifies the actual queued video before emitting a lead',()=>{
 const r=run('collection',{CARD_RETURNS_OFF_DETAIL:'1'});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.identity.verified,true);
 assert.equal(r.stdout.split('\n').filter(s=>s.startsWith('LEAD\t')).length,1);
});
test('model error remains pending and never starts comment collection',()=>{
 const r=run('qualification');assert.equal(r.status,5,r.stderr);
 assert.match(r.stdout,/QUAL\t7646309328911907195\tpending\tjudged/);
 assert.ok(!r.calls.includes('open-comments'));
});
test('remote model stall has an absolute execution deadline',()=>{
 const t=Date.now();const r=run('qualification',{MODEL_HANG:'1',QUEUED_VIDEO_REMOTE_SECONDS:'1',WF_BOUNDED_POLL:'0.1'});
 assert.equal(r.status,5,r.stderr);assert.ok(Date.now()-t<5000);
 assert.match(r.stdout,/\tpending\tjudged/);
});

test('after-card paired identity stays paused locally and restores comments before the only lead',()=>{
 const r=run('collection',{CARD_RETURNS_OFF_DETAIL:'1'});assert.equal(r.status,0,r.stderr);
 const pair=r.strategies.filter(row=>row.some(value=>value.includes('after-card')));
 assert.deepEqual(pair.map(row=>row.slice(0,2)),[['open-video','continuous_identity'],['current-video-link','continuous_identity'],['open-comments','standard']]);
 assert.equal(r.stdout.split('\n').filter(line=>line.startsWith('LEAD\t')).length,1);
 for(const row of r.strategies)if(!['open-video','current-video-link'].includes(row[0]))assert.equal(row[1],'standard',row.join('|'));
});
test('after-card failures never emit leads or continue through an unverified page',()=>{
 for(const [flag,exit] of [['AFTER_CARD_OPEN_FAIL',4],['AFTER_CARD_LINK_FAIL',4],['AFTER_CARD_NOTE',4],['AFTER_CARD_COMMENTS_FAIL',6]]){
  const r=run('collection',{[flag]:'1'});assert.equal(r.status,exit,flag+': '+r.stderr);
  assert.ok(!r.stdout.includes('LEAD\t'),flag);assert.ok(!r.stdout.includes('COLLECTION\t'),flag);
  const after=r.strategies.filter(row=>row.some(value=>value.includes('after-card')));
  assert.deepEqual(after.map(row=>row[0]),flag==='AFTER_CARD_OPEN_FAIL'?['open-video']:flag==='AFTER_CARD_COMMENTS_FAIL'?['open-video','current-video-link','open-comments']:['open-video','current-video-link']);
 }
});
test('standalone comment relocation retains its default identity strategy',()=>{
 const r=run('collection',{RELOCATE:'1'});assert.equal(r.status,0,r.stderr);
 const back=r.strategies.findIndex(row=>row[0]==='back');assert.ok(back>=0);
 assert.deepEqual(r.strategies[back+1].slice(0,2),['current-video-link','standard']);
});

test('所有评论恢复证据按VID和MODE隔离，锁与最新proof仍按原run归属',()=>{
 const r=run('collection',{RELOCATE:'1'});assert.equal(r.status,0,r.stderr);
 assert.equal(r.identity.evidence_id,`cmd100822-new-v${vid}-collection-after-card1`);
 const commands=['open-video','current-video-link','open-comments','collect-comments'];
 for(const row of r.strategies)if(commands.includes(row[0]))assert.ok(row.slice(2).some(s=>s.startsWith(`cmd100822-new-v${vid}-collection-`)),row.join('|'));
 const locks=r.strategies.filter(row=>row[0]==='lock-refresh');assert.ok(locks.every(row=>row[2]==='cmd100822-new'));
});

test('可信同VID OID完整正文历史在新鲜identity后免card与aftercard，不输出假新LEAD',()=>{
 const r=run('collection',{HISTORY:{}});assert.equal(r.status,0,r.stderr);
 assert.doesNotMatch(r.stdout,/LEAD\t/);assert.match(r.stdout,/HISTORY\t/);
 assert.ok(r.calls.includes('commenter-identity'));assert.ok(!r.calls.includes('commenter-card-link'));
 assert.equal(r.calls.filter(x=>x==='current-video-link').length,1);
 assert.match(r.stdout,/collected\t0/);
});

test('历史完整匹配仍继续处理新评论；unknown/异OID/异全文不能skip',()=>{
 const continued=run('collection',{HISTORY:{},NEXT_NEW_ROW:'1'});assert.equal(continued.status,0,continued.stderr);
 assert.equal(continued.stdout.split('\n').filter(l=>l.startsWith('HISTORY\t')).length,1);
 assert.equal(continued.stdout.split('\n').filter(l=>l.startsWith('LEAD\t')).length,1);assert.match(continued.stdout,/新咨询/);
 for(const HISTORY of [{status:'unknown',rows:[]},{rows:[{id:'11111111-1111-4111-8111-111111111111',douyin_id:'person1234',comment_body:'咨询价格'}]},{rows:[{id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'咨询价格后续不同正文'}]}]){
  const r=run('collection',{HISTORY});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/LEAD\t/);assert.doesNotMatch(r.stdout,/HISTORY\t/);assert.ok(r.calls.includes('commenter-card-link'));
 }
});
test('历史错误VID/run/source/line或schema在任何手机动作前拒绝',()=>{
 for(const HISTORY of [{video_id:'7646309328911907196'},{run:'other'},{source_run:'other101'},{line:'yuesheng'},{version:9},{status:'unknown'}]){
  const r=run('collection',{HISTORY});assert.equal(r.status,8,r.stderr);assert.equal(r.calls.length,0);assert.doesNotMatch(r.stdout,/LEAD\t|HISTORY\t/);
 }
});
test('历史命中新鲜identity失败不能输出历史成功或LEAD',()=>{
 const r=run('collection',{HISTORY:{},IDENTITY_FAIL:'1'});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/LEAD\t|HISTORY\t/);assert.ok(!r.calls.includes('commenter-card-link'));
});
test('历史RAW证据必须是新鲜真实profile OID及评论面板，拒前缀/标题/错误包/软链/旧树',()=>{
 const d=mkdtempSync(path.join(tmpdir(),'history-proof-')),eid='run-v7646309328911907195-collection-person1-t1',saved=process.env.DOUYIN_PHONE_TMP_ROOT;
 const scope={line:'jinuo',run:'run',source_run:'source101',video_id:vid,video_url:'https://www.douyin.com/video/'+vid},id='11111111-1111-4111-8111-111111111111';
 try{
  process.env.DOUYIN_PHONE_TMP_ROOT=d;const dir=path.join(d,'evidence','work');mkdirSync(dir,{recursive:true});
  const file=path.join(d,'history.json');writeFileSync(file,JSON.stringify({version:1,status:'verified',line_key:'jinuo',...scope,rows:[{id,douyin_id:'person123',comment_body:'咨询价格'}]}),{mode:0o600});
  const h=historyHelper.load(file,d,scope),p=path.join(dir,eid+'-profile.xml'),r=path.join(dir,eid+'-returned.xml');
  const profile='<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：person123" /></hierarchy>',panel='<hierarchy><node package="com.ss.android.ugc.aweme" text="评论 1" /><node package="com.ss.android.ugc.aweme" class="android.widget.EditText" text="发条评论" /></hierarchy>';
  const call=()=>historyHelper.proof(h,d,'work',eid,id,'person123','咨询价格',p,r,1);
  writeFileSync(p,profile);writeFileSync(r,panel);assert.equal(call().verified,true);
  for(const [pp,rr] of [[profile.replace('person123','person1234'),panel],[profile,'<hierarchy><node package="com.ss.android.ugc.aweme" text="详情介绍评论" /></hierarchy>'],[profile,panel.replaceAll('com.ss.android.ugc.aweme','evil.package')],[profile,panel.slice(0,-12)]]){writeFileSync(p,pp);writeFileSync(r,rr);assert.throws(call);}
  writeFileSync(p,profile);writeFileSync(r,panel);utimesSync(r,0,0);assert.throws(call);
  rmSync(r);const outside=path.join(d,'outside.xml');writeFileSync(outside,panel);symlinkSync(outside,r);assert.throws(call);
  chmodSync(file,0o644);assert.throws(()=>historyHelper.load(file,d,scope));
 }finally{if(saved===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=saved;rmSync(d,{recursive:true,force:true});}
});
test('large历史和新累计50，medium仍全采而非历史50后截断',()=>{
 const rows=Array.from({length:50},(_,i)=>({id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),douyin_id:'person123',comment_body:'历史'+(i+1)}));
 for(const [count,expectedNew] of [['101',0],['80',1]]){
  const r=run('collection',{HISTORY:{rows},BULK_HISTORY:'1',FIXTURE_COMMENT_COUNT:count,FIXTURE_TIMEOUT_MS:60000});assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('HISTORY\t')).length,50);
  assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('LEAD\t')).length,expectedNew);
  assert.equal(r.calls.filter(c=>c==='commenter-card-link').length,expectedNew);
 }
});

test('历史身份返回评论重排后先重新collect，绝不点击上一屏下一条旧坐标',()=>{
 const r=run('collection',{HISTORY:{},REORDER_AFTER_HISTORY:'1'});assert.equal(r.status,0,r.stderr);
 assert.deepEqual(r.coordinates,['100 200','900 200']);assert.match(r.stdout,/LEAD\t乙\tperson999/);
 assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('HISTORY\t')).length,1);
});

for(const tier of ['68','1000'])test('显式5评论配额对medium与large实际生效 '+tier,()=>{
 const r=run('collection',{BULK_NEW:'1',FIXTURE_COMMENT_COUNT:tier,LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('LEAD\t')).length,5);assert.match(r.stdout,/COLLECTION\t7646309328911907195\tsampled\t5\t5\t5/);assert.equal(r.calls.filter(x=>x==='commenter-identity').length,5);
});
for(const value of ['0','-1','abc','51','1.5',''])test('非法采样值任何手机动作前拒绝 '+JSON.stringify(value),()=>{const r=run('collection',{LEADGEN_COMMENT_LIMIT:value,LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,2,r.stderr);assert.equal(r.calls.length,0);});
test('显式采样必须绑定受信来源run，不能零配置冒充5配额',()=>{const r=run('collection',{LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:''});assert.equal(r.status,2);assert.equal(r.calls.length,0);});
test('历史+新评论共享显式配额，历史0新增不变假LEAD',()=>{const r=run('collection',{HISTORY:{},NEXT_NEW_ROW:'1',LEADGEN_COMMENT_LIMIT:'2'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('HISTORY\t')).length,1);assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('LEAD\t')).length,1);assert.match(r.stdout,/sampled\t1\t2\t2/);});
test('自家评论不充采样配额，不得输出采样5达标',()=>{const r=run('collection',{OWN_NICK:'1',BULK_NEW:'1',LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/sampled\t|LEAD\t/);});
test('显式5条历史配额所有tiers只核5历史，不伪新评论或评分样本',()=>{
 const rows=Array.from({length:50},(_,i)=>({id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),douyin_id:'person123',comment_body:'历史'+(i+1)}));
 for(const count of ['80','1000']){
  const r=run('collection',{HISTORY:{rows},BULK_HISTORY:'1',FIXTURE_COMMENT_COUNT:count,FIXTURE_TIMEOUT_MS:60000,LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('HISTORY\t')).length,5);assert.equal(r.stdout.split('\n').filter(l=>l.startsWith('LEAD\t')).length,0);assert.match(r.stdout,/COLLECTION\t\d+\tsampled\t0\t5\t5/);assert.equal(r.calls.filter(c=>c==='commenter-card-link').length,0);
 }
});

test('注销候选不毒死采样，重读树后5真实评论才满足配额',()=>{
 const r=run('collection',{DEREGISTERED_FIRST:'1',LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/COMMENT_SKIP\t7646309328911907195\taccount_deregistered/);assert.match(r.stdout,/COLLECTION\t7646309328911907195\tsampled\t5\t5\t5/);assert.equal(r.stdout.split('\n').filter(x=>x.startsWith('LEAD\t')).length,5);assert.deepEqual(r.coordinates.slice(0,2),['100 200','900 301']);assert.equal(r.calls.filter(x=>x==='commenter-card-link').length,5);assert.ok(r.calls.indexOf('collect-comments',r.calls.indexOf('commenter-identity')+1)<r.calls.indexOf('tap-evidence'));
});

test('未知OID缺失仍code6，不能泛化接受缓冲或配额',()=>{const r=run('collection',{UNKNOWN_OID:'1'});assert.equal(r.status,6,r.stderr);assert.match(r.stderr,/douyin_id_missing/);assert.doesNotMatch(r.stdout,/LEAD\t|COMMENT_SKIP\t|sampled\t/);});

test('注销skip证据不得覆盖旧文件，写入失败不发布skip或伪造配额',()=>{const r=run('collection',{DEREGISTERED_FIRST:'1',DEREGISTERED_PROOF_EXISTS:'1',LEADGEN_COMMENT_LIMIT:'5',LEADGEN_SOURCE_RUN:'source101'});assert.equal(r.status,6,r.stderr);assert.doesNotMatch(r.stdout,/COMMENT_SKIP\t|LEAD\t|sampled\t/);});

test('暂停/未知播放的死寂音轨保持pending，不能永久拒绝视频',()=>{
 const r=recordedQualification({db:'-91',playback:false});
 assert.equal(r.status,5,r.stderr);assert.match(r.stdout,/\tpending\t/);
 assert.doesNotMatch(r.stdout,/\trejected\t/);assert.ok(!r.calls.includes('remote'));
 assert.equal(r.proof.playback_verified,false);
});

test('录前已播放但录后暂停或未知时，静音仍保pending且禁止模型判定',()=>{
 for(const endState of [2,'unknown']){const r=recordedQualification({db:'-91',endState});assert.equal(r.status,5,r.stderr);assert.match(r.stdout,/\tpending\tplayback_unverified/);assert.ok(!r.calls.includes('remote'));assert.equal(r.proof.playback_verified,false);}
});

test('空头像坐标先有界重取新树，成功后只能点新坐标',()=>{
 const r=run('collection',{CLIPPED_FIRST:'1',CLIPPED_RECOVERS:'1'});assert.equal(r.status,0,r.stderr);assert.equal(r.coordinates[0],'700 800');assert.match(r.stdout,/LEAD\t甲\tperson123\tpersonal\t裁切评论/);assert.ok(!r.stdout.includes('COMMENT_SKIP'));assert.equal(r.calls.filter(c=>c==='back').length,1);
});
for(const extra of [{},{CLIPPED_NOT_FOUND:'1'}])test('重取证后仍缺头像候选明确跳过，不计配额且下一候选重读 '+JSON.stringify(extra),()=>{
 const r=run('collection',{CLIPPED_FIRST:'1',LEADGEN_COMMENT_LIMIT:'1',...extra});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/COMMENT_SKIP\t7646309328911907195\tavatar_unavailable/);assert.equal(r.stdout.split('LEAD\t').length-1,1);assert.ok(!r.stdout.includes('personal\t裁切评论'));assert.match(r.stdout,/COLLECTION\t7646309328911907195\tsampled\t1\t1\t1/);assert.deepEqual(r.coordinates,['900 1000']);assert.equal(r.calls.filter(c=>c==='back').length,1);assert.ok(r.calls.filter(c=>c==='collect-comments').length>=3);
});
test('空tap恢复读树故障不得伪装成候选跳过',()=>{
 const r=run('collection',{CLIPPED_FIRST:'1',CLIPPED_COLLECT_FAIL:'1'});assert.equal(r.status,6,r.stderr);assert.ok(!r.stdout.includes('COMMENT_SKIP'));assert.ok(!r.stdout.includes('LEAD'));assert.equal(r.calls.filter(c=>c==='back').length,1);
});
test('有正常坐标的真实身份失败仍严格失败，不作为裁切跳过',()=>{
 const r=run('collection',{IDENTITY_FAIL:'1'});assert.equal(r.status,6,r.stderr);assert.ok(!r.stdout.includes('COMMENT_SKIP'));assert.ok(!r.stdout.includes('LEAD'));
});
