const tag=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const videoId=/^\d{16,24}$/;
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
  return {source_run:origin,video};
}
