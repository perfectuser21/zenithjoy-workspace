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
 const p=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E\nr=E.fromstring(sys.stdin.read())\nassert r.tag=='hierarchy'\nprint(json.dumps(sorted(set(n.get('package','') for n in r.iter('node')))))`],{input:xml,encoding:'utf8',timeout:2000,maxBuffer:1024*1024});
 if(p.status!==0)invalid();const packages=JSON.parse(p.stdout);if(!packages.includes(launcher)||packages.some(p=>p&&!['android','com.android.systemui',launcher].includes(p)))invalid();
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
