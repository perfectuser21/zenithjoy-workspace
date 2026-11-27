const tag=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const videoId=/^\d{16,24}$/;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const need=(value,code)=>{if(!value)throw Error('UPSTREAM_SOURCE_'+code);};
const fail=reason=>{
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};

export function checkSource(request,scope,operation='collect_claim') {
  if (scope?.workflow_key !== 'douyin_video_processing' || scope.limit !== 1
    || request.op !== operation || request.source_run !== null || request.limit !== 1
    || request.line !== scope.line || request.run !== scope.run_tag
    || ![scope.line,scope.run_tag,scope.source_run].every(value=>typeof value==='string'&&tag.test(value))
    || scope.source_run === scope.run_tag || request.committed_origin_run !== scope.source_run) fail('ORIGIN');
}

export const observedOrigin = `discovery_metrics->'company_binding'->>'run_id'=$2
    AND discovery_metrics->'company_binding'->>'company_id'=$3
    AND discovery_metrics->'company_binding'->>'tenant_id'=$4
    AND discovery_metrics->'company_binding'->>'version'=$5
    AND discovery_metrics->'company_binding'->>'line_key'=$1`;

export async function readStandaloneCollectionSource(pool,request,scope) {
  checkSource(request,scope,'collect_source_read');
  const requested = request.video_id ?? null;
  if (requested !== null && (typeof requested !== 'string' || !videoId.test(requested))) fail('VIDEO_SCOPE');
  const {line,source_run:origin,company}=scope;
  const {rows}=await pool.query(`SELECT video_id,video_url,title,keyword,judgment_status,process_status,
    discovery_metrics->>'digest' AS evidence_digest,
    discovery_metrics->'comment_total'->'value' AS observed_comment_count
    FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND harvest_batch=$2 AND ${observedOrigin}
      AND ($6::text IS NULL OR video_id=$6)
      AND judgment_status IN ('pending','matched') AND process_status IN ('待判定','待采评论')
    ORDER BY discovered_at,id LIMIT 1`,[line,origin,company.company_id,company.tenant_id,String(company.version),requested]);
  const video=rows[0]??null;
  if(video&&(!videoId.test(video.video_id)||requested!==null&&video.video_id!==requested
    ||video.video_url!=='https://www.douyin.com/video/'+video.video_id)) fail('SOURCE_READBACK');
  if(!video||request.include_author_scope!==true)return {source_run:origin,video};
  const {rows:configs}=await pool.query(`SELECT snapshot FROM zenithjoy.company_config_runs
    WHERE run_id=$1 AND company_id=$2 AND tenant_id=$3 AND version=$4 AND source_run IS NULL`,
    [scope.run_tag,company.company_id,company.tenant_id,company.version]);
  const snapshot=configs[0]?.snapshot,accounts=snapshot?.runtime_config?.platform_accounts;
  if(configs.length!==1||snapshot.config_status!=='enabled'||snapshot.runtime_config?.routing?.line_key!==line
    ||snapshot.policy_id!==company.policy_id||!Array.isArray(accounts))fail('COMPANY');
  const ids=accounts.filter(a=>a?.company_id===company.company_id&&a.tenant_id===company.tenant_id
    &&a.platform==='douyin'&&a.enabled===true&&a.verification_status==='verified')
    .map(a=>a.douyin_id).filter(id=>typeof id==='string'&&id.length>0&&id.trim()===id);
  return {source_run:origin,video,own_douyin_ids:[...new Set(ids)]};
}

export async function readStandaloneProducerHandoff({read,sourceRun,line,company,candidate}){
 const {video_id:id,video_url:url,evidence_digest:digest}=candidate;
 need(UUID.test(sourceRun)&&SHA.test(digest??''),'SCOPE');
 const rec=await read('/api/brain/runs/'+sourceRun+'/reconciliation');
 const taskId=rec.links?.task_id,run=rec.task_run;
 need(rec.run_id===sourceRun&&UUID.test(taskId??'')
  &&run?.task_id===taskId&&run.run_id===sourceRun&&['success','completed','succeeded'].includes(run.status),'RESULT');
 const payload=await read('/api/brain/tasks/'+taskId);
 const task=payload.task??payload,result=task.result?.foundation_result;
 need(task.id===taskId&&task.status==='completed'&&task.payload?.workflow_key==='douyin_video_discovery'
  &&result?.task_id===taskId&&result.run_id===sourceRun&&result.status==='completed'&&result.business_pass===true,'RESULT');
 need(Array.isArray(result.receipts),'VIDEO');
 const receipts=result.receipts.filter(item=>item?.activity_key==='collect_videos'&&item.status==='completed');
 need(receipts.length===1&&Array.isArray(receipts[0].outputs?.Video),'VIDEO');
 const videos=receipts[0].outputs.Video.filter(item=>item?.video_id===id);
 const video=videos[0],metrics=video?.discovery_metrics,binding=metrics?.company_binding;
 need(videos.length===1&&video.video_url===url&&video.line_key===line&&metrics?.digest===digest
  &&binding?.line_key===line&&binding.run_id===sourceRun
  &&['company_id','tenant_id','version'].every(key=>binding[key]===company[key]),'VIDEO_EVIDENCE');
 need(typeof video.author==='string'&&video.author.trim().length>0&&video.author.length<=500,'VIDEO_EVIDENCE');
 return {task_id:taskId,run_id:sourceRun,author:video.author};
}
