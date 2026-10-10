import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('services/phone-adb-controller/process-queued-video.sh');
const vid='7646309328911907195';
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
case 'record-start':try{fs.writeFileSync(p.join(d,args[0]+'.mkv'),active(),{flag:'wx'});}catch{console.error('recording artifact already exists');process.exit(1);}break;
case 'record-stop':console.log('record_stopped duration_seconds=25.1 mean_volume_db=-35 audio_streams=1');break;
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
 open-comments) if [[ "$4" == *after-card* && -n "$AFTER_CARD_COMMENTS_FAIL" ]];then exit 6;fi;if [[ -n "$NO_COMMENTS" ]]; then print 'reason=no_comments_on_this_video'; else print 'comments_opened=1'; print 'comment_count=1'; fi;;
 collect-comments) n=100;if [[ -n "$RELOCATE" && "$(grep -c '^collect-comments$' "$CALLS")" -gt 1 ]];then n=300;fi;print "甲\\t咨询价格\\t今天\\t北京\\treader\\ttap=$n 200\\tb64=55Sy"; print 'exhausted=1';;
 commenter-identity) print "$4 $5" >> "$CALLS_COORD";[[ -z "$IDENTITY_FAIL" ]] || exit 1;if [[ -n "$RELOCATE" && "$(grep -c '^commenter-identity$' "$CALLS")" -eq 1 ]];then exit 1;fi;print 'nickname=甲';print 'douyin_id=person123';print 'account_type=personal';;
 commenter-card-link) [[ -z "$CARD_RETURNS_OFF_DETAIL" ]] || touch "$CARD_STATE";print 'profile_url=https://www.douyin.com/user/a';;
 *) ;;
esac
`,{mode:0o755});
 const qualify=path.join(d,'qualify');
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
 if(extra.HISTORY){requireHistoryDir();writeFileSync(historyPath,JSON.stringify({version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'cmd100822-new',source_run:'source101',video_id:vid,video_url:'https://www.douyin.com/video/'+vid,observed_at:new Date().toISOString(),rows:[{id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'咨询价格'}],...extra.HISTORY}));}
 function requireHistoryDir(){mkdirSync(evidence,{recursive:true});}
 const r=spawnSync('zsh',[script,mode,'jinoshengyuan-work',vid,`https://www.douyin.com/video/${vid}`,Buffer.from('测试视频').toString('base64'),Buffer.from('人工智能训练师').toString('base64'),'cmd100822-new',extra.HISTORY?'jinuo':'金诺盛源'],{env:{...process.env,DOUYIN_PHONE_ADB:ctl,CALLS:log,STRATEGIES:path.join(d,'strategies'),CALLS_COORD:coords,CARD_STATE:path.join(d,'off-detail'),WFR_RUN_DIR:evidence,HARVEST_KEYWORD_TESTING:'1',QUEUED_VIDEO_QUALIFY_CMD:qualify,OWN_ACCOUNTS_CONF:own,...extra,...(extra.HISTORY?{LEADGEN_SOURCE_RUN:'source101',QUEUED_COMMENT_HISTORY_FILE:historyPath}:{})},encoding:'utf8',timeout:7000});
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
