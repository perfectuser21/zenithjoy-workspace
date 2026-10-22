'use strict';
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {lstatSync,realpathSync,readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join,dirname,basename}=require('node:path');
const hash=value=>createHash('sha256').update(value).digest('hex');
const parser=`import sys,json,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read())
nodes=list(r.iter('node'))
if r.tag!='hierarchy' or not nodes or any(n.get('package') not in (None,'','com.ss.android.ugc.aweme') for n in nodes): raise ValueError('package')
print(json.dumps([n.get('content-desc','') for n in nodes],ensure_ascii=False))`;
function parseCount(raw){
 const match=/^(0|[1-9]\d*)(?:\.(\d+))?([万亿]?)$/.exec(raw);
 if(!match||match[2]&&!match[3])return {raw,value:null,reason:'unreadable_display'};
 const scale=match[3]==='亿'?8:match[3]==='万'?4:0,fraction=match[2]||'';
 if(fraction.length>scale)return {raw,value:null,reason:'inexact_display'};
 const value=BigInt(match[1]+fraction)*10n**BigInt(scale-fraction.length);
 return value<=BigInt(Number.MAX_SAFE_INTEGER)?{raw,value:Number(value)}:{raw,value:null,reason:'display_out_of_range'};
}
function nativeCounts(xml){
 if(typeof xml!=='string'||!xml.length||Buffer.byteLength(xml)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('METRICS_NATIVE_INVALID');
 const result=spawnSync('python3',['-c',parser],{input:xml,encoding:'utf8',timeout:2000,maxBuffer:1024*1024});
 if(result.status!==0)throw Error('METRICS_NATIVE_INVALID');
 const descriptions=JSON.parse(result.stdout);
 function read(pattern){
  const values=[...new Set(descriptions.map(v=>pattern.exec(v)?.[1]).filter(v=>v!==undefined))];
  if(values.length>1)throw Error('METRICS_NATIVE_AMBIGUOUS');
  return parseCount(values[0]??'');
 }
 const likes=read(/^(?:未点赞|已点赞)，喜欢(.*?)，按钮$/),comment_total=read(/^评论(.*?)，按钮$/);
 return {likes,comment_total,comment_tier:comment_total.value===null?'unknown':comment_total.value===0?'zero':comment_total.value<=100?'1_100':comment_total.value<=500?'101_500':'over_500'};
}
function buildObservation(input){
 const {run,run_id,profile,source_commit,line_key,video_id,video_url,observed_at,evidence_id,xml}=input;
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(run||'')||!/^[-A-Za-z0-9_]+$/.test(run_id||'')
   ||!run_id.startsWith('douyin_video_discovery-'+run+'__')||!/^a?[1-9]\d*$/.test(run_id.slice(('douyin_video_discovery-'+run+'__').length))||!/^[-A-Za-z0-9_.]+$/.test(profile||'')||!/^[-A-Za-z0-9_]+$/.test(line_key||'')||!/^\d{16,24}$/.test(video_id||'')
   ||video_url!==`https://www.douyin.com/video/${video_id}`||! /^[a-f0-9]{40}$/.test(source_commit||'')||typeof observed_at!=='string'||!Number.isFinite(Date.parse(observed_at))||new Date(observed_at).toISOString()!==observed_at
   ||typeof evidence_id!=='string'||!evidence_id.startsWith(run+'-candidate')||!/-link-t[1-3]$/.test(evidence_id)||!/^[A-Za-z0-9_-]+$/.test(evidence_id))throw Error('METRICS_SCOPE_INVALID');
 const observation={version:1,run,run_id,profile,source_commit,line_key,video_id,video_url,observed_at,evidence_id,...nativeCounts(xml),evidence:{kind:'android_ui_xml',sha256:hash(xml),xml}};
 return {...observation,digest:hash(JSON.stringify(observation))};
}
function validateObservation(observation,scope){
 if(!observation||typeof observation!=='object')throw Error('METRICS_OBSERVATION_REQUIRED');
 for(const key of ['run','run_id','profile','source_commit','line_key','video_id','video_url'])if(observation[key]!==scope[key])throw Error('METRICS_SCOPE_MISMATCH');
 if(typeof observation.evidence?.xml!=='string'||hash(observation.evidence.xml)!==observation.evidence.sha256)throw Error('METRICS_EVIDENCE_HASH_MISMATCH');
 const actual=buildObservation({...observation,xml:observation.evidence.xml});
 if(JSON.stringify(actual.likes)!==JSON.stringify(observation.likes)||JSON.stringify(actual.comment_total)!==JSON.stringify(observation.comment_total)||actual.comment_tier!==observation.comment_tier)throw Error('METRICS_DERIVATION_MISMATCH');
 if(actual.digest!==observation.digest)throw Error('METRICS_DIGEST_MISMATCH');
 if(Object.keys(actual).some(key=>JSON.stringify(actual[key])!==JSON.stringify(observation[key]))||Object.keys(actual).length!==Object.keys(observation).length)throw Error('METRICS_CONTRACT_MISMATCH');
 return actual;
}
function captureObservation({file,evidenceRoot,runDir,...scope}){
 const root=realpathSync(evidenceRoot),path=resolve(file),stat=lstatSync(path);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>1024*1024||realpathSync(dirname(path))!==root||basename(path)!==scope.evidence_id+'-share.xml')throw Error('METRICS_EVIDENCE_PATH_INVALID');
 const xml=readFileSync(path,'utf8'),observation=buildObservation({...scope,observed_at:stat.mtime.toISOString(),xml});
 const folder=join(runDir,'discovery-metrics');mkdirSync(folder,{recursive:true,mode:0o700});
 if(lstatSync(folder).isSymbolicLink()||realpathSync(dirname(folder))!==realpathSync(runDir))throw Error('METRICS_ARCHIVE_PATH_INVALID');
 const destination=join(folder,observation.digest+'.json'),bytes=JSON.stringify(observation);
 try{writeFileSync(destination,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;const st=lstatSync(destination);if(st.isSymbolicLink()||!st.isFile()||readFileSync(destination,'utf8')!==bytes)throw Error('METRICS_ARCHIVE_CHANGED');}
 return observation;
}
async function verifyArchivedObservations({videos,runDir,scope,readback}){
 try{
  if(!Array.isArray(videos)||videos.length>1000||new Set(videos.map(v=>v.videoId)).size!==videos.length)return false;
  for(const video of videos){
   const observation=validateObservation(video.metrics,{...scope,video_id:video.videoId,video_url:video.videoUrl});
   const folder=join(runDir,'discovery-metrics'),file=join(folder,observation.digest+'.json'),stat=lstatSync(file);
   if(lstatSync(folder).isSymbolicLink()||realpathSync(dirname(folder))!==realpathSync(runDir)||stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)||stat.size>2*1024*1024)return false;
   const archived=JSON.parse(readFileSync(file,'utf8'));
   if(JSON.stringify(archived)!==JSON.stringify(observation))return false;
   const actual=await readback(video);
   if(actual?.metrics_verified!==true||actual.metrics_digest!==observation.digest||actual.recovered!==true)return false;
  }
  return true;
 }catch{return false;}
}
module.exports={parseCount,buildObservation,validateObservation,captureObservation,verifyArchivedObservations};
