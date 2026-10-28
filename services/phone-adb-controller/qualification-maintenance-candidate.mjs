import {digest} from './runtime-definition.mjs';
import {verifyTargetRelease} from './deployment-targets.mjs';
const need=value=>{if(!value)throw Error('MAINTENANCE_CANDIDATE_NOT_ADMITTED');};
// 独立维护仅需正常CI+隔离候选可执行准入；不以尚待修复的102业务PASS作为前置。
export async function verifyMaintenanceCandidate({scope},{request,collect}) {
 const s=scope.maintenance_source,repo='perfectuser21/zenithjoy-workspace';
 need(/^[a-f0-9]{40}$/.test(s?.commit||'')&&s.environment==='staging:'+s.commit);
 const authoritative={};
 await Promise.all(['mmv','xian-m4'].map(async target=>{
  const refs=s.releases[target];need(refs);
  const endpoint='/releases/'+refs.id;
  const [releaseReply,gate,observationReply]=await Promise.all([request(endpoint),request(endpoint+'/gate'),request(endpoint+'/observations/'+refs.observation_id)]);
  const release=releaseReply?.release,observation=observationReply?.observation;
  verifyTargetRelease(release,target,s.commit,undefined,s.environment);
  need(release.id===refs.id&&gate?.release_id===refs.id&&gate.deployed===true&&gate.actual_matches===true
   &&gate.current_status==='deployed'&&gate.current_observation_id===refs.observation_id&&Array.isArray(gate.gaps)&&gate.gaps.length===0);
  need(observation?.id===refs.observation_id&&observation.release_id===refs.id&&observation.payload_sha256===digest(observation.payload)
   &&observation.payload?.target===target&&observation.payload.environment===s.environment
   &&digest(observation.payload.components)===digest(release.payload.components));
  authoritative[target]={release,gate,observation};
 }));
 const measurements={};
 // M4通道只有一个有界采集，不并发多次SSH/安装，也不POST补写观测。
 for(const target of ['mmv','xian-m4']) {
  const actual=await collect(target),refs=s.releases[target];
  need(typeof actual?.manifest_raw==='string'&&actual.manifest_raw.length<8*1024*1024);
  const raw=Buffer.from(actual.manifest_raw,'base64');need(raw.toString('base64')===actual.manifest_raw&&digest(raw)===refs.manifest_raw_sha256);
  const manifest=JSON.parse(raw),observed=actual.observed;
  need(manifest.source_repo===repo&&manifest.source_commit===s.commit&&manifest.target===target&&manifest.environment===s.environment
   &&manifest.release_id===refs.id&&manifest.observation_id===refs.observation_id&&manifest.files?.length>0
   &&observed?.source_repo===repo&&observed.source_commit===s.commit&&digest(observed.files)===digest(manifest.files));
  for(const c of authoritative[target].release.payload.components.filter(c=>c.kind!=='repo')) {
   const rows=observed.files.filter(f=>f.path===c.path);need(rows.length===1&&c.digest==='sha256:'+rows[0].content_sha256);
  }
  measurements[target]={manifest_raw_sha256:digest(raw),file_count:observed.files.length,observed_sha256:digest(observed)};
 }
 return {status:'verified',source_commit:s.commit,environment:s.environment,business_outcome:'not_evaluated',measurements,
  six_gets_sha256:digest(authoritative)};
}
