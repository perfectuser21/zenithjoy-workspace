import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHandlers,parseCollection} from '../leadgen-workflow.mjs';
import {createRequire} from 'node:module';
const {queueRequest}=createRequire(import.meta.url)('../leadgen-queue.js');

const root = new URL('../',import.meta.url).pathname;
const vid = '7681632828384394202';

test('real queued CLI soft-budget completion persists verified rows and keeps the video incomplete',async()=>{
 const d=mkdtempSync(join(tmpdir(),'queued-budget-progress-'));
 try {
  writeFileSync(join(d,'clock'),'0');
  writeFileSync(join(d,'own.json'),JSON.stringify({nicknames:[],ids:[]}));
  writeFileSync(join(d,'date'),`#!/bin/sh\ncat "$FAKE_COLLECTION_DIR/clock"\n`,{mode:0o755});
  const ctl=join(d,'ctl');
  writeFileSync(ctl,`#!/usr/bin/env node
const fs=require('fs'),p=require('path');const d=process.env.FAKE_COLLECTION_DIR,cmd=process.argv[4];
switch(cmd){
case 'lock-refresh':console.log('lock=refreshed owner=budget-progress');break;
case 'current-video-link':console.log('content_type=video\\nvideo_id=${vid}');break;
case 'open-comments':{const f=p.join(d,'opens');let n=fs.existsSync(f)?+fs.readFileSync(f):0;fs.writeFileSync(f,String(++n));if(n===2)fs.writeFileSync(p.join(d,'clock'),'500');console.log('comments_opened=1\\ncomment_count=68');break;}
case 'collect-comments':console.log('甲\\t如何报名\\t今天\\t北京\\treader\\ttap=100 200\\tb64=55Sy\\nexhausted=0');break;
case 'commenter-identity':console.log('nickname=甲\\ndouyin_id=person123\\naccount_type=personal');break;
case 'commenter-card-link':console.log('profile_url=https://v.douyin.com/person123/');break;
}
`,{mode:0o755});
  const calls=[],actual=[];
  const env={...process.env,HOME:d,WFR_RUN_DIR:d,WFR_TAG:'budget-progress',P:'work',LEADGEN_LINE:'jinuo',
   DOUYIN_PHONE_ADB:ctl,OWN_ACCOUNTS_CONF:join(d,'own.json'),FAKE_COLLECTION_DIR:d,PATH:d+':'+process.env.PATH,
   HARVEST_KEYWORD_TESTING:'1',QUEUED_VIDEO_COLLECTION_SECONDS:'1'};
  const h=createHandlers({root,env,rpc:async({request:q})=>{
   calls.push(q);
   if(q.op==='claim_videos')return {result:[{video_id:vid,video_url:'https://v.douyin.com/video123/',title:'测试培训',keyword:'人工智能训练师',judgment_status:'matched'}]};
   if(q.op==='collect_partial')return {result:{comments:q.comments.length,inserted:q.comments.length}};
   return {result:{}};
  },execute:async(cmd,args,opts)=>{
   const r=spawnSync(cmd,args,{env:opts.env,encoding:'utf8',timeout:7000});
   const out={code:r.status,stdout:r.stdout||'',stderr:r.stderr||''};actual.push(out);return out;
  }});
  await h.qualification();const r=await h.collection();
  const cli=actual.at(-1);assert.equal(cli.code,7,'soft budget remains a non-success exit');
  assert.match(cli.stdout,new RegExp('COLLECTION\\t'+vid+'\\tpartial\\t1'));
  assert.equal(r.status,'partial');assert.equal(r.comments,1);assert.equal(r.collected,0);
  assert.equal(calls.filter(c=>c.op==='collect').length,0,'partial cannot mark the video collected');
  const saved=calls.filter(c=>c.op==='collect_partial');assert.equal(saved.length,1);
  assert.equal(saved[0].comments[0].douyinId,'person123');assert.equal(saved[0].comments[0].commentBody,'如何报名');
  await h.cleanup();assert.ok(calls.some(c=>c.op==='release_video'&&c.video_id===vid));
  assert.match(readFileSync(join(d,'comments.tsv'),'utf8'),/LEAD\t甲\tperson123/);
 }finally{rmSync(d,{recursive:true,force:true});}
});

test('partial progress requires its exact video marker and count, and never accepts hard failures',()=>{
 const row='LEAD\t甲\tperson123\tpersonal\t如何报名\t今天\t北京\t培训\t人工智能\t\thttps://v.douyin.com/person123/\thttps://v.douyin.com/video123/\n';
 const good={code:7,stdout:row+`COLLECTION\t${vid}\tpartial\t1\n`};
 assert.equal(parseCollection(good,vid,{allowPartial:true}).length,1);
 assert.throws(()=>parseCollection(good,vid));
 for(const bad of [{...good,code:124},{...good,code:4},{...good,code:0},
  {code:7,stdout:row},{code:7,stdout:row+`COLLECTION\t${vid}\tpartial\t2\n`},
  {code:7,stdout:row+'COLLECTION\t7669710300359075529\tpartial\t1\n'}]){
  assert.throws(()=>parseCollection(bad,vid,{allowPartial:true}));
 }
});

test('partial comment transaction commits rows without changing the video completion state',async()=>{
 const calls=[];const client={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT video_id'))return {rows:[{judgment_status:'matched'}]};
  if(sql.includes('INSERT INTO zenithjoy.leadgen_comments'))return {rows:[{id:'new-comment'}]};
  assert.ok(['BEGIN','COMMIT','ROLLBACK'].includes(sql),`unexpected video status change: ${sql}`);return {rows:[]};
 },release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'collect_partial',line:'jinuo',run:'budget-progress',video_id:vid,
  comments:[{nickname:'甲',douyinId:'person123',commentBody:'如何报名'}]});
 assert.equal(result.status,'partial');assert.equal(result.inserted,1);
 assert.ok(calls.some(c=>c.sql==='COMMIT'));
 assert.ok(!calls.some(c=>c.sql.includes('UPDATE zenithjoy.leadgen_videos')));
});
