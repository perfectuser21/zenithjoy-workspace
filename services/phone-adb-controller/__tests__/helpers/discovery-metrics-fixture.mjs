import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import metrics from '../../discovery-metrics.js';

export function queueMetricsFixture({run='receipt-test',videoId='7617105883093603314'}={}){
 const execution={run,run_id:`douyin_video_discovery-${run}__a1`,profile:'legacy',line:'jinuo'},sourceCommit='a'.repeat(40),videoUrl='https://www.douyin.com/video/'+videoId;
 const observation=metrics.buildObservation({...execution,line_key:'jinuo',source_commit:sourceCommit,video_id:videoId,video_url:videoUrl,observed_at:'2026-10-22T03:00:00.000Z',evidence_id:run+'-candidate1-link-t1',xml:'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢67，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论4，按钮"/></hierarchy>'});
 const company={run_id:run,company_id:'00000000-0000-4000-8000-000000000001',tenant_id:'00000000-0000-4000-8000-000000000002',version:1};
 company.snapshot={...company,runtime_config:{routing:{line_key:'jinuo'}}};
 return {video:{videoId,videoUrl,metrics:observation},deps:{sourceCommit,execution},company};
}

// 现有导航/筛选测试的手机边界补齐新合同；原生解析和PG写回由独立真实回归验证。
export function metricPhoneReceipt(output,eid,dir){
 const vid=String(output).match(/^video_id=(\d{16,24})$/m)?.[1];if(!vid)return output;
 const evidenceId=eid+'-t1',file=join(dir,evidenceId+'-share.xml');mkdirSync(dir,{recursive:true});
 writeFileSync(file,'<hierarchy><node package="com.ss.android.ugc.aweme" content-desc="未点赞，喜欢67，按钮"/><node package="com.ss.android.ugc.aweme" content-desc="评论4，按钮"/></hierarchy>');
 return output+`\nresolved_url=https://www.douyin.com/video/${vid}\nmetrics_evidence=${file}\nmetrics_evidence_id=${evidenceId}\n`;
}
export function withDiscoveryMetricsFixture(factory){
 return options=>{
  const env=Object.assign(options.env,{LEADGEN_LINE:options.env.LEADGEN_LINE||'jinuo',LEADGEN_EVIDENCE_DIR:options.env.WFR_RUN_DIR});
  return factory({...options,env,sourceCommit:options.sourceCommit||'a'.repeat(40),runId:options.runId||`douyin_video_discovery-${options.run}__a1`,
   phone:async(command,...args)=>{const output=await options.phone(command,...args);return command==='current-video-link'?metricPhoneReceipt(output,args[0],env.LEADGEN_EVIDENCE_DIR):output;},
   queue:async(op,fields)=>{const result=await options.queue(op,fields);return op==='discover'&&typeof result?.inserted==='boolean'?{...result,metrics_verified:true,metrics_digest:fields.video.metrics.digest}:result;}});
 };
}
