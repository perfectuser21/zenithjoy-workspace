import {readFileSync,writeFileSync,lstatSync,realpathSync,mkdirSync,chmodSync} from 'node:fs';
import {join,dirname,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=['run','run_id','source_commit','profile','serial'];
const invalid=()=>{throw Error('CLEANUP_NATIVE_READBACK_INVALID');};
function checkScope(scope){
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(scope.run||'')||!scope.run_id?.startsWith('douyin_video_discovery-'+scope.run+'__')||!/^a?[1-9]\d*$/.test(scope.run_id.split('__').at(-1))||! /^[a-f0-9]{40}$/.test(scope.source_commit||'')||!/^[-A-Za-z0-9_.]+$/.test(scope.profile||'')||!/^[-A-Za-z0-9_.:]+$/.test(scope.serial||''))invalid();
}
function fields(stdout){
 if(typeof stdout!=='string'||stdout.length>16000)invalid();const result={};
 for(const line of stdout.split('\n')){const m=/^([a-z_]+)=(.*)$/.exec(line);if(m){if(m[1]in result)invalid();result[m[1]]=m[2];}}
 return result;
}
function checkNative(close_stdout,desktop_stdout,xml,png){
 const close=fields(close_stdout),desktop=fields(desktop_stdout),launcher=desktop.launcher;
 if(!close.foreground||close.foreground==='unknown'||close.foreground.includes('com.ss.android.ugc.aweme')||!/^\w+(?:\.\w+)+$/.test(launcher||'')||desktop.foreground_package!==launcher||!desktop.foreground?.includes(launcher+'/'))invalid();
 if(!png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||!png.subarray(-8).equals(Buffer.from('49454e44ae426082','hex'))||png.length<45)invalid();
 if(!xml.length||/<!DOCTYPE|<!ENTITY/i.test(xml))invalid();
 // 今日头条桌面小组件的节点属于应用包；仅接受本次已观测的
 // HONOR workspace -> workspace_screen -> AppWidgetHostView 托管关系。
 // 独立窗口、未知组件及越出 host 的节点仍保留原 foreign-package 拒绝。
 const p=spawnSync('python3',['-c',`import sys,json,re,xml.etree.ElementTree as E
r=E.fromstring(sys.stdin.read())
assert r.tag=='hierarchy'
launcher=sys.argv[1]
parents={c:p for p in r.iter() for c in p}
def bounds(n):
 m=re.fullmatch(r'\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]',n.get('bounds',''))
 if not m:return None
 b=tuple(map(int,m.groups()))
 return b if b[0]<b[2] and b[1]<b[3] else None
def inside(child,parent):
 a,b=bounds(child),bounds(parent)
 return a is not None and b is not None and b[0]<=a[0]<a[2]<=b[2] and b[1]<=a[1]<a[3]<=b[3]
def hosted_news(n):
 if launcher!='com.hihonor.android.launcher' or n.get('package')!='com.ss.android.article.news':return False
 child=n
 while child in parents:
  parent=parents[child]
  if parent.tag!='node' or not inside(child,parent):return False
  if parent.get('class')=='android.appwidget.AppWidgetHostView':
   screen=parents.get(parent)
   workspace=parents.get(screen)
   if screen is None or workspace is None:return False
   if screen.get('resource-id')!=launcher+':id/workspace_screen' or workspace.get('resource-id')!=launcher+':id/workspace':return False
   if not inside(parent,screen) or not inside(screen,workspace):return False
   current=parent
   while current is not r:
    if current.tag!='node' or current.get('package')!=launcher:return False
    above=parents.get(current)
    if above is None or above is not r and not inside(current,above):return False
    current=above
   return True
  if parent.get('package')!='com.ss.android.article.news':return False
  child=parent
 return False
print(json.dumps(sorted(set(n.get('package','') for n in r.iter('node') if not hosted_news(n)))))`,launcher],{input:xml,encoding:'utf8',timeout:2000,maxBuffer:1024*1024});
 if(p.status!==0)invalid();const packages=JSON.parse(p.stdout);
 const allowed=['android','com.android.systemui',launcher,...(launcher==='com.hihonor.android.launcher'?['com.hihonor.android.totemweather','com.hihonor.assistant','com.hihonor.health']:[])];
 if(!packages.includes(launcher)||packages.some(p=>p&&!allowed.includes(p)))invalid();
 return launcher;
}
function readRegular(file,root,limit,privateFile=false){
 const st=lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>limit||realpathSync(dirname(file))!==realpathSync(root)||privateFile&&(st.mode&0o077))invalid();return readFileSync(file);
}
function writePrivate(file,bytes){
 try{if(lstatSync(file).isSymbolicLink())invalid();}catch(e){if(e.code!=='ENOENT')throw e;}
 writeFileSync(file,bytes,{mode:0o600});chmodSync(file,0o600);
}
export function captureCleanupReadback({runDir,evidenceRoot,scope,close_stdout,desktop_stdout,pngFile,xmlFile,evidenceId}){
 checkScope(scope);const attempt=scope.run_id.split('__').at(-1);
 if(evidenceId!==`${scope.run}-${attempt}-cleanup-desktop`||basename(pngFile)!==evidenceId+'.png'||basename(xmlFile)!==evidenceId+'.xml')invalid();
 const png=readRegular(resolve(pngFile),evidenceRoot,12*1024*1024),xml=readRegular(resolve(xmlFile),evidenceRoot,1024*1024);
 const folder=join(runDir,'cleanup-readback');mkdirSync(folder,{recursive:true,mode:0o700});
 if(lstatSync(folder).isSymbolicLink()||realpathSync(dirname(folder))!==realpathSync(runDir))invalid();
 for(const [name,bytes] of [['desktop.png',png],['desktop.xml',xml]])writePrivate(join(folder,name),bytes);
 const attemptEvidence={version:1,...Object.fromEntries(keys.map(k=>[k,scope[k]])),observed_at:new Date().toISOString(),evidence_id:evidenceId,close_stdout,desktop_stdout,png_sha256:hash(png),xml_sha256:hash(xml)};
 writePrivate(join(runDir,'cleanup-attempt.json'),JSON.stringify(attemptEvidence));
 const launcher=checkNative(close_stdout,desktop_stdout,xml.toString('utf8'),png),body={...attemptEvidence,launcher};
 const proof={...body,digest:hash(JSON.stringify(body))},file=join(runDir,'cleanup-readback.json');
 writePrivate(file,JSON.stringify(proof));return proof;
}
export function verifyCleanupReadback({runDir,scope,digest}){
 try{
  checkScope(scope);const proof=JSON.parse(readRegular(join(runDir,'cleanup-readback.json'),runDir,32768,true));
  for(const key of keys)if(proof[key]!==scope[key])return false;
  if(digest!==undefined&&proof.digest!==digest)return false;const {digest:actual,...body}=proof;if(hash(JSON.stringify(body))!==actual)return false;
  const folder=join(runDir,'cleanup-readback');if(lstatSync(folder).isSymbolicLink()||realpathSync(dirname(folder))!==realpathSync(runDir))return false;
  const png=readRegular(join(folder,'desktop.png'),folder,12*1024*1024,true),xml=readRegular(join(folder,'desktop.xml'),folder,1024*1024,true);
  return hash(png)===proof.png_sha256&&hash(xml)===proof.xml_sha256&&checkNative(proof.close_stdout,proof.desktop_stdout,xml.toString('utf8'),png)===proof.launcher;
 }catch{return false;}
}
