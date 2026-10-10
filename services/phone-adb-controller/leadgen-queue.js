// 四流程持久队列入口；仅在mmv运行，设备端通过JSON stdin调用，不传递凭据。
'use strict';
const db = require('./leadgen-db-lib.js');
const { resolveLine } = require('./judge-video.js');
const { judgeComment } = require('./judge-comment.js');

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

async function queueRequest(pool, input, deps = { judgeComment }) {
  deps={judgeComment,...deps};
  const { lineKey, targetProfile } = resolveLine(input.line);
  const { op, run } = input;
  const sourceRun=input.source_run??null;
  if(sourceRun!==null&&!/^[a-zA-Z0-9_-]{1,120}$/.test(sourceRun))throw Error('上游运行号无效');
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(run || '')) throw Error('缺有效运行号');
  const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
  const videoIds=input.video_ids===undefined?null:input.video_ids;
  if(Object.hasOwn(input,'video_ids')&&(!Array.isArray(videoIds)||videoIds.length>1000||videoIds.some(id=>typeof id!=='string'||!/^\d{16,24}$/.test(id))))throw Error('视频ID清单无效');
  if(op==='inspect_videos'){
    if(videoIds===null)throw Error('缺明确视频ID清单');
    return (await pool.query('SELECT video_id,line_key,judgment_status,process_status,harvest_batch FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=ANY($2::text[])',[lineKey,videoIds])).rows;
  }
  if (op === 'history') {
    return (await pool.query('SELECT title,video_id FROM zenithjoy.leadgen_videos WHERE line_key=$1', [lineKey])).rows;
  }
  if (op === 'discover' || op === 'discover_readback') {
    const value = input.video;
    const row = value && { ...value, video_id: value.video_id ?? value.videoId, video_url: value.video_url ?? value.videoUrl };
    if (!/^\d{16,24}$/.test(row?.video_id || '') || !/^https:\/\/(?:v\.douyin\.com\/|www\.douyin\.com\/video\/)/.test(row?.video_url || '')) throw Error('候选视频身份无效');
    if(op==='discover_readback'){
      const result=await pool.query(`SELECT judgment_status, (transcript IS NOT NULL AND transcript <> '') AS has_transcript
        FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND video_id=$2 AND video_url=$3`,[lineKey,row.video_id,row.video_url]);
      const actual=result.rows[0];
      return actual?{status:actual.judgment_status,has_transcript:!!actual.has_transcript,inserted:false,recovered:true}:null;
    }
    return db.discoverVideo(pool, { lineKey, videoId: row.video_id, videoUrl: row.video_url, title: row.title, keyword: row.keyword, harvestBatch: run });
  }
  if (op === 'claim_videos') {
    return transaction(pool, async client => {
      // 待采的已合格视频也入队；上次崩溃的租约15分钟后可重领，活动内调用续期。
      const result = await client.query(`WITH pending AS (
        SELECT id FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND judgment_status<>'rejected'
        AND ($6::text[] IS NOT NULL OR $5::text IS NULL OR harvest_batch=$5)
        AND ($6::text[] IS NULL OR video_id=ANY($6::text[]))
        AND (process_status='待判定' OR process_status='待采评论'
          OR (process_status LIKE '处理中:%' AND updated_at<now()-interval '15 minutes'))
        ORDER BY CASE WHEN judgment_status='pending' THEN 0 ELSE 1 END, discovered_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        UPDATE zenithjoy.leadgen_videos v SET process_status=$3,harvest_batch=$4,updated_at=now()
        FROM pending p WHERE v.id=p.id RETURNING v.*`, [lineKey, limit, `处理中:${run}`, run, sourceRun, videoIds]);
      return result.rows;
    });
  }
  if (['renew_video', 'release_video'].includes(op)) {
    const status = op === 'renew_video' ? `处理中:${run}` : '待判定';
    const result = await pool.query(`UPDATE zenithjoy.leadgen_videos SET process_status=$4,updated_at=now()
      WHERE line_key=$1 AND video_id=$2 AND process_status=$3 RETURNING video_id`,
    [lineKey, input.video_id, `处理中:${run}`, status]);
    if (result.rowCount !== 1) throw Error('视频租约已失效');
    return { renewed: op === 'renew_video', released: op === 'release_video' };
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
    let scored = 0;const ids=[];
    for (let n = 0; n < limit; n++) {
      const result = await transaction(pool, async client => {
        const rows = (await client.query(`SELECT * FROM zenithjoy.leadgen_comments
          WHERE line_key=$1 AND process_status='待分拣' AND relevance IS NULL
          AND ($2::text IS NULL OR harvest_batch=$2)
          ORDER BY collected_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [lineKey,sourceRun])).rows;
        if (!rows.length) return false;
        const row = rows[0];
        const verdict = await deps.judgeComment(row.comment_body, row.source_video, targetProfile);
        if (!['相关', '不相关'].includes(verdict.relevance)
            || verdict.relevance === '相关' && !['A', 'B', 'C'].includes(verdict.grade)) throw Error('评论判定缺合法终态');
        // 保留待分拣，交下一活动标记人；模型异常回滚，下一轮仍可重判。
        await client.query(`UPDATE zenithjoy.leadgen_comments SET relevance=$2,intent_grade=$3,
          judgment_reason=$4,updated_at=now() WHERE id=$1`, [row.id, verdict.relevance,
          verdict.relevance === '相关' ? verdict.grade : null, verdict.reason]);
        return row.id;
      });
      if (!result) break;
      scored++;
      ids.push(result);
    }
    return { scored, ids };
  }
  if (op === 'mark_leads') {
    let marked = 0, created = 0, repeats = 0;const ids=[],lead_ids=[];
    for (let n = 0; n < limit; n++) {
      const result = await transaction(pool, async client => {
        // 同业务线的人员去重串行化；评论行与人员更新一起提交，崩溃重跑不增加虚假重复次数。
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`leadgen-people:${lineKey}`]);
        const row = (await client.query(`SELECT * FROM zenithjoy.leadgen_comments
          WHERE line_key=$1 AND process_status='待分拣' AND relevance IS NOT NULL
          AND ($2::text IS NULL OR harvest_batch=$2)
          ORDER BY collected_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [lineKey,sourceRun])).rows[0];
        if (!row) return null;
        let lead = null;
        if (row.relevance === '相关') lead = await db.upsertLead(client, { lineKey,
          nickname: row.nickname, douyinId: row.douyin_id, profileUrl: row.profile_url,
          commentBody: row.comment_body, sourceVideo: row.source_video,
          aiJudgmentReason: `[${row.intent_grade}] ${row.judgment_reason || ''}` });
        await db.markCommentJudgment(client, { lineKey, dedupKey: row.dedup_key,
          relevance: row.relevance, intentGrade: row.intent_grade, reason: row.judgment_reason });
        return { lead, id:row.id };
      });
      if (!result) break;
      marked++;
      ids.push(result.id);if(result.lead)lead_ids.push(result.lead.id);
      if (result.lead?.created) created++; else if (result.lead) repeats++;
    }
    return { marked, created, repeats, ids, lead_ids };
  }
  if(['score_readback','mark_readback'].includes(op)){
    const ids=input.ids,leads=input.lead_ids||[];
    if(!Array.isArray(ids)||ids.length>50||!Array.isArray(leads)||leads.length>50
      ||[...ids,...leads].some(id=>!/^[-a-zA-Z0-9]{1,80}$/.test(id)))throw Error('读回ID列表无效');
    const rows=ids.length?(await pool.query('SELECT id,relevance,intent_grade,process_status FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND id=ANY($2::uuid[])',[lineKey,ids])).rows:[];
    const leadRows=leads.length?(await pool.query('SELECT id FROM zenithjoy.leadgen_leads WHERE line_key=$1 AND id=ANY($2::uuid[])',[lineKey,leads])).rows:[];
    const failures=ids.filter(id=>{const row=rows.find(r=>r.id===id);
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
module.exports = { queueRequest, transaction };
