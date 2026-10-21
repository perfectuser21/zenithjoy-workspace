// 从原deploy字面清单产生唯一恢复写集；不执行shell、不吸收整个HOME目录。
import {createHash} from 'node:crypto';
const need=(v,m)=>{if(!v)throw Error('手机整包写集: '+m);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const PREFIX='services/phone-adb-controller/';
const NAMES=['MMV_JS_FILES','MMV_TOPLEVEL_FILES','MMV_BIN_FILES','MMV_PROBE_FILES','DEVICE_CTL_FILES',
 'DEVICE_CTL_DIRS','DEVICE_SH_FILES','DEVICE_NODE_FILES','DEVICE_RPC_PROBE_FILES','DEVICE_PLAN_FILES','RPC_FILES','RELEASE_EVIDENCE_FILES'];
const pathOK=p=>typeof p==='string'&&/^[A-Za-z0-9_./-]+$/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
export function parseDeployArrays(text){
 const result={};
 for(const name of NAMES){
  const matches=[...text.matchAll(new RegExp('^'+name+'=\\(([\\s\\S]*?)\\)','gm'))];
  need(matches.length===1,'缺少/重复 '+name);
  const value=matches[0][1].split('\n').map(l=>l.replace(/#.*/, '')).join(' ').trim();
  need(/^[A-Za-z0-9_./=\s-]+$/.test(value),'数组必须为literal '+name);
  result[name]=value.split(/\s+/);need(result[name].length>0,'空数组 '+name);
 }
 return result;
}
export function buildWriteSet({groups:g,sha,homes,read,mode,commanderFiles,commanderManifest}){
 need(/^[a-f0-9]{40}$/.test(sha),'source SHA');
 const targets={mmv:new Map(),'xian-m4':new Map()};
 function put(host,path,after){
  need(pathOK(path),'invalid destination path');
  targets[host].set(path,{path,after});
 }
 function file(host,path,source,executable=false,evidence=false){
  need(pathOK(source),'invalid source path');
  const sourcePath=source.startsWith('apps/')?source:PREFIX+source;
  const bytes=read(sourcePath);need(bytes.length>0,'empty source '+sourcePath);
  const m=evidence?0o600:(mode(sourcePath)|(executable?0o111:0));
  need(Number.isInteger(m)&&m>=0&&m<=0o777,'invalid source mode');
  put(host,path,{kind:'file',sha256:digest(bytes),mode:m});
 }
 for(const f of g.MMV_JS_FILES)file('mmv','.openclaw/leadgen-scripts/'+f,f);
 for(const f of g.MMV_PROBE_FILES)file('mmv','.openclaw/leadgen-scripts/'+f,f);
 for(const f of g.MMV_TOPLEVEL_FILES)file('mmv','.openclaw/'+f,f);
 for(const f of g.MMV_BIN_FILES)file('mmv','bin/'+f,f,true);
 for(const f of g.DEVICE_SH_FILES)file('xian-m4','bin-harvest/'+f,f,true);
 for(const f of [...g.DEVICE_NODE_FILES,...g.DEVICE_RPC_PROBE_FILES,...g.DEVICE_PLAN_FILES])file('xian-m4','bin-harvest/'+f,f);
 for(const f of g.DEVICE_CTL_FILES)for(const directory of g.DEVICE_CTL_DIRS)file('xian-m4',directory+'/'+f,f,true);
 // Match the original MMV_RUNTIME_FILES composition and its final executable-mode rule.
 const runtime=[...g.DEVICE_SH_FILES,...g.DEVICE_NODE_FILES,...g.DEVICE_CTL_FILES,...g.DEVICE_RPC_PROBE_FILES,...g.DEVICE_PLAN_FILES,...g.MMV_JS_FILES,...g.MMV_PROBE_FILES];
 for(const directory of ['bin-harvest','.openclaw/leadgen-scripts'])for(const f of runtime)
  file('mmv',directory+'/'+f,f,/\.(sh|py)$/.test(f)||f==='douyin-phone-adb');
 for(const entry of g.RELEASE_EVIDENCE_FILES){
  const pair=entry.split('=');need(pair.length===2&&/^apps\/api\/db\/migrations\/[^/]+\.sql$/.test(pair[0])&&pair[1]==='release-evidence/'+pair[0].split('/').at(-1),'invalid evidence path');
  for(const [host,directory]of [['mmv','bin-harvest'],['mmv','.openclaw/leadgen-scripts'],['xian-m4','bin-harvest']])file(host,directory+'/'+pair[1],pair[0],false,true);
 }
 for(const f of commanderFiles){
  need(pathOK(f),'invalid Commander path');
  file('mmv','.openclaw/commander/'+f,'commander/'+f,/\.(sh|py)$/.test(f));
  if(f==='AGENTS.md'||f.startsWith('skills/'))file('mmv','openclaw-root/workspaces-root/clawd-work-commander/'+f,'commander/'+f);
 }
 put('mmv','.openclaw/commander/runtime-manifest.json',{kind:'file',sha256:digest(commanderManifest),mode:0o600});
 for(const [host,path]of [['mmv','bin-harvest/deployment-manifest.json'],['mmv','.openclaw/leadgen-scripts/deployment-manifest.json'],['xian-m4','bin-harvest/deployment-manifest.json']])
  put(host,path,{kind:'missing'}); // 实际ACK在唯一观察器写入前authorize，不能预填观测ID。
 for(const path of ['.codex-team1/skills/multi-platform-publish','.openclaw/skills/multi-platform-publish']){
  need(/^\/[A-Za-z0-9_/-]+$/.test(homes.mmv),'canonical MMV home required');
  put('mmv',path,{kind:'symlink',target:homes.mmv+'/.local/share/zenithjoy/publish-releases/'+sha+'/.agents/skills/multi-platform-publish'});
 }
 return Object.fromEntries(Object.entries(targets).map(([host,entries])=>[host,[...entries.values()].sort((a,b)=>a.path.localeCompare(b.path))]));
}
