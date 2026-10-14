'use strict';
// 私有原生主页/返回/实际VID原件。只读取证，不新增UI动作。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {routeOf}=require('./line-routes.js');
const {decodeXmlEntities}=require('./nickname-match-lib.js');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function parseNative(profile,returned,{nickname,douyinId,commentBody,commentEncoding='canonical'}){
 if(!['xml_raw','canonical'].includes(commentEncoding))throw Error('RECIPIENT_BODY_ENCODING_INVALID');
 const r=spawnSync('python3',['-c',`import json,sys,re,xml.etree.ElementTree as E
v=json.load(sys.stdin);pkg='com.ss.android.ugc.aweme'
def nodes(s):
 if '<!DOCTYPE' in s or '<!ENTITY' in s: raise ValueError('doctype')
 root=E.fromstring(s);ns=list(root.iter('node'))
 if root.tag!='hierarchy' or not ns or any(n.get('package')!=pkg for n in ns): raise ValueError('package')
 return ns
p=nodes(v['profile']);b=nodes(v['returned'])
ids=[n.get('text','')[4:] for n in p if n.get('text','').startswith('抖音号：')]
if ids!=[v['douyinId']]: raise ValueError('uid')
if sum(n.get('text')==v['nickname'] and n.get('content-desc')==v['nickname']+'，复制名字和修改备注' for n in p)!=1: raise ValueError('nickname')
headers=[n for n in b if n.get('class')=='android.widget.TextView' and ((n.get('resource-id')==pkg+':id/title' and re.fullmatch(r'[0-9万.]+条评论',n.get('text',''))) or (n.get('resource-id')==pkg+':id/ez-' and re.fullmatch(r'评论 [0-9万.]+',n.get('text',''))))]
if not headers or not any(n.get('resource-id')==pkg+':id/ety' and n.get('class')=='android.widget.EditText' for n in b): raise ValueError('panel')
def exact_comment(n):
 if n.get('resource-id')!=pkg+':id/fhn' or n.get('class')!='android.widget.FrameLayout' or n.get('text','')!='': return False
 m=re.fullmatch(re.escape(v['nickname'])+r',(.+),[^,]*, · [^,]*,回复 按钮(?:,.*)?',n.get('content-desc',''))
 return bool(m and m.group(1)==v['commentBody'])
if not any(n.get('text')==v['nickname'] for n in b) or not (any(exact_comment(n) for n in b) or any(n.get('text')==v['commentBody'] for n in b)): raise ValueError('returned_comment')
texts=list(dict.fromkeys(s for n in p for s in [n.get('text',''),n.get('content-desc','')] if s))
print(json.dumps({'native_profile_texts':texts,'native_profile_verified':True,'returned_comment_verified':True},ensure_ascii=False))
`],{input:JSON.stringify({profile,returned,nickname,douyinId,commentBody:commentEncoding==='xml_raw'?decodeXmlEntities(commentBody):commentBody}),encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024});
 if(r.status!==0)throw Error('RECIPIENT_NATIVE_PROOF_INVALID');
 return JSON.parse(r.stdout);
}
function validateEvidence(e,scope){
 if(e?.version!==1||e.status!=='verified'||!e.scope||!e.raw||!e.sha256)throw Error('RECIPIENT_EVIDENCE_MISSING');
 for(const key of ['line_key','run','douyin_id','nickname','comment_body_sha256','video_url'])if(e.scope[key]!==scope[key])throw Error('RECIPIENT_SCOPE_INVALID');
 if(!['xml_raw','canonical'].includes(e.scope.comment_encoding))throw Error('RECIPIENT_BODY_ENCODING_MISSING');
 if(!routeOf(scope.line_key).profiles.includes(e.scope.profile))throw Error('RECIPIENT_PROFILE_SCOPE_INVALID');
 if(!/^\d{16,24}$/.test(e.scope.video_id||'')||e.video_identity?.verified!==true||e.video_identity.content_type!=='video'||e.video_identity.expected_video_id!==e.scope.video_id||e.video_identity.observed_video_id!==e.scope.video_id||e.video_identity.evidence_id!==e.scope.video_identity_eid)throw Error('RECIPIENT_VIDEO_ID_INVALID');
 const prefix=e.scope.run+'-v'+e.scope.video_id+'-collection',row=e.scope.profile_eid?.match(new RegExp('^'+prefix+'-person([1-9][0-9]*)-t[123]$'))?.[1];
 if(!row||e.scope.video_identity_eid!==prefix+'-after-card'+row)throw Error('RECIPIENT_PAIR_INVALID');
 for(const k of ['profile','returned'])if(typeof e.raw[k]!=='string'||Buffer.byteLength(e.raw[k])>4*1024*1024||hash(e.raw[k])!==e.sha256[k])throw Error('RECIPIENT_BYTES_INVALID');
 return parseNative(e.raw.profile,e.raw.returned,{nickname:scope.nickname,douyinId:scope.douyin_id,commentBody:scope.comment_body,commentEncoding:e.scope.comment_encoding});
}
function capture({runDir,line,run,sourceRun,videoId,videoUrl,profile,douyinId,nickname,commentBody,started,profilePath,returnedPath,profileEid,videoEid,commentEncoding='canonical'}){
 if(!Number.isSafeInteger(Number(started))||Number(started)<=0||Number(started)*1000>Date.now()+1000)throw Error('RECIPIENT_TIME_INVALID');
 const scope={comment_encoding:commentEncoding,line_key:routeOf(line).key,run,source_run:sourceRun||null,video_id:videoId,video_url:videoUrl,profile,douyin_id:douyinId,nickname,comment_body_sha256:hash(commentBody),profile_eid:profileEid,video_identity_eid:videoEid};
 const root=path.join(process.env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone','evidence',profile);
 const read=(file,name)=>{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4*1024*1024||st.mtimeMs<Number(started)*1000||path.dirname(fs.realpathSync(file))!==fs.realpathSync(root)||path.basename(file)!==name)throw Error('RECIPIENT_FRESH_FILE_INVALID');return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));};
 const raw={profile:read(profilePath,profileEid+'-profile.xml'),returned:read(returnedPath,profileEid+'-returned.xml')};
 const vf=path.join(runDir,run+'-identity-'+videoId+'.json'),st=fs.lstatSync(vf);
 if(st.isSymbolicLink()||!st.isFile()||st.mtimeMs<Number(started)*1000||path.dirname(fs.realpathSync(vf))!==fs.realpathSync(runDir))throw Error('RECIPIENT_VIDEO_FILE_INVALID');
 const e={version:1,status:'verified',scope,raw,sha256:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,hash(v)])),video_identity:JSON.parse(fs.readFileSync(vf,'utf8')),observed_at:new Date().toISOString()};
 validateEvidence(e,{...scope,comment_body:commentBody});
 const file=path.join(runDir,profileEid+'-recipient.json');fs.writeFileSync(file,JSON.stringify(e),{flag:'wx',mode:0o600});
 return {file,sha256:hash(fs.readFileSync(file)),body_sha256:scope.comment_body_sha256};
}
if(require.main===module){try{
 const [runDir,line,run,sourceRun,videoId,videoUrl,profile,douyinId,nickname,commentBody,started,profilePath,returnedPath,profileEid,videoEid,commentEncoding]=process.argv.slice(2);
 // 旧mock/旧来源缺原件时保持unknown；现有身份核验依然先严格完成。
 if(!profilePath||!returnedPath){console.log(`RECIPIENT_UNKNOWN\t${videoId}\t${douyinId}\t${hash(commentBody)}\tnative_profile_missing`);}
 else {const p=capture({runDir,line,run,sourceRun,videoId,videoUrl,profile,douyinId,nickname,commentBody,started,profilePath,returnedPath,profileEid,videoEid,commentEncoding});console.log(`RECIPIENT_PROOF\t${videoId}\t${douyinId}\t${p.body_sha256}\t${p.file}\t${p.sha256}`);}
}catch{process.stderr.write('RECIPIENT_EVIDENCE_FAILED\n');process.exitCode=8;}}
module.exports={hash,parseNative,validateEvidence,capture};
