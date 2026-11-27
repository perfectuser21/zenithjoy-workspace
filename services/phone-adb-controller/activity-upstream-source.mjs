// Producer identity comes from independently admitted, frozen run artifacts, never a row under test.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Error('UPSTREAM_SOURCE_'+code);};
const SHA=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PG_READBACK_SHA='97258da30cb46ae635807d241d548df4db422151060f5ee479df9fd258d7d5e1';
function readPinned(file,digest,kind){
 need(typeof file==='string'&&path.isAbsolute(file)&&SHA.test(digest??''),kind);
 try{
  const stat=fs.lstatSync(file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16*1024*1024,kind);
  const bytes=fs.readFileSync(file);need(hash(bytes)===digest,kind);return JSON.parse(bytes);
 }catch{throw Error('UPSTREAM_SOURCE_'+kind);}
}
function readProducerRun(c,producer){
 const p=c?.input_provenance?.producer;
 need(p&&p.workflow==='101'&&COMMIT.test(p.source_commit??'')&&UUID.test(p.task_id??'')&&UUID.test(p.run_id??'')
  &&typeof p.run_tag==='string'&&p.run_tag.length>0&&p.run_tag===producer?.run&&p.run_id===producer?.run_id,'SCOPE');
 const m=readPinned(p.manifest_path,p.manifest_sha256,'MANIFEST'),r=readPinned(p.result_path,p.result_sha256,'RESULT');
 const run=m?.run;let input=run?.input;
 if(input?.assigned_workflow===undefined){
  need(run?.contract?.workflow==='douyin_video_discovery'&&input&&Object.keys(input).length===3
   &&Object.keys(input).every(k=>['binding_key','business','run_tag'].includes(k))
   &&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(input.binding_key??'')
   &&input.business&&typeof input.business==='object'&&!Array.isArray(input.business)
   &&input.run_tag===run.run_id&&p.run_tag===run.run_id,'MANIFEST');
  input=readPinned(p.context_path,p.context_sha256,'CONTEXT');
 }else need(p.context_path===undefined&&p.context_sha256===undefined,'CONTEXT');
 const identity=input?.tasks?.['101'];
 need(run&&['douyin-leadgen-101','douyin_video_discovery'].includes(run.contract?.workflow)
  &&run.task_id===p.task_id&&run.run_id===p.run_id&&input?.assigned_workflow==='101'
  &&Object.keys(input.tasks).join()==='101'&&identity?.task_id===p.task_id&&identity?.run_id===p.run_id
  &&identity?.run_tag===p.run_tag&&input.run_tag===p.run_tag&&input.source_commit===p.source_commit,'IDENTITY');
 need(typeof input.profile==='string'&&input.profile.length>0&&input.profile.length<=128
  &&['company_id','tenant_id','line'].every(k=>typeof c[k]==='string'&&c[k].length>0&&input[k]===c[k]),'BUSINESS_SCOPE');
 need(r?.task_id===p.task_id&&r.run_id===p.run_id&&r.status==='completed'&&r.business_pass===true,'RESULT');
 return {descriptor:p,input,result:r};
}
export function resolveProducerIdentity(c,activity,producer){
 if(activity==='collect_videos')return {source_commit:c.source_commit,profile:c.profile};
 need(activity==='dedup','ACTIVITY');
 const {input}=readProducerRun(c,producer);
 return {source_commit:input.source_commit,profile:input.profile};
}
function readLegacyVideo(result,descriptor,input,videoId,receipt){
 need(result.outputs?.video_ids?.includes(videoId)&&receipt.outputs?.video_ids?.includes(videoId),'VIDEO');
 const accepted=receipt.activities?.find(a=>a.key==='collect_videos'&&a.status==='completed')
  ?.validator_verdict?.evidence?.find(item=>item.id==='video_identity');
 const proofs=(accepted?.evidence??[]).flatMap(e=>e.observation?.proofs??[])
  .filter(proof=>proof.video_id===videoId&&proof.run===descriptor.run_tag);
 need(proofs.length===1&&SHA.test(proofs[0].digest??''),'VIDEO_EVIDENCE');
 const digest=proofs[0].digest,file=path.join(path.dirname(descriptor.result_path),'discovery-metrics',digest+'.json');
 need(fs.realpathSync(file)===file,'VIDEO_EVIDENCE');
 const stat=fs.lstatSync(file);
 need(stat.isFile()&&stat.uid===process.getuid()&&!(stat.mode&0o077)&&stat.size<=1024*1024,'VIDEO_EVIDENCE');
 const metrics=JSON.parse(fs.readFileSync(file,'utf8'));
 const {digest:stored,...observation}=metrics;
 need(stored===digest&&hash(JSON.stringify(observation))===digest&&typeof metrics.evidence?.xml==='string'
  &&hash(metrics.evidence.xml)===metrics.evidence.sha256,'VIDEO_EVIDENCE');
 const url='https://www.douyin.com/video/'+videoId;
 const expected={video_id:videoId,video_url:url,line_key:input.line,run_id:descriptor.run_id,run:descriptor.run_tag,
  source_commit:descriptor.source_commit,profile:input.profile};
 need(Object.entries(expected).every(([key,value])=>metrics[key]===value),'VIDEO_EVIDENCE');
 return {video_id:videoId,video_url:url,keyword:input.keyword,discovery_metrics:metrics};
}
export function readUpstreamHandoff(c){
 const scope=c.verification?.['102'],videoId=scope?.video_ids?.[0];
 need(scope?.video_ids?.length===1&&/^[0-9]{16,24}$/.test(videoId??''),'VIDEO');
 const {descriptor,input,result}=readProducerRun(c,scope.upstream?.[videoId]);
 const deliveries=(result.receipts??[]).filter(r=>r.activity_key==='collect_videos'&&r.status==='completed');
 need(deliveries.length===1,'VIDEO');
 const delivery=deliveries[0];
 let video;
 if(Array.isArray(delivery.outputs?.Video)){
  const matches=delivery.outputs.Video.filter(v=>v.video_id===videoId);
  need(matches.length===1,'VIDEO');
  const item=matches[0],url=item.video_url??item.url;
  need(url==='https://www.douyin.com/video/'+videoId&&(item.url===undefined||item.url===url),'VIDEO');
  const fields=['video_id','line_key','title','author','keyword','comment_count','harvest_batch','discovery_metrics'];
  video={video_url:url,...Object.fromEntries(fields.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]))};
 }else video=readLegacyVideo(result,descriptor,input,videoId,delivery);
 const fields=['task_id','run_id','run_tag','source_commit','manifest_sha256','result_sha256'];
 return {producer:{workflow:'101',company_id:input.company_id,tenant_id:input.tenant_id,line:input.line,
  ...Object.fromEntries(fields.map(key=>[key,descriptor[key]]))},video};
}
export function wireProducerReadback(source){
 need(typeof source==='string'&&hash(source)===PG_READBACK_SHA,'BASE');
 const before='const expected={run:producer.run,run_id:producer.run_id,profile:c.profile,source_commit:c.source_commit,line_key:c.line,video_id:row.video_id,video_url:row.video_url};';
 need(source.split(before).length===2,'BASE');
 return "import {resolveProducerIdentity} from './activity-upstream-source.mjs';\n"+source.replace(before,
  'const expected={run:producer.run,run_id:producer.run_id,...resolveProducerIdentity(c,activity,producer),line_key:c.line,video_id:row.video_id,video_url:row.video_url};');
}
