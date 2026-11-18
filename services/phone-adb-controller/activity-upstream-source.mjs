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
export function resolveProducerIdentity(c,activity,producer){
 if(activity==='collect_videos')return {source_commit:c.source_commit,profile:c.profile};
 need(activity==='dedup','ACTIVITY');
 const p=c?.input_provenance?.producer;
 need(p&&p.workflow==='101'&&COMMIT.test(p.source_commit??'')&&UUID.test(p.task_id??'')&&UUID.test(p.run_id??'')
  &&typeof p.run_tag==='string'&&p.run_tag.length>0&&p.run_tag===producer?.run&&p.run_id===producer?.run_id,'SCOPE');
 const m=readPinned(p.manifest_path,p.manifest_sha256,'MANIFEST'),r=readPinned(p.result_path,p.result_sha256,'RESULT');
 const run=m?.run,input=run?.input,identity=input?.tasks?.['101'];
 need(run&&['douyin-leadgen-101','douyin_video_discovery'].includes(run.contract?.workflow)
  &&run.task_id===p.task_id&&run.run_id===p.run_id&&input?.assigned_workflow==='101'
  &&Object.keys(input.tasks).join()==='101'&&identity?.task_id===p.task_id&&identity?.run_id===p.run_id
  &&identity?.run_tag===p.run_tag&&input.run_tag===p.run_tag&&input.source_commit===p.source_commit,'IDENTITY');
 need(typeof input.profile==='string'&&input.profile.length>0&&input.profile.length<=128
  &&['company_id','tenant_id','line'].every(k=>typeof c[k]==='string'&&c[k].length>0&&input[k]===c[k]),'BUSINESS_SCOPE');
 need(r?.task_id===p.task_id&&r.run_id===p.run_id&&r.status==='completed'&&r.business_pass===true,'RESULT');
 return {source_commit:input.source_commit,profile:input.profile};
}
export function wireProducerReadback(source){
 need(typeof source==='string'&&hash(source)===PG_READBACK_SHA,'BASE');
 const before='const expected={run:producer.run,run_id:producer.run_id,profile:c.profile,source_commit:c.source_commit,line_key:c.line,video_id:row.video_id,video_url:row.video_url};';
 need(source.split(before).length===2,'BASE');
 return "import {resolveProducerIdentity} from './activity-upstream-source.mjs';\n"+source.replace(before,
  'const expected={run:producer.run,run_id:producer.run_id,...resolveProducerIdentity(c,activity,producer),line_key:c.line,video_id:row.video_id,video_url:row.video_url};');
}
