// 零评论只能由本run逐VID的新鲜UI和既有取链身份共同证明；不执行任何手机动作。
import {readFileSync,writeFileSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(reason='scope')=>{throw Error('NO_COMMENTS_EVIDENCE_UNVERIFIED:'+reason);};
const safe=(run,vid)=>{if(!/^[A-Za-z0-9_-]+$/.test(run||'')||!/^\d{16,24}$/.test(vid||''))fail();};
function read(file,dir){if(typeof file!=='string'||typeof dir!=='string')fail('path');try{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>10*1024*1024||realpathSync(dirname(file))!==realpathSync(dir))fail('file_identity');return readFileSync(file);}catch(e){if(e.message?.startsWith('NO_COMMENTS_'))throw e;fail('file_unreadable');}}
function zero(file){const r=spawnSync(process.env.DOUYIN_PYTHON_BIN||'python3',[join(here,'comment-count-evidence.py'),file],{encoding:'utf8',timeout:3000});if(r.status!==1||r.stdout||r.stderr)fail('xml_not_zero');}
function identity(bytes,run,vid){const p=JSON.parse(bytes),fields=String(p.controller_stdout||'').split('\n'),ids=fields.filter(s=>s.startsWith('video_id=')),kinds=fields.filter(s=>s.startsWith('content_type='));if(p.verified!==true||p.expected_video_id!==vid||p.observed_video_id!==vid||p.content_type!=='video'||p.excluded_non_video===true||p.evidence_id!==`${run}-v${vid}-collection-identity`||ids.length!==1||ids[0]!==`video_id=${vid}`||kinds.length!==1||kinds[0]!=='content_type=video')fail();}
export function verifyNoComments({runDir,run,videoId}){
 safe(run,videoId);const eid=`${run}-v${videoId}-collection-comments`,file=join(runDir,`${run}-no-comments-${videoId}.json`),p=JSON.parse(read(file,runDir));
 if(p.version!==1||p.run!==run||p.video_id!==videoId||p.evidence_id!==eid||p.state!=='zero'||p.xml_file!==eid+'-before.xml'||p.identity_file!==`${run}-identity-${videoId}.json`)fail();
 const xml=join(runDir,p.xml_file),bytes=read(xml,runDir),id=read(join(runDir,p.identity_file),runDir);
 if(sha(bytes)!==p.xml_sha256||sha(id)!==p.identity_sha256)fail('hash');zero(xml);identity(id,run,videoId);return p;
}
export function createNoComments({runDir,run,videoId,profile,stdout}){
 safe(run,videoId);const eid=`${run}-v${videoId}-collection-comments`,rows=stdout.trimEnd().split('\n');
 const expected=['comments_opened=0','reason=no_comments_on_this_video'];
 if(rows.length!==3||rows[0]!==expected[0]||rows[1]!==expected[1]||!rows[2].startsWith('evidence='))fail();
 const path=rows[2].slice(9),base=join(process.env.DOUYIN_PHONE_TMP_ROOT||'/private/tmp/openclaw-phone','evidence',profile);
 if(resolve(path)!==resolve(base,eid+'-before.xml'))fail();const bytes=read(path,base);zero(path);
 const idFile=`${run}-identity-${videoId}.json`,id=read(join(runDir,idFile),runDir);identity(id,run,videoId);
 const xmlFile=eid+'-before.xml',p={version:1,run,video_id:videoId,evidence_id:eid,state:'zero',xml_file:xmlFile,xml_sha256:sha(bytes),identity_file:idFile,identity_sha256:sha(id)};
 writeFileSync(join(runDir,xmlFile),bytes,{mode:0o600,flag:'wx'});writeFileSync(join(runDir,`${run}-no-comments-${videoId}.json`),JSON.stringify(p),{mode:0o600,flag:'wx'});
 verifyNoComments({runDir,run,videoId});return p;
}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function collectionEvidenceCount(rb,ctx){
 const rows=read(ctx.tsvFile||join(ctx.runDir,'comments.tsv'),ctx.runDir).toString().split('\n').filter(s=>s.startsWith('COLLECTION\t')).map(s=>s.split('\t')).filter(f=>['collected','sampled','no_comments'].includes(f[2]));
 const ids=rows.map(f=>f[1]);if(new Set(ids).size!==ids.length||ids.length!==Number(ctx.metrics?.videos_processed))fail();
 const glob=new RegExp('^'+String(rb.glob).replaceAll('{tag}',ctx.tag).split('*').map(escape).join('.*')+'$');let count=0;
 for(const f of rows){const vid=f[1];safe(ctx.tag,vid);const proof=join(ctx.runDir,`${ctx.tag}-no-comments-${vid}.json`);let has=false;try{lstatSync(proof);has=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(f[2]==='no_comments'){if(f[3]!=='0')fail();verifyNoComments({runDir:ctx.runDir,run:ctx.tag,videoId:vid});count++;continue;}
  if(has)fail();const files=readdirSync(ctx.evidenceDir).filter(name=>glob.test(name)&&name.includes(`-v${vid}-`));
  if(files.some(name=>{const bytes=read(join(ctx.evidenceDir,name),ctx.evidenceDir);return bytes.length>0&&(!rb.match||new RegExp(rb.match).test(bytes.toString()));}))count++;
 }
 return count;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [runDir,run,videoId,profile]=process.argv.slice(2);createNoComments({runDir,run,videoId,profile,stdout:readFileSync(0,'utf8')});}catch(e){process.stderr.write((/^NO_COMMENTS_EVIDENCE_UNVERIFIED:[a-z_]+$/.test(e.message||'')?e.message:'NO_COMMENTS_EVIDENCE_UNVERIFIED:artifact')+'\n');process.exitCode=6;}
}
