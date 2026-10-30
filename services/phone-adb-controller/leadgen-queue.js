// 四流程持久队列入口；仅在mmv运行，设备端通过JSON stdin调用，不传递凭据。
'use strict';
const db = require('./leadgen-db-lib.js');
const { resolveLine, configEvidence } = require('./judge-video.js');
const { freezeCompanyConfig, configTargetProfile } = require('./company-config-lib.js');
const { judgeComment, scoreFailureReceipt } = require('./judge-comment.js');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const {evaluatePolicy,dualPolicyReview,verifyStoredPolicy,safePolicyReviewReason}=require('./leadgen-policy-review.js');
async function reviewBoundComment(pool,lineKey,id,binding,deps={}){
  const unknown={id,status:'unknown',reason:'comment_outbox_binding_invalid'};
  if(!uuid.test(id||'')||!binding?.run||!binding.source_run||!binding.source_video||!binding.source_video_url)return unknown;
  const scoringRun=binding.scoring_run||binding.run;
  const rows=(await pool.query('SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=$2',[lineKey,id])).rows;
  if(rows.length!==1||rows[0].id!==id||rows[0].line_key!==lineKey
    ||rows[0].harvest_batch!==binding.source_run||rows[0].source_video!==binding.source_video
    ||rows[0].source_video_url!==binding.source_video_url||rows[0].judgment_config?.run_id!==scoringRun)return unknown;
  try{
    if(scoringRun!==binding.run){
      const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
        WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[binding.run,lineKey])).rows;
      const mark=frozen[0]?.snapshot,original=rows[0].judgment_config;
      if(frozen.length!==1||frozen[0].run_id!==binding.run||!mark||mark.company_id!==original.company_id
        ||mark.tenant_id!==original.tenant_id||Number(mark.version)!==Number(original.version)||mark.policy_id!==original.policy_id)return unknown;
    }
    const review=await queueRequest(pool,{op:'policy_review',line:lineKey,run:scoringRun,claim:scoringRun,source_run:binding.source_run,ids:[id],require_dual_review:true},deps);
    return review.rows[0]||unknown;
  }catch{return unknown;}
}
async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
// 标题仅限定候选集合；身份只接受实际受信跳转中的VID。
async function historyUrlProof(url, videoId, deps) {
  if (url === `https://www.douyin.com/video/${videoId}`) return {source_video_url:url,video_id:videoId,resolved_url:url};
  const resolver=deps.resolveHistoryUrl || (await import('./leadgen-rpc.mjs')).resolveCopiedShareLink;
  const r=await resolver(url);
  if(r.content_type!=='video'||r.content_id!==videoId||r.resolved_url!==`https://www.douyin.com/video/${videoId}`)throw Error('历史URL实际VID不符');
  return {source_video_url:url,video_id:videoId,resolved_url:r.resolved_url};
}
async function validateHistoryRows(client,lineKey,input,old,deps) {
  const actual=(await client.query('SELECT id,douyin_id,comment_body,source_video_url FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=ANY($2::uuid[])',[lineKey,old.map(r=>r.id)])).rows;
  if(actual.length!==old.length)throw Error('历史消费PG重验失败');
  const aliases=new Set();
  for(const r of old){const a=actual.find(a=>a.id===r.id);
    if(!a||a.douyin_id!==r.douyinId||a.comment_body!==r.commentBody||a.source_video_url!==(r.sourceVideoUrl||input.video_url))throw Error('历史消费PG重验失败');
    if(a.source_video_url!==input.video_url)aliases.add(a.source_video_url);
  }
  if(aliases.size>4)throw Error('历史URL解析数量超界');
  const verified=await Promise.allSettled([...aliases].map(url=>historyUrlProof(url,input.video_id,deps)));
  if(verified.some(r=>r.status!=='fulfilled'))throw Error('历史URL实际VID重验失败');
}
const validRun=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
function validSources(ids,sources){
 return Array.isArray(ids)&&ids.length<=1000&&new Set(ids).size===ids.length&&ids.every(id=>uuid.test(id))
  &&sources&&typeof sources==='object'&&!Array.isArray(sources)&&Object.keys(sources).length===ids.length
  &&ids.every(id=>Object.hasOwn(sources,id)&&validRun(sources[id]));
}
async function queueRequest(pool, input, deps = { judgeComment }) {
  deps={judgeComment,...deps};
  const { lineKey } = resolveLine(input.line);
  const { op, run } = input;
  if(op==='recover_single_video_0353_readback')return require('./single-video-recovery-0353.js').readbackSingleVideo(pool,input,deps.recovery0353);
  if(op==='recover_single_video_0353')return require('./single-video-recovery-0353.js').recoverSingleVideo(pool,input,deps.recovery0353);
  if(op==='recover_single_video_readback')return require('./single-video-recovery.js').readbackSingleVideo(pool,input,deps.recovery);
  if(op==='recover_single_video')return require('./single-video-recovery.js').recoverSingleVideo(pool,input,deps.recovery);
  if(op==='verify_producer_company'){
    const {validateProducerDescriptor}=await import('./producer-descriptor.mjs');const d=validateProducerDescriptor(input.descriptor);if(!validRun(run)||lineKey!==d.line)throw Error('PRODUCER_REQUEST_SCOPE_INVALID');
    const rows=(await pool.query('SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs WHERE company_id=$1 AND run_id=$2',[d.company_id,d.run_tag])).rows;
    const f=rows[0],p=f?.snapshot;const verified=rows.length===1&&f.tenant_id===d.tenant_id&&f.version===d.company_config_version&&p?.company_id===d.company_id&&p.tenant_id===d.tenant_id&&p.version===d.company_config_version&&p.policy_id===d.policy_id;
    return {verified,...(verified?{company_id:f.company_id,tenant_id:f.tenant_id,version:f.version,run_id:f.run_id,policy_id:p.policy_id}:{})};
  }
  const sourceRun=input.source_run??null;
  if(sourceRun!==null&&!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(sourceRun))throw Error('上游运行号无效');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(run || '')) throw Error('缺有效运行号');
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  if(op==='policy_review'){
    const ids=input.ids;
    if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||!uuid.test(id))||new Set(ids).size!==ids.length)
      throw Error('POLICY_REVIEW_IDS_INVALID');
    if(input.claim!==run||!sourceRun&&!validSources(input.ids,input.sources))throw Error('POLICY_REVIEW_SCOPE_INVALID');
    const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
      WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
    if(frozen.length!==1||frozen[0].run_id!==run)throw Error('POLICY_REVIEW_SCOPE_INVALID');
    const snapshot=frozen[0].snapshot;
    if(!snapshot||snapshot.company_id!==frozen[0].company_id||snapshot.tenant_id!==frozen[0].tenant_id
      ||Number(snapshot.version)!==Number(frozen[0].version)||snapshot.runtime_config?.routing?.line_key!==lineKey)throw Error('POLICY_REVIEW_SCOPE_INVALID');
    const rows=(await pool.query(`SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=ANY($2::uuid[]) AND ($3::text IS NULL OR harvest_batch=$3)`,[lineKey,ids,sourceRun])).rows;
    const urls=[...new Set(rows.map(r=>r.source_video_url).filter(Boolean))];
    const videos=urls.length?(await pool.query(`SELECT video_id,video_url,title,line_key,judgment_status FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=ANY($2::text[]) AND process_status='评论已采'`,[lineKey,urls])).rows:[];
    const reviewed=[];
    for(const id of ids){const matches=rows.filter(r=>r.id===id);const row=matches[0];
      const owned=row&&videos.filter(v=>v.video_url===row.source_video_url&&v.title===row.source_video&&v.line_key===lineKey&&v.judgment_status==='matched');
      reviewed.push(matches.length===1&&row.line_key===lineKey&&(sourceRun?row.harvest_batch===sourceRun:row.harvest_batch===input.sources[id])
        &&owned.length===1&&row.judgment_config?.run_id===run
        ?row.judgment_config?.policy_reviews?await verifyStoredPolicy(row,snapshot)
          :input.require_dual_review?{id,status:'unknown',reason:'policy_evidence_invalid'}:await evaluatePolicy(row,snapshot,deps)
          :{id,status:'unknown',reason:'row_or_video_scope_unverified'});
    }
    return {verified:reviewed.every(r=>r.status==='pass'),rows:reviewed,ids,scope:{line:lineKey,run,claim:input.claim,source_run:sourceRun}};
  }
  if(op==='score_scope'){
    const rows=(await pool.query(`SELECT id,harvest_batch FROM zenithjoy.leadgen_comments c WHERE line_key=$1 AND ($2::text IS NULL OR harvest_batch=$2)
      AND process_status='待分拣' AND EXISTS (SELECT 1 FROM zenithjoy.leadgen_videos v WHERE v.line_key=c.line_key AND v.video_url=c.source_video_url AND v.title=c.source_video AND v.harvest_batch=c.harvest_batch AND v.process_status='评论已采' AND v.judgment_status='matched') ORDER BY collected_at,id LIMIT 1001`,[lineKey,sourceRun])).rows;
    if(rows.length>1000||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>!uuid.test(r.id)||!validRun(r.harvest_batch)||sourceRun&&r.harvest_batch!==sourceRun))throw Error('POLICY_SCORE_SCOPE_AMBIGUOUS');
    return {line:lineKey,run,source_run:sourceRun,ids:rows.map(r=>r.id),sources:Object.fromEntries(rows.map(r=>[r.id,r.harvest_batch]))};
  }
  if(op==='score_recovery'){
    const ids=input.ids;
    if(!sourceRun&&!validSources(ids,input.sources)||!Array.isArray(ids)||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>!uuid.test(id)))throw Error('POLICY_SCORE_RECOVERY_SCOPE_INVALID');
    if(!ids.length)return {ids:[],scored:0,verified:true};
    const frozen=(await pool.query(`SELECT company_id,tenant_id,version,run_id,snapshot FROM zenithjoy.company_config_runs
      WHERE run_id=$1 AND snapshot->'runtime_config'->'routing'->>'line_key'=$2`,[run,lineKey])).rows;
    if(frozen.length!==1||frozen[0].run_id!==run||!frozen[0].snapshot
      ||frozen[0].snapshot.company_id!==frozen[0].company_id||frozen[0].snapshot.tenant_id!==frozen[0].tenant_id
      ||Number(frozen[0].snapshot.version)!==Number(frozen[0].version))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
    const snapshot=frozen[0].snapshot;
    const rows=(await pool.query(`SELECT id,harvest_batch,line_key,relevance,intent_grade,judgment_config FROM zenithjoy.leadgen_comments
      WHERE line_key=$1 AND ($2::text IS NULL OR harvest_batch=$2) AND id=ANY($3::uuid[])`,[lineKey,sourceRun,ids])).rows;
    if(rows.length!==ids.length||new Set(rows.map(r=>r.id)).size!==ids.length)throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
    const committed=[];
    for(const row of rows){if(row.line_key!==lineKey||!ids.includes(row.id)||row.harvest_batch!==(sourceRun||input.sources[row.id]))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');const c=row.judgment_config;
      if(c?.run_id!==run)continue;
      if(c.company_id!==snapshot.company_id||c.tenant_id!==snapshot.tenant_id||c.policy_id!==snapshot.policy_id||Number(c.version)!==Number(snapshot.version)
        ||!c.policy_audit||c.policy_audit.status!=='pass'||!c.policy_audit.response_id
        ||!c.model_audit?.response_id||!c.model_audit?.model
        ||!['相关','不相关'].includes(row.relevance)||row.relevance==='相关'&&!['A','B','C'].includes(row.intent_grade))throw Error('POLICY_SCORE_RECOVERY_AMBIGUOUS');
      committed.push(row.id);
    }
    return {ids:committed,scored:committed.length,verified:true};
  }
  const videoIds=input.video_ids===undefined?null:input.video_ids;
  if(Object.hasOwn(input,'video_ids')&&(!Array.isArray(videoIds)||videoIds.length>1000||videoIds.some(id=>typeof id!=='string'||!/^\d{16,24}$/.test(id))))throw Error('视频ID清单无效');
  if(Object.hasOwn(input,'prefer_matched')&&(op!=='claim_videos'||typeof input.prefer_matched!=='boolean'||input.prefer_matched===true&&(!sourceRun||videoIds===null)))throw Error('采样优先必须真boolean及明确上游VID范围');
  if(op==='company_config') {
    if (!['101','102','103','104'].includes(String(input.step))) throw Error('COMPANY_STEP_INVALID');
    const requestedBinding=input.device_binding;
    if(requestedBinding!==undefined&&(!['101','102'].includes(String(input.step))||!requestedBinding||Array.isArray(requestedBinding)
      ||typeof requestedBinding!=='object'||Object.keys(requestedBinding).sort().join(',')!=='device_serial,profile'
      ||typeof requestedBinding.profile!=='string'||!requestedBinding.profile||typeof requestedBinding.device_serial!=='string'||!requestedBinding.device_serial))throw Error('COMPANY_DEVICE_BINDING_INPUT_INVALID');
    const snapshot=await (deps.freezeCompanyConfig || freezeCompanyConfig)(pool,{lineHint:input.line,runId:run,sourceRun,step:String(input.step),
      ...(requestedBinding!==undefined&&String(input.step)==='102'?{taskInputs:{device_binding:{...requestedBinding}}}:{})});
    if(requestedBinding!==undefined){
      const accounts=snapshot.runtime_config?.platform_accounts;
      // 明确停用的历史账号保留在快照中；其余同profile行都参与唯一性检查，不能隐藏未核验或非法状态的冲突。
      const matches=Array.isArray(accounts)?accounts.filter(a=>a?.profile===requestedBinding.profile&&a.enabled!==false):[];
      const account=matches[0];
      if(!snapshot.company_id||!snapshot.tenant_id||!Number.isSafeInteger(snapshot.version)||snapshot.version<1||matches.length!==1
        ||account.verification_status!=='verified'||account.enabled!==true||account.device_serial!==requestedBinding.device_serial
        ||String(input.step)==='102'&&(account.company_id!==snapshot.company_id||account.tenant_id!==snapshot.tenant_id||account.platform!=='douyin')
        ||typeof account.douyin_id!=='string'||!account.douyin_id||account.douyin_id.trim()!==account.douyin_id)throw Error('COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED: exact frozen company account/device binding required');
      return {...configEvidence(snapshot,run),device_binding:{company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,run_id:run,
        profile:account.profile,device_serial:account.device_serial,douyin_id:account.douyin_id,verification_status:'verified',enabled:true}};
    }
    return {...configEvidence(snapshot,run),...(String(input.step)==='104'?{runtime_config:snapshot.runtime_config}:{})};
  }
  if(op==='inspect_videos'){
    if(videoIds===null)throw Error('缺明确视频ID清单');
    return (await pool.query('SELECT video_id,line_key,judgment_status,judgment_config,process_status,harvest_batch FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=ANY($2::text[])',[lineKey,videoIds])).rows;
  }
  if(op==='sample_readback'){
    if(!sourceRun||!/^\d{16,24}$/.test(input.video_id||'')||typeof input.video_url!=='string')throw Error('RPC_SAMPLE_SCOPE_INVALID');
    const wanted=input.rows;
    if(!Array.isArray(wanted)||wanted.length>50||wanted.some(r=>!r||!r.douyinId||!r.commentBody||typeof r.sourceVideoUrl!=='string')||new Set(wanted.map(r=>JSON.stringify([r.douyinId,r.commentBody]))).size!==wanted.length)throw Error('RPC_SAMPLE_INPUT_INVALID');
    const checkUrls=urls=>{
      if(urls.length>5||urls.filter(url=>url!==input.video_url).length>4)throw Error('RPC_SAMPLE_URLS_EXCEEDED');
    };
    checkUrls([...new Set(wanted.map(r=>r.sourceVideoUrl))]);
    let video;
    try{video=(await pool.query('SELECT video_id,video_url,judgment_status FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND (video_id=$2 OR video_url=$3)',[lineKey,input.video_id,input.video_url])).rows;}
    catch{throw Error('RPC_SAMPLE_VIDEO_READ_FAILED');}
    if(video.length!==1||video[0].video_id!==input.video_id||video[0].video_url!==input.video_url||video[0].judgment_status!=='matched')throw Error('RPC_SAMPLE_VIDEO_NOT_UNIQUE');
    // 去重INSERT保留旧行的原短链；先按同一业务线+完整身份读真实行，不把本轮短链冒充旧行来源。
    let actual=[];
    try{if(wanted.length)actual=(await pool.query(`SELECT id,douyin_id,comment_body,source_video_url FROM zenithjoy.leadgen_comments
      WHERE line_key=$1 AND EXISTS (SELECT 1 FROM unnest($2::text[],$3::text[]) AS wanted(uid,body)
        WHERE wanted.uid=douyin_id AND wanted.body=comment_body) LIMIT 1001`,[lineKey,wanted.map(r=>r.douyinId),wanted.map(r=>r.commentBody)])).rows;}
    catch{throw Error('RPC_SAMPLE_COMMENTS_READ_FAILED');}
    if(actual.length>1000)throw Error('RPC_SAMPLE_CANDIDATES_EXCEEDED');
    const rows=wanted.map(r=>{
      const found=actual.filter(a=>a.douyin_id===r.douyinId&&a.comment_body===r.commentBody&&(!r.id||a.id===r.id));
      // 多行时不能挑一个URL解析成功的行来掩盖歧义。
      if(found.length!==1||!found[0].id||typeof found[0].source_video_url!=='string')throw Error('RPC_SAMPLE_IDENTITY_NOT_UNIQUE');
      return {id:found[0].id,douyinId:r.douyinId,commentBody:r.commentBody,sourceVideoUrl:found[0].source_video_url};
    });
    const urls=[...new Set([input.video_url,...wanted.map(r=>r.sourceVideoUrl),...rows.map(r=>r.sourceVideoUrl)])];
    checkUrls(urls);
    // 本轮URL和实际PG旧别名都必须由受信跳转证明同VID，不能仅凭同人同正文跨视频复用。
    try{await Promise.all(urls.map(url=>historyUrlProof(url,input.video_id,deps)));}
    catch{throw Error('RPC_SAMPLE_URL_IDENTITY_INVALID');}
    return {verified:true,video_id:input.video_id,coverage:rows.length,rows};
  }
  if (op === 'history') {
    return (await pool.query('SELECT title,video_id FROM zenithjoy.leadgen_videos WHERE line_key=$1', [lineKey])).rows;
  }
  if (op === 'discover' || op === 'discover_readback') {
    return require('./discovery-metrics-queue.js').discoverMetricsRequest(pool,input,deps);
  }
  if (op === 'claim_videos') {
    if(input.producer_descriptor!==undefined)return require('./producer-pending-claim.js').claimPendingProducer(pool,input);
    let evidence=null;
    if (input.config_required === true) {
      const snapshot=await (deps.freezeCompanyConfig || freezeCompanyConfig)(pool,{lineHint:input.line,runId:run,sourceRun,step:'102'});
      evidence=configEvidence(snapshot,run);
    }
    const policyFilter=evidence?"(judgment_status<>'rejected' OR judgment_config IS NULL OR COALESCE(judgment_config->>'company_id','')<>$7 OR COALESCE(judgment_config->>'version','')<>$8)":"judgment_status<>'rejected'";
    const priority=input.prefer_matched===true?"CASE WHEN judgment_status='matched' THEN 0 ELSE 1 END":"CASE WHEN judgment_status='pending' THEN 0 ELSE 1 END";
    return transaction(pool, async client => {
      // 待采的已合格视频也入队；上次崩溃的租约15分钟后可重领，活动内调用续期。
      const result = await client.query(`WITH pending AS (
        SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND ${policyFilter}
        AND ($6::text[] IS NOT NULL OR $5::text IS NULL OR harvest_batch=$5)
        AND ($6::text[] IS NULL OR video_id=ANY($6::text[]))
        AND (process_status='待判定' OR process_status='待采评论'
          OR (process_status LIKE '处理中:%' AND updated_at<now()-interval '15 minutes'))
        ORDER BY ${priority}, discovered_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        UPDATE zenithjoy.leadgen_videos v SET process_status=$3,harvest_batch=$4,updated_at=now()
        FROM pending p WHERE v.id=p.id RETURNING v.*`, [lineKey, limit, `处理中:${run}`, run, sourceRun, videoIds, ...(evidence?[evidence.company_id,String(evidence.version)]:[])]);
      return result.rows;
    });
  }
  if(op==='quarantine_video'){
    if(!/^\d{16,24}$/.test(input.video_id||''))throw Error('隔离视频ID无效');
    const status=`待人工核验:${run}`;
    const result=await pool.query(`UPDATE zenithjoy.leadgen_videos SET process_status=$4,updated_at=now()
      WHERE line_key=$1 AND video_id=$2 AND process_status=$3 RETURNING video_id`,[lineKey,input.video_id,`处理中:${run}`,status]);
    if(result.rowCount!==1)throw Error('视频隔离CAS未确认，租约或owner已变化');
    const actual=(await pool.query('SELECT video_id,process_status FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2',[lineKey,input.video_id])).rows;
    if(actual.length!==1||actual[0].video_id!==input.video_id||actual[0].process_status!==status)throw Error('视频隔离持久读回未确认');
    return {quarantined:true,video_id:input.video_id,process_status:status};
  }
  if (['renew_video', 'release_video'].includes(op)) {
    const status = op === 'renew_video' ? `处理中:${run}` : '待判定';
    const result = await pool.query(`UPDATE zenithjoy.leadgen_videos SET process_status=$4,updated_at=now()
      WHERE line_key=$1 AND video_id=$2 AND process_status=$3 RETURNING video_id`,
    [lineKey, input.video_id, `处理中:${run}`, status]);
    if (result.rowCount !== 1) throw Error('视频租约已失效');
    return { renewed: op === 'renew_video', released: op === 'release_video' };
  }
  if(op==='reject_recording'){
    const p=input.recording;
    if(!/^\d{16,24}$/.test(input.video_id||'')||p?.version!==2||p.run!==run||p.video_id!==input.video_id
      ||p.evidence_id!==`${run}-v${input.video_id}-qualification-record`||p.media_volume_verified!==true
      ||!Number.isSafeInteger(p.media_volume)||p.media_volume<=0||p.audio_status!=='silent'
      ||p.playback_verified!==true||p.playback_proof_kind!=='native_audio'||p.playback_package!=='com.ss.android.ugc.aweme'
      ||typeof p.mean_volume_db!=='number'||!Number.isFinite(p.mean_volume_db)||p.mean_volume_db>-80)throw Error('本轮录音拒绝证据不符');
    const nativePhases=['start','end'].map(phase=>{const n=p.native_audio?.[phase],prefix=p.evidence_id+'-playback-'+phase;
      if(n?.state!=='started'||n.package_uid_verified!==true||n.foreign_started!==0||!['uid','pid','piid'].every(k=>Number.isSafeInteger(n[k])&&n[k]>0)
        ||!['evidence','package_uid','uid_owners'].every((k,i)=>n[k+'_file']===prefix+'.'+['audio.txt','package-uid.txt','uid-owners.txt'][i]&&/^[0-9a-f]{64}$/.test(n[k+'_sha256']||'')))throw Error('本轮录音native播放证据不符');return n;});
    if(nativePhases[0].uid!==nativePhases[1].uid)throw Error('本轮录音native UID发生变化');
    return transaction(pool,async client=>{
      const reason='本轮录音核验拒绝:静音音轨';
      const result=await client.query(`UPDATE zenithjoy.leadgen_videos SET judgment_status='rejected',judgment_reason=$4,updated_at=now()
        WHERE line_key=$1 AND video_id=$2 AND process_status=$3 AND judgment_status='pending' RETURNING video_id`,[lineKey,input.video_id,`处理中:${run}`,reason]);
      if(result.rowCount!==1)throw Error('本轮录音拒绝租约或判定已失效');
      const actual=(await client.query('SELECT video_id,judgment_status,judgment_reason,process_status FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2',[lineKey,input.video_id])).rows[0];
      if(actual?.video_id!==input.video_id||actual.judgment_status!=='rejected'||actual.judgment_reason!==reason||actual.process_status!==`处理中:${run}`)throw Error('本轮录音拒绝PG独立读回失败');
      return {verified:true,video_id:actual.video_id,verdict:'rejected',kind:'recording_silent',reason};
    });
  }
  if(op==='comment_history'||op==='comment_history_readback'){
    if(!sourceRun)throw Error('历史读取缺受信上游运行号');
    if(!/^\d{16,24}$/.test(input.video_id||'')||typeof input.video_url!=='string')throw Error('历史视频身份无效');
    const statusGuard=op==='comment_history'?"process_status=$3":"(process_status=$3 OR (process_status='评论已采' AND harvest_batch=$5))";
    const owned=(await pool.query(`SELECT video_id,video_url,title,
      (SELECT count(*) FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$4) AS url_bindings
      FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2 AND ${statusGuard} AND video_url=$4 AND judgment_status='matched'`,
      (op==='comment_history'?[lineKey,input.video_id,`处理中:${run}`,input.video_url]:[lineKey,input.video_id,`处理中:${run}`,input.video_url,run]))).rows[0];
    if(!owned)throw Error('历史读取租约或视频URL不符');
    const receipt={version:1,line:input.line,line_key:lineKey,run,source_run:sourceRun,video_id:input.video_id,video_url:input.video_url,observed_at:new Date().toISOString(),rows:[]};
    if(op==='comment_history_readback'&&input.history?.length&&Number(owned.url_bindings)!==1)throw Error('历史读回URL归属不唯一');
    if(op==='comment_history'&&Number(owned.url_bindings)!==1)return {...receipt,status:'unknown',reason:'video_url_ambiguous'};
    const rows=(await pool.query('SELECT id,douyin_id,comment_body,source_video_url FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND source_video_url=$2 LIMIT 1001',[lineKey,input.video_url])).rows;
    if(rows.length>1000)return {...receipt,status:'unknown',reason:'historical_candidates_exceed_bound'};
    const urlProofs=[];
    if(op==='comment_history' && typeof owned.title==='string' && owned.title.trim()){
      const candidates=(await pool.query('SELECT id,douyin_id,comment_body,source_video_url FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND source_video=$2 ORDER BY collected_at DESC LIMIT 1001',[lineKey,owned.title])).rows;
      const aliases=[...new Set(candidates.map(r=>r.source_video_url).filter(u=>u&&u!==input.video_url))];
      if(candidates.length>1000||aliases.length>4)return {...receipt,status:'unknown',reason:'historical_candidates_exceed_bound'};
      const proofs=await Promise.allSettled(aliases.map(url=>historyUrlProof(url,input.video_id,deps)));
      for(const result of proofs){if(result.status!=='fulfilled')continue;
        const proof=result.value;urlProofs.push(proof);
        for(const r of candidates.filter(r=>r.source_video_url===proof.source_video_url))if(!rows.some(a=>a.id===r.id))rows.push(r);
      }
    }
    if(op==='comment_history_readback'){
      const wanted=input.history;
      if(!Array.isArray(wanted)||new Set(wanted.map(r=>r.id)).size!==wanted.length)throw Error('历史读回清单无效');
      if(wanted.length)await validateHistoryRows(pool,lineKey,input,wanted,deps);
      return {verified:true,video_id:input.video_id,ids:wanted.map(r=>r.id),history_verified:wanted.length};
    }
    if(rows.some(r=>!r.douyin_id||!r.comment_body)||new Set(rows.map(r=>JSON.stringify([r.douyin_id,r.comment_body]))).size!==rows.length)return {...receipt,status:'unknown',reason:'historical_identity_incomplete'};
    return {...receipt,status:'verified',rows,...(urlProofs.length?{url_proofs:urlProofs}:{})};
  }
  if (op === 'collect' || op === 'collect_partial') {
    return transaction(pool, async client => {
      const owned = await client.query(`SELECT video_id,judgment_status,video_url,
        (SELECT count(*) FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_url=$4) AS url_bindings FROM zenithjoy.leadgen_videos
        WHERE line_key=$1 AND video_id=$2 AND process_status=$3 FOR UPDATE`, [lineKey, input.video_id, `处理中:${run}`,input.video_url||null]);
      if (owned.rows[0]?.judgment_status !== 'matched') throw Error('只许采集持有租约的合格视频');
      const old=input.history||[];
      if(!Array.isArray(old)||old.length>100000||new Set(old.map(r=>r.id)).size!==old.length)throw Error('历史消费清单无效');
      if(old.length){
        if(owned.rows[0].video_url!==input.video_url||Number(owned.rows[0].url_bindings)!==1)throw Error('历史视频URL归属不唯一');
        if(old.some(r=>!/^[-a-f0-9]{36}$/i.test(r.id||'')||!r.douyinId||!r.commentBody))throw Error('历史消费身份无效');
        await validateHistoryRows(client,lineKey,input,old,deps);
      }
      const coverage=new Set([...old,...(input.comments||[])].map(r=>JSON.stringify([r.douyinId,r.commentBody]))).size;
      let inserted = 0;
      for (const comment of input.comments || []) {
        if (!comment.nickname || !comment.commentBody) throw Error('评论身份或正文缺失');
        if(comment.recipientEvidence?.status==='verified'){
          const e=comment.recipientEvidence;
          if(e.scope?.video_id!==input.video_id)throw Error('recipient采集归属错误');
          const companyBinding=e.company_binding===undefined?undefined:await require('./company-config-lib.js').readCollectionAccountBinding(client,{lineKey,run,sourceRun});
          require('./queued-recipient-evidence.js').validateEvidence(e,{line_key:lineKey,run,douyin_id:comment.douyinId,nickname:comment.nickname,comment_body:comment.commentBody,comment_body_sha256:require('./queued-recipient-evidence.js').hash(comment.commentBody),video_url:comment.sourceVideoUrl},{companyBinding});
        }
        const result = await db.upsertComment(client, { ...comment, lineKey, harvestBatch: run });
        if (result.inserted) inserted++;
      }
      // 软预算只提交已核验评论；视频保持租约，交清场释放，不伪造“评论已采”。
      if (op === 'collect_partial') return { inserted, comments: (input.comments || []).length, video_id: input.video_id, status: 'partial',history_verified:old.length,coverage };
      const result = await db.markVideoCollected(client, { lineKey, videoId: input.video_id, commentCount: coverage });
      if (!result.updated) throw Error('评论已写但视频完成状态未确认');
      return { inserted, comments: (input.comments || []).length, video_id: input.video_id,history_verified:old.length,coverage };
    });
  }
  if (op === 'score') {
    const legacyRecovery=require('./leadgen-legacy-score-recovery.js');
    const legacy=legacyRecovery.validate(input,lineKey,sourceRun);
    const cursor=input.cursor??null;
    if(cursor!==null&&(!cursor||typeof cursor!=='object'||Array.isArray(cursor)
      ||Object.keys(cursor).sort().join(',')!=='collected_at,id,line,run,source_run'
      ||cursor.line!==lineKey||cursor.run!==run||cursor.source_run!==(sourceRun||null)
      ||!uuid.test(cursor.id||'')||typeof cursor.collected_at!=='string'
      ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(cursor.collected_at)
      ||!Number.isFinite(Date.parse(cursor.collected_at))))throw Error('POLICY_SCORE_CURSOR_INVALID');
    if(input.blocked_ids!==undefined&&(!Array.isArray(input.blocked_ids)||input.blocked_ids.length>1000
      ||input.blocked_ids.some(id=>!uuid.test(id))||new Set(input.blocked_ids).size!==input.blocked_ids.length))throw Error('POLICY_SCORE_BLOCKED_IDS_INVALID');
    if(input.ids!==undefined&&(!sourceRun&&!validSources(input.ids,input.sources)||!Array.isArray(input.ids)||input.ids.length>1000
      ||input.ids.some(id=>!uuid.test(id))||new Set(input.ids).size!==input.ids.length))throw Error('POLICY_SCORE_IDS_INVALID');
    if(input.budget_max!==undefined&&(!Number.isSafeInteger(input.budget_max)||input.budget_max<1||input.budget_max>50
      ||!sourceRun&&!validSources(input.ids,input.sources)||input.ids===undefined))throw Error('POLICY_SCORE_BUDGET_INVALID');
    const snapshot = await (deps.freezeCompanyConfig || freezeCompanyConfig)(pool, { lineHint: input.line, runId: run, sourceRun, step: '103' });
    const targetProfile = configTargetProfile(snapshot, '103');
    const evidence = configEvidence(snapshot, run);

    let scored = 0,blocked=0,lastCursor=cursor;const ids=[],blockedIds=[...(input.blocked_ids||[])],blocked_reasons=[],seen=new Set(blockedIds);
    while(scored<limit&&seen.size<1000){
      let result;
      try{result = await transaction(pool, async client => {
        if(input.budget_max!==undefined){
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`leadgen-score:${lineKey}:${run}:${sourceRun}`]);
          const count=(await client.query(`SELECT count(*)::int AS used FROM zenithjoy.leadgen_comments
            WHERE line_key=$1 AND ($2::text IS NULL OR harvest_batch=$2) AND judgment_config->>'run_id'=$3`,[lineKey,sourceRun,run])).rows;
          if(count.length!==1||!Number.isSafeInteger(count[0].used)||count[0].used<0)throw Error('POLICY_SCORE_BUDGET_UNKNOWN');
          if(count[0].used>=input.budget_max)return false;
        }
        const rows = (await client.query(`SELECT * FROM zenithjoy.leadgen_comments
          WHERE line_key=$1 AND process_status='待分拣' ${legacy?"AND id=$7 AND relevance IS NOT NULL":"AND relevance IS NULL"}
          AND ($2::text IS NULL OR harvest_batch=$2)
          AND id<>ALL($3::uuid[])
          AND ($4::timestamptz IS NULL OR (collected_at,id)>($4::timestamptz,$5::uuid))
          AND ($6::uuid[] IS NULL OR id=ANY($6::uuid[]))
          ORDER BY collected_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [lineKey,sourceRun,[...seen],cursor?.collected_at||null,cursor?.id||null,input.ids||null,...(legacy?[input.legacy_recovery.comment_id]:[])])).rows;
        if (!rows.length) return false;
        const row = rows[0];
        if(legacy)await legacyRecovery.verify(client,row,snapshot,deps);
        if(input.sources&&row.harvest_batch!==input.sources[row.id])throw Error('POLICY_SCORE_ROW_SOURCE_CHANGED');
        const nextCursor=row.collected_at&&uuid.test(row.id)?{line:lineKey,run,source_run:sourceRun||null,
          collected_at:new Date(row.collected_at).toISOString(),id:row.id}:null;
        const videos=(await client.query(`SELECT video_id,video_url,title,judgment_status FROM zenithjoy.leadgen_videos
          WHERE line_key=$1 AND video_url=$2 AND process_status='评论已采' AND harvest_batch=$3`,[lineKey,row.source_video_url,row.harvest_batch])).rows;
        if(videos.length!==1||videos[0].title!==row.source_video||videos[0].judgment_status!=='matched'){
          const error=Error('POLICY_VIDEO_SCOPE_INVALID');error.blocked_id=row.id;error.next_cursor=nextCursor;throw error;
        }
        let verdict;
        try{verdict=await deps.judgeComment(row.comment_body, row.source_video, targetProfile,
          { scoringRules: snapshot.runtime_config.comment_scoring });}
        catch(cause){
          const failure=scoreFailureReceipt(cause);
          const error=Error(failure.code);error.score_failure=failure;
          error.blocked_id=row.id;error.next_cursor=nextCursor;throw error;
        }
        if (!['相关', '不相关'].includes(verdict?.relevance)
            || verdict.relevance === '相关' && !['A', 'B', 'C'].includes(verdict.grade)) {
          const error=Error('POLICY_SCORE_MODEL_INVALID');error.blocked_id=row.id;error.next_cursor=nextCursor;throw error;
        }
        if(!verdict.audit?.model||!verdict.audit?.response_id){const error=Error('POLICY_SCORE_MODEL_IDENTITY_MISSING');
          error.blocked_id=row.id;error.next_cursor=nextCursor;throw error;}
        const judged={...row,relevance:verdict.relevance,intent_grade:verdict.relevance==='相关'?verdict.grade:null,
          judgment_reason:verdict.reason,judgment_config:evidence};
        const semantic=await dualPolicyReview(judged,snapshot,deps);
        if(semantic.status!=='pass'){const error=Error('POLICY_SCORE_NOT_VERIFIED');error.blocked_id=row.id;error.next_cursor=nextCursor;const reason=safePolicyReviewReason(semantic.reason);if(reason)error.score_failure={code:error.message,policy_review_reason:reason};throw error;}
        const audit={...evidence,model_audit:verdict.audit||null,policy_audit:semantic.reviews[0],policy_reviews:semantic.reviews};
        // 保留待分拣，交下一活动标记人；模型异常回滚，下一轮仍可重判。
        await client.query(`UPDATE zenithjoy.leadgen_comments SET relevance=$2,intent_grade=$3,
          judgment_reason=$4,judgment_config=$5::jsonb,updated_at=now() WHERE id=$1`, [row.id, verdict.relevance,
          verdict.relevance === '相关' ? verdict.grade : null, verdict.reason, JSON.stringify(audit)]);
        return {id:row.id,cursor:nextCursor};
      });}catch(error){
        if(error.blocked_id&&!seen.has(error.blocked_id)){seen.add(error.blocked_id);blockedIds.push(error.blocked_id);blocked_reasons.push({id:error.blocked_id,...(error.score_failure||{code:error.message})});blocked++;if(error.next_cursor)lastCursor=error.next_cursor;continue;}
        throw error;
      }
      if (!result) break;
      scored++;
      ids.push(result.id);seen.add(result.id);if(result.cursor)lastCursor=result.cursor;
    }
    return { scored, ids,blocked,blocked_ids:blockedIds,blocked_reasons,next_cursor:lastCursor,config: evidence,
      ...(blockedIds.length?{status:'partial',reason:'POLICY_SCORE_NOT_VERIFIED'}:
        scored===0?{status:'partial',reason:'POLICY_SCORE_NO_ELIGIBLE_ROWS'}:{}) };
  }
  if(op==='bridge_readback')return require('./leadgen-outreach-bridge.js').readbackBridge(pool,input);
  if(op==='bridge_outreach')return require('./leadgen-outreach-bridge.js').bridgeOutreach(pool,input,deps);
  if (op === 'mark_leads') {
    const cursor=input.cursor??null;
    if(cursor!==null&&(!cursor||typeof cursor!=='object'||Array.isArray(cursor)
      ||Object.keys(cursor).sort().join(',')!=='collected_at,id,line,run,source_run'
      ||cursor.line!==lineKey||cursor.run!==run||cursor.source_run!==(sourceRun||null)
      ||!uuid.test(cursor.id||'')||typeof cursor.collected_at!=='string'
      ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(cursor.collected_at)
      ||!Number.isFinite(Date.parse(cursor.collected_at))))throw Error('POLICY_MARK_CURSOR_INVALID');
    const bridgeConfig=await (deps.freezeCompanyConfig||freezeCompanyConfig)(pool,{lineHint:input.line,runId:run,sourceRun,step:'103'});
    let marked = 0, created = 0, repeats = 0, blocked=0,lastCursor=cursor;const ids=[],lead_ids=[],seen=[];const recipient_calls={model_call_count:0,passed:0,excluded:0,unknown:0};
    while(marked<limit&&seen.length<1000){
      const result = await transaction(pool, async client => {
        // 同业务线的人员去重串行化；评论行与人员更新一起提交，崩溃重跑不增加虚假重复次数。
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`leadgen-people:${lineKey}`]);
        const row = (await client.query(`SELECT * FROM zenithjoy.leadgen_comments
          WHERE line_key=$1 AND process_status='待分拣' AND relevance IS NOT NULL
          AND ($2::text IS NULL OR harvest_batch=$2)
          AND id<>ALL($3::uuid[])
          AND ($4::timestamptz IS NULL OR (collected_at,id)>($4::timestamptz,$5::uuid))
          ORDER BY collected_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [lineKey,sourceRun,seen,cursor?.collected_at||null,cursor?.id||null])).rows[0];
        if (!row) return null;
        seen.push(row.id);
        if(row.collected_at&&uuid.test(row.id))lastCursor={line:lineKey,run,source_run:sourceRun||null,collected_at:new Date(row.collected_at).toISOString(),id:row.id};
        if(row.relevance==='相关'){
          const policy=await reviewBoundComment(client,lineKey,row.id,{run,scoring_run:row.judgment_config?.run_id,
            source_run:row.harvest_batch,source_video:row.source_video,source_video_url:row.source_video_url},deps);
          if(policy.status!=='pass')return {blocked:true,id:row.id};
        }
        let lead = null;
        if (row.relevance === '相关') lead = await db.upsertLead(client, { lineKey,
          nickname: row.nickname, douyinId: row.douyin_id, profileUrl: row.profile_url,
          commentBody: row.comment_body, sourceVideo: row.source_video,
          aiJudgmentReason: `[${row.intent_grade}] ${row.judgment_reason || ''}` });
        let bridge=null;
        if(lead)bridge=await require('./leadgen-outreach-bridge.js').enqueueBridge(client,{lineKey,run,sourceRun,comment:row,lead,config:bridgeConfig},deps);
        await db.markCommentJudgment(client, { lineKey, dedupKey: row.dedup_key,
          relevance: row.relevance, intentGrade: row.intent_grade, reason: row.judgment_reason });
        return { lead, id:row.id, qualification:bridge?.qualification };
      });
      if (!result) break;
      if(result.blocked){blocked++;continue;}
      marked++;
      if(result.qualification){recipient_calls[result.qualification.status]++;const count=result.qualification.model_call_count;recipient_calls.model_call_count+=Number.isSafeInteger(count)&&count>=0?count:0;}
      ids.push(result.id);if(result.lead)lead_ids.push(result.lead.id);
      if (result.lead?.created) created++; else if (result.lead) repeats++;
    }
    return { marked, created, repeats, blocked, ids, lead_ids, recipient_calls,
      ...(blocked||seen.length>=1000&&marked<limit?{status:'partial'}:{}),
      ...(seen.length>=1000&&marked<limit?{next_cursor:lastCursor}:{}) };
  }
  if(['score_readback','mark_readback'].includes(op)){
    const ids=input.ids,leads=input.lead_ids||[];
    if(!Array.isArray(ids)||ids.length>50||!Array.isArray(leads)||leads.length>50
      ||[...ids,...leads].some(id=>!/^[-a-zA-Z0-9]{1,80}$/.test(id)))throw Error('读回ID列表无效');
    const rows=ids.length?(await pool.query('SELECT id,relevance,intent_grade,process_status FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=ANY($2::uuid[])',[lineKey,ids])).rows:[];
    const leadRows=leads.length?(await pool.query('SELECT id FROM zenithjoy.leadgen_leads WHERE line_key=$1 AND id=ANY($2::uuid[])',[lineKey,leads])).rows:[];
    const related=op==='mark_readback'?rows.filter(r=>r.relevance==='相关').map(r=>r.id):[];
    const outbox=related.length?(await pool.query('SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND comment_id=ANY($2::uuid[]) AND run_tag=$3',[lineKey,related,run])).rows:[];
    const bridgeFailures=related.filter(id=>{const matches=outbox.filter(r=>r.comment_id===id);if(matches.length!==1)return true;const b=matches[0],p=b.payload;return !p||b.line_key!==lineKey||p.line_key!==lineKey||p.comment_id!==id||p.lead_id!==b.lead_id||!leads.includes(b.lead_id)||require('./leadgen-outreach-bridge.js').digest(p)!==b.payload_sha256;}).length;
    const failures=bridgeFailures+ids.filter(id=>{const row=rows.find(r=>r.id===id);
      return !row||!['相关','不相关'].includes(row.relevance)||row.relevance==='相关'&&!['A','B','C'].includes(row.intent_grade)
        ||op==='mark_readback'&&row.process_status!=='已分拣';}).length
      +leads.filter(id=>!leadRows.some(r=>r.id===id)).length;
    return {verified:failures===0,failures,ids,lead_ids:leads};
  }
  throw Error(`未知队列操作: ${op}`);
}

async function main() {
  let pool;
  try {
    const fs = require('fs');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    pool = require('./leadgen-db-connect.js').getPool();
    const result = await queueRequest(pool, input);
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (error) {
    // stdout只发错误类型；远端调用异常可能含URL、Authorization等。
    process.stdout.write(JSON.stringify({ ok: false, error: 'QUEUE_OPERATION_FAILED', code: error.code || null }) + '\n');
    process.exitCode = 1;
  } finally { if (pool) await pool.end(); }
}
if (require.main === module) main();
module.exports = { queueRequest, transaction, evaluatePolicy, reviewBoundComment };
