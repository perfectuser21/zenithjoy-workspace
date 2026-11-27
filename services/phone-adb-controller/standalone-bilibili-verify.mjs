// Evidence provider for a single existing private video. The trusted host owns the
// native reader and lease. Neither is supplied by an IPC request.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,fsyncSync,lstatSync,mkdirSync,openSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,isAbsolute,join,relative,sep} from 'node:path';
import {assertPreflightPng} from './preflight-phone-driver.mjs';
import {serveStandaloneSkillTools} from './standalone-skill-ipc.mjs';

const pkg='tv.danmaku.bili';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const token=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;
const fields=['account','author','detail','editor','settings'];
const identity=['runId','owner','profile','serial','bvid'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireThat(ok,code){
 if(!ok)throw Error('BILIBILI_VERIFY_'+code);
}
function directoryIdentity(path){
 requireThat(typeof path==='string'&&isAbsolute(path)&&realpathSync(path)===path,'DIRECTORY');
 const stat=lstatSync(path);
 requireThat(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700,'DIRECTORY');
 return {dev:stat.dev,ino:stat.ino};
}
function verifyScope(s){
 return s!=null&&Object.keys(s).sort().join(',')==='bvid,deadlineMs,durationSeconds,height,owner,ownerUid,profile,runId,serial,sourceRunId,title,width'
  &&typeof s.runId==='string'&&uuid.test(s.runId)
  &&['sourceRunId','owner','profile','serial'].every(key=>typeof s[key]==='string'&&token.test(s[key]))
  &&s.sourceRunId!==s.runId&&typeof s.bvid==='string'&&/^BV[0-9A-Za-z]{10}$/.test(s.bvid)
  &&typeof s.ownerUid==='string'&&/^[1-9][0-9]{3,23}$/.test(s.ownerUid)
  &&typeof s.title==='string'&&s.title.trim()===s.title&&s.title.length>0&&s.title.length<=160&&!/[\r\n\0]/.test(s.title)
  &&['deadlineMs','width','height','durationSeconds'].every(key=>Number.isSafeInteger(s[key])&&s[key]>0)
  &&s.width*s.height<=16000000&&s.durationSeconds<3600;
}
const inspectNativeXml=String.raw`
import json,re,sys,xml.etree.ElementTree as ET
input=json.load(sys.stdin)
package='tv.danmaku.bili'
def native_tree(field):
    root=ET.fromstring(input[field])
    if root.tag!='hierarchy': raise ValueError('hierarchy')
    return root
def bili_nodes(tree):
    return [node for node in tree.iter('node') if node.get('package')==package]
def resource(nodes, key):
    return [node for node in nodes if node.get('resource-id')==package+':id/'+key]
def subject(role):
    nodes=bili_nodes(native_tree(role))
    rows=resource(nodes,'uid_layout')
    values=resource(nodes,'uid')
    if len(rows)!=1 or len(values)!=1: raise ValueError('subject')
    children=[node for node in rows[0] if node.get('package')==package]
    if values[0] not in children or field(children,'uid_prefix')!='UID': raise ValueError('subject')
    uid=values[0].get('text','')
    if not re.fullmatch(r'[1-9][0-9]{3,23}',uid): raise ValueError('subject')
    return uid
def field(nodes,key,attribute='text'):
    values=resource(nodes,key)
    if len(values)!=1: raise ValueError(key)
    return values[0].get(attribute,'')
def detail_title(root,nodes):
    parents={child:parent for parent in root.iter() for child in parent}
    avid,=resource(nodes,'avid')
    row=parents[avid]
    recycler=parents[row]
    if recycler.get('resource-id')!=package+':id/recycler': raise ValueError('work header')
    titles=[]
    for sibling in recycler:
        children=[child for child in sibling if child.get('package')==package]
        if resource(children,'arrow'): titles.extend(resource(children,'title'))
    title,=titles
    return title.get('text','')
detail_root=native_tree('detail')
detail=bili_nodes(detail_root)
editor=bili_nodes(native_tree('editor'))
settings=bili_nodes(native_tree('settings'))
print(json.dumps(dict(owner=subject('account'),author=subject('author'),bvid=field(detail,'avid'),
  label=field(detail,'tvTitle'),title=detail_title(detail_root,detail),editor_title=field(editor,'et_title'),
  editor_kind=field(editor,'tv_title'),private_switch=field(settings,'scSelfVisible','checked'),
  progress=field(detail,'gemini_halfscreen_progress_text'))))
`;
function observe(source,scope){
 requireThat(source?.package===pkg&&identity.every(key=>source[key]===scope[key]),'NATIVE_IDENTITY');
 const actions=source.sideEffects;
 requireThat(actions&&Object.keys(actions).sort().join(',')==='publish,share,visibilityChanges'
  &&Object.values(actions).every(count=>count===0),'NATIVE_EFFECTS');
 const evidence={};
 for(const name of fields){
  const bytes=source[name];
  requireThat(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=1024*1024,'NATIVE_XML');
  evidence[name]=Buffer.from(bytes);
 }
 const input=Object.fromEntries(fields.map(name=>[name,evidence[name].toString('utf8')]));
 requireThat(Object.values(input).every(value=>!/<!(?:DOCTYPE|ENTITY)/i.test(value)),'NATIVE_XML');
 let native;
 try{
  native=JSON.parse(execFileSync('/usr/bin/python3',['-I','-B','-S','-c',inspectNativeXml],{
   input:JSON.stringify(input),env:{},encoding:'utf8',timeout:3000,maxBuffer:16384,stdio:['pipe','pipe','pipe'],
  }));
 }catch{requireThat(false,'NATIVE_XML');}
 requireThat(native.owner===scope.ownerUid&&native.author===scope.ownerUid,'NATIVE_OWNER');
 requireThat(native.bvid===scope.bvid&&native.title===scope.title&&native.editor_title===scope.title&&native.editor_kind==='编辑稿件','NATIVE_WORK');
 requireThat(native.label==='本稿件已被设置为仅自己可见'&&native.private_switch==='true','NATIVE_PRIVATE');
 const duration=[Math.floor(scope.durationSeconds/60),scope.durationSeconds%60].map(v=>String(v).padStart(2,'0')).join(':');
 requireThat(native.progress===duration+'/'+duration,'NATIVE_PLAYBACK');
 evidence.player=Buffer.isBuffer(source.player)?Buffer.from(source.player):null;
 assertPreflightPng(evidence.player,{width:scope.width,height:scope.height});
 return evidence;
}
function syncWrite(path,bytes){
 const fd=openSync(path,'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
}
export async function serveStandaloneBilibiliVerify({scope,directory,evidenceDirectory,assertAuthority,readOwnVideo}={}){
 requireThat(verifyScope(scope)&&typeof assertAuthority==='function'&&typeof readOwnVideo==='function','SCOPE');
 const fixed=Object.freeze({...scope});
 // Only the socket connection belongs in the agent workspace. The trusted
 // caller provisions the evidence root outside its sandbox write scope.
 requireThat(typeof directory==='string'&&typeof evidenceDirectory==='string','EVIDENCE_DIRECTORY');
 const evidenceFromAgent=relative(directory,evidenceDirectory);
 requireThat(basename(evidenceDirectory)===fixed.runId
  &&(evidenceFromAgent==='..'||evidenceFromAgent.startsWith('..'+sep)),'EVIDENCE_DIRECTORY');
 const directories=[directory,evidenceDirectory].map(path=>({path,...directoryIdentity(path)}));
 const current=()=>{
  for(const before of directories){
   const actual=directoryIdentity(before.path);
   requireThat(actual.dev===before.dev&&actual.ino===before.ino,'DIRECTORY_CHANGED');
  }
  requireThat(Date.now()<fixed.deadlineMs,'DEADLINE');
 };
 let used=false;
 return serveStandaloneSkillTools({directory,call:async(operation,input)=>{
  requireThat(operation==='verify_existing'&&Object.keys(input).length===0,'OPERATION');
  requireThat(!used,'ALREADY_USED');
  current();
  await assertAuthority(fixed);current();used=true;
  const response=await readOwnVideo(Object.freeze({operation:'read_own_existing_video',
   ...Object.fromEntries(identity.map(key=>[key,fixed[key]])),ownerUid:fixed.ownerUid}));
  current();
  const evidence=observe(response,fixed);
  await assertAuthority(fixed);current();
  const dest=join(evidenceDirectory,'bilibili-existing');
  mkdirSync(dest,{mode:0o700});
  const files={};
  for(const [kind,bytes] of Object.entries(evidence)){
   const path=kind+(kind==='player'?'.png':'.xml');
   syncWrite(join(dest,path),bytes);
   files[kind]={path,sha256:sha(bytes)};
  }
  current();
  const observation={protocol:'bilibili-verify-existing/v1',run_id:fixed.runId,source_run_id:fixed.sourceRunId,
   owner:fixed.owner,profile:fixed.profile,serial:fixed.serial,bvid:fixed.bvid,owner_uid:fixed.ownerUid,
   title:fixed.title,visibility:'private',duration_seconds:fixed.durationSeconds,outward_actions:0};
  const receipt={observation,files};
  syncWrite(join(dest,'receipt.json'),JSON.stringify(receipt)+'\n');
  for(const path of [dest,evidenceDirectory]){
   const fd=openSync(path,'r');
   try{fsyncSync(fd);}finally{closeSync(fd);}
  }
  return receipt;
 }});
}
