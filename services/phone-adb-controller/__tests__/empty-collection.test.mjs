import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers} from '../leadgen-workflow.mjs';
import {judgeSteps} from '../step-judge.mjs';

const spec=JSON.parse(readFileSync(new URL('../plans/douyin_video_processing.steps.json',import.meta.url)));
const profileLinkStep=spec.steps.find(s=>s.key.endsWith('.resolve_profile_link'));

test('无合格视频产生真实空评论工件，主页链接读回通过，评论和采样数量仍为0',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'empty-comments-'));
 try{
  const handler=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'empty',P:'work',LEADGEN_LINE:'jinuo'},
   rpc:async()=>{throw Error('无合格视频不应请求数据库');},execute:async()=>{throw Error('无合格视频不应操控手机');}});
  const result=await handler.collection();
  assert.equal(result.comments,0);assert.equal(result.videos_processed,0);
  assert.equal(result.sampling_required_count,0);assert.deepEqual(result.sampling_receipts,[]);
  const file=join(dir,'comments.tsv');assert.equal(readFileSync(file,'utf8'),'');
  assert.equal(statSync(file).mode&0o777,0o600);
  const checked=judgeSteps({spec:{steps:[profileLinkStep]},stage:'collection',ctx:{tsvFile:file,word:'',metrics:result}});
  assert.equal(checked.steps[0].observed,0);assert.equal(checked.steps[0].pass,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('评论工件缺失仍读回失败；已有评论不会被空分支截断',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'missing-comments-'));
 try{
  const file=join(dir,'comments.tsv');
  const missing=judgeSteps({spec:{steps:[profileLinkStep]},stage:'collection',ctx:{tsvFile:file,word:''}});
  assert.equal(missing.steps[0].pass,null);assert.match(missing.steps[0].error,/采收产物不存在/);
  const body='LEAD\tperson\tname\ttext\ta\tb\tc\td\t\tvideo\t\tend\n';
  writeFileSync(file,body,{mode:0o600});
  const handler=createHandlers({root:dir,env:{HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'empty',P:'work',LEADGEN_LINE:'jinuo'},rpc:async()=>{throw Error('不应请求数据库');}});
  await handler.collection();assert.equal(readFileSync(file,'utf8'),body);
  const bad=judgeSteps({spec:{steps:[profileLinkStep]},stage:'collection',ctx:{tsvFile:file,word:''}});
  assert.equal(bad.steps[0].observed,1);assert.equal(bad.steps[0].pass,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
