'use strict';
const {validateObservation}=require('./discovery-metrics.js');
const {discoverVideo}=require('./leadgen-db-lib.js');
const {routeOf}=require('./line-routes.js');
async function discoverMetricsRequest(pool,input,{sourceCommit,execution}={}){
 const {run,op,video}=input,lineKey=routeOf(input.line).key;
 if(!execution||execution.run!==run||routeOf(execution.line).key!==lineKey)throw Error('METRICS_EXECUTION_SCOPE_MISMATCH');
 const videoId=video?.video_id??video?.videoId,videoUrl=video?.video_url??video?.videoUrl;
 const observation=validateObservation(video?.metrics,{run,run_id:execution.run_id,profile:execution.profile,source_commit:sourceCommit,line_key:lineKey,video_id:videoId,video_url:videoUrl});
 const rows=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
   WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
 const company=rows[0];
 if(rows.length!==1||company.run_id!==run||company.snapshot?.company_id!==company.company_id||company.snapshot?.tenant_id!==company.tenant_id
   ||Number(company.snapshot?.version)!==Number(company.version)||company.snapshot?.runtime_config?.routing?.line_key!==lineKey)throw Error('METRICS_COMPANY_BINDING_MISMATCH');
 const bound={...observation,company_binding:{company_id:company.company_id,tenant_id:company.tenant_id,version:Number(company.version),run_id:run,line_key:lineKey}};
 if(op==='discover_readback'){
  const result=await pool.query(`SELECT judgment_status,(transcript IS NOT NULL AND transcript<>'') AS has_transcript,
    discovery_metrics=$4::jsonb AS metrics_verified FROM zenithjoy.leadgen_videos
    WHERE line_key=$1 AND video_id=$2 AND video_url=$3`,[lineKey,videoId,videoUrl,JSON.stringify(bound)]);
  const row=result.rows[0];
  if(!row)return null;
  if(row.metrics_verified!==true)throw Error('METRICS_READBACK_MISMATCH');
  return {status:row.judgment_status,has_transcript:!!row.has_transcript,inserted:false,recovered:true,metrics_verified:true,metrics_digest:observation.digest};
 }
 return discoverVideo(pool,{lineKey,videoId,videoUrl,title:video.title,keyword:video.keyword,harvestBatch:run,discoveryMetrics:bound});
}
module.exports={discoverMetricsRequest};
