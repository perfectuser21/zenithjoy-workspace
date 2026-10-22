import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const scope={run:'real101',run_id:'douyin_video_discovery-real101__a2',profile:'legacy',source_commit:'a'.repeat(40),line_key:'jinuo',video_id:'7693970762462579121',video_url:'https://www.douyin.com/video/7693970762462579121',observed_at:'2026-10-22T03:00:00.000Z',evidence_id:'real101-candidate2-link-t1'};
const tree=(like,comment)=>`<?xml version="1.0"?><hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢${like}，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论${comment}，按钮"/></hierarchy>`;
export const metricsFixture=(overrides={})=>require('../discovery-metrics.js').buildObservation({...scope,...overrides,xml:overrides.xml??tree('67','4')});
for(const [raw,value,tier] of [['0',0,'zero'],['1',1,'1_100'],['100',100,'1_100'],['101',101,'101_500'],['500',500,'101_500'],['501',501,'over_500'],['1.2万',12000,'over_500'],['1.23亿',123000000,'over_500'],['',null,'unknown'],['评论',null,'unknown'],['1万+',null,'unknown']])test(`原生指标${JSON.stringify(raw)}保持真实0、单位和unknown边界`,()=>{
 const m=metricsFixture({xml:tree('67',raw)});assert.equal(m.likes.value,67);assert.equal(m.comment_total.value,value);assert.equal(m.comment_tier,tier);assert.equal(m.comment_total.raw,raw);
});
test('同视频重复树节点值相同可以读回，冲突或非抖音树拒绝',()=>{
 const {buildObservation}=require('../discovery-metrics.js');
 assert.equal(metricsFixture({xml:tree('67','4').replace('</hierarchy>','<node package="com.ss.android.ugc.aweme" content-desc="评论4，按钮"/></hierarchy>')}).comment_total.value,4);
 assert.throws(()=>metricsFixture({xml:tree('67','4').replace('</hierarchy>','<node package="com.ss.android.ugc.aweme" content-desc="评论5，按钮"/></hierarchy>')}),/METRICS_NATIVE_AMBIGUOUS/);
 assert.throws(()=>buildObservation({...scope,xml:tree('67','4').replaceAll('com.ss.android.ugc.aweme','other.package')}),/METRICS_NATIVE_INVALID/);
});
test('远端由核验来源重算原文、数值和digest，不接受调用者自证',()=>{
 const {validateObservation}=require('../discovery-metrics.js'),m=metricsFixture();
 assert.deepEqual(validateObservation(m,scope),m);
 for(const [key,value] of [['run','other'],['run_id','douyin_video_discovery-real101__a1'],['source_commit','b'.repeat(40)],['line_key','yuesheng'],['video_id','7695303157311884570'],['video_url','https://www.douyin.com/video/7695303157311884570']])assert.throws(()=>validateObservation({...m,[key]:value},scope),/METRICS_SCOPE_MISMATCH/);
 assert.throws(()=>validateObservation({...m,likes:{raw:'67',value:0}},scope),/METRICS_DERIVATION_MISMATCH/);
 assert.throws(()=>validateObservation({...m,evidence:{...m.evidence,xml:m.evidence.xml.replace('喜欢67','喜欢68')}},scope),/METRICS_EVIDENCE_HASH_MISMATCH/);
 assert.throws(()=>validateObservation({...m,digest:'f'.repeat(64)},scope),/METRICS_DIGEST_MISMATCH/);
});

test('成功取链原件封存与最终逐VID读回，路径/原件/权限/ACK不符均拒绝',async()=>{
 const {mkdtempSync,writeFileSync,rmSync,symlinkSync,chmodSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {captureObservation,verifyArchivedObservations}=require('../discovery-metrics.js');
 const dir=mkdtempSync(join(tmpdir(),'metrics-original-')),file=join(dir,scope.evidence_id+'-share.xml');
 try{
  writeFileSync(file,tree('67','4'));
  const observation=captureObservation({...scope,file,evidenceRoot:dir,runDir:dir});
  const videos=[{videoId:scope.video_id,videoUrl:scope.video_url,metrics:observation}],archive=join(dir,'discovery-metrics',observation.digest+'.json');let reads=0;
  const options={videos,runDir:dir,scope,readback:async()=>{reads++;return {metrics_verified:true,metrics_digest:observation.digest,recovered:true};}};
  assert.equal(await verifyArchivedObservations(options),true);assert.equal(reads,1);
  for(const reply of [null,{metrics_verified:true,recovered:true,metrics_digest:'stale'},{metrics_verified:true,metrics_digest:observation.digest}])assert.equal(await verifyArchivedObservations({...options,readback:async()=>reply}),false);
  assert.equal(await verifyArchivedObservations({...options,videos:[...videos,...videos]}),false);
  assert.equal(await verifyArchivedObservations({...options,scope:{...scope,run_id:'douyin_video_discovery-real101__a1'}}),false);
  chmodSync(archive,0o644);assert.equal(await verifyArchivedObservations(options),false);chmodSync(archive,0o600);
  writeFileSync(archive,JSON.stringify({...observation,likes:{raw:'67',value:0}}));assert.equal(await verifyArchivedObservations(options),false);
  assert.throws(()=>captureObservation({...scope,file,evidenceRoot:dir,runDir:dir}),/METRICS_ARCHIVE_CHANGED/);
  rmSync(file);symlinkSync(archive,file);assert.throws(()=>captureObservation({...scope,file,evidenceRoot:dir,runDir:dir}),/METRICS_EVIDENCE_PATH_INVALID/);
  rmSync(file);writeFileSync(file,'x'.repeat(1024*1024+1));assert.throws(()=>captureObservation({...scope,file,evidenceRoot:dir,runDir:dir}),/METRICS_EVIDENCE_PATH_INVALID/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
