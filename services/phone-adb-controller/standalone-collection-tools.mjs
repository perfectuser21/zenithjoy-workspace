const tag = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/;
const videoId = /^\d{16,24}$/;
const fail = code => { throw Error('STANDALONE_COLLECTION_'+code); };

function checkSource(request,scope) {
  if (scope?.workflow_key !== 'douyin_video_processing' || scope.limit !== 1
    || request.op !== 'collect_claim' || request.source_run !== null || request.limit !== 1
    || request.line !== scope.line || request.run !== scope.run_tag
    || ![scope.line,scope.run_tag,scope.source_run].every(value=>typeof value==='string'&&tag.test(value))
    || scope.source_run === scope.run_tag || request.committed_origin_run !== scope.source_run) fail('ORIGIN');
}

const observedOrigin = `discovery_metrics->'company_binding'->>'run_id'=$2
    AND discovery_metrics->'company_binding'->>'company_id'=$3
    AND discovery_metrics->'company_binding'->>'tenant_id'=$4
    AND discovery_metrics->'company_binding'->>'version'=$5
    AND discovery_metrics->'company_binding'->>'line_key'=$1`;

// 仅领取已核原来源的视频。保留此批次在普通采集账上的身份，供 103 按精确来源读取。
export async function claimStandaloneCollectionVideo(pool,request,scope) {
  checkSource(request,scope);
  const {line,run_tag:run,source_run:origin,company}=scope;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['standalone-102:'+line+':'+run]);
    const configs=(await client.query(`SELECT company_id,tenant_id,version,run_id,source_run,snapshot
      FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2 FOR SHARE`,[company.company_id,run])).rows;
    const config=configs[0];
    if(configs.length!==1||config.run_id!==run||config.tenant_id!==company.tenant_id||Number(config.version)!==company.version
      ||config.source_run!==null||config.snapshot?.config_status!=='enabled'||config.snapshot.runtime_config?.routing?.line_key!==line
      ||['company_id','tenant_id','version','policy_id'].some(key=>config.snapshot[key]!==company[key])) fail('COMPANY');
    const claimed='处理中:'+run;
    const parameters=[line,origin,company.company_id,company.tenant_id,String(company.version),run,claimed];
    let rows=(await client.query(`SELECT video_id,video_url,title,judgment_status,process_status,harvest_batch
      FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND ${observedOrigin}
      AND harvest_batch=$6 AND process_status=$7 LIMIT 2 FOR UPDATE`,parameters)).rows;
    if(!rows.length) {
      rows=(await client.query(`WITH pending AS (
        SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND harvest_batch=$2 AND ${observedOrigin}
          AND judgment_status IN ('pending','matched') AND process_status IN ('待判定','待采评论')
        ORDER BY discovered_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE zenithjoy.leadgen_videos AS video SET process_status=$7,harvest_batch=$6,updated_at=now()
      FROM pending WHERE pending.id=video.id
      RETURNING video_id,video_url,title,judgment_status,process_status,harvest_batch`,parameters)).rows;
    }
    const row=rows[0];
    if(rows.length>1||row&&(!videoId.test(row.video_id)||row.video_url!=='https://www.douyin.com/video/'+row.video_id
      ||typeof row.title!=='string'||row.harvest_batch!==run||row.process_status!==claimed
      ||!['pending','matched'].includes(row.judgment_status))) fail('CLAIM_READBACK');
    await client.query('COMMIT');
    return {source_run:origin,video:row?{
      video_id:row.video_id,video_url:row.video_url,title:row.title,judgment_status:row.judgment_status,
    }:null};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
