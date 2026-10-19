/** 每个main都会续固定来源；版头只在PR分支修改，禁止main原地自动改Git。 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const AUTHORING_FILES=[
 'services/phone-adb-controller/commander/contracts/workflow-commander.json',
 'services/phone-adb-controller/commander/contracts/workflow-report.json',
 ...['single','batch','maintenance'].map(n=>`services/phone-adb-controller/patrol/contracts/${n}.json`),
];
export function gitSource(root,args){
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('GIT_'))delete env[k];
 const value=execFileSync('git',['--no-replace-objects','-C',root,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'},stdio:['ignore','pipe','pipe']});
 return args.length===3&&args.join(' ')==='remote get-url origin'?value.replace(/\r?\n$/,''):value.trim();
}
// Exact canonical GitHub origins only: checkout omits .git; no URL normalization may widen trust.
export function isAuthoringRepositoryOrigin(origin,repo){
 if(!['perfectuser21/zenithjoy-workspace','perfectuser21/cecelia'].includes(repo))return false;
 return [`https://github.com/${repo}`,`https://github.com/${repo}.git`,`git@github.com:${repo}.git`].includes(origin);
}
const parts=v=>{if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))throw Error('AUTHORING_SOURCE_VERSION_INVALID');return v.split('.').map(BigInt);};
export const greaterVersion=(a,b)=>{a=parts(a);b=parts(b);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;};
export function checkAuthoringVersions(root,{base='origin/main',fix=false}={}){
 root=resolve(root);const remote=gitSource(root,['remote','get-url','origin']);
 if(!isAuthoringRepositoryOrigin(remote,'perfectuser21/zenithjoy-workspace'))throw Error('AUTHORING_SOURCE_REPOSITORY_INVALID');
 if(!/^(origin\/main|[a-f0-9]{40})$/.test(base))throw Error('AUTHORING_SOURCE_BASE_INVALID');
 const sha=gitSource(root,['rev-parse','--verify',`${base}^{commit}`]);
 gitSource(root,['merge-base','--is-ancestor',sha,'HEAD']);
 try{gitSource(root,['merge-base','--is-ancestor',sha,'origin/main']);}catch{throw Error('AUTHORING_SOURCE_BASE_NOT_MAIN');}
 if(fix&&gitSource(root,['symbolic-ref','--short','HEAD'])==='main')throw Error('AUTHORING_SOURCE_FIX_MAIN_FORBIDDEN');
 const missing=[];
 for(const path of AUTHORING_FILES){
  const before=JSON.parse(gitSource(root,['show',`${sha}:${path}`]));const file=resolve(root,path),raw=readFileSync(file,'utf8'),after=JSON.parse(raw);
  if(greaterVersion(after.version,before.version))continue;
  if(after.version!==before.version)throw Error('AUTHORING_SOURCE_VERSION_REGRESSION');
  if(fix){const n=parts(before.version);n[2]++;const next=n.join('.');
   const updated=raw.replace(/("version"\s*:\s*")[^"]+("\s*,)/,`$1${next}$2`);
   const actual=JSON.parse(updated);if(actual.version!==next)throw Error('AUTHORING_SOURCE_VERSION_HEADER_INVALID');
   const {version:_a,...a}=after,{version:_b,...b}=actual;if(JSON.stringify(a)!==JSON.stringify(b))throw Error('AUTHORING_SOURCE_FIX_BODY_CHANGED');
   writeFileSync(file,updated);
  }else missing.push(path);
 }
 if(missing.length)throw Error(`AUTHORING_SOURCE_VERSION_BUMP_REQUIRED: ${missing.join(', ')}; 在PR分支运行 node scripts/ci/authoring-source-version.mjs --fix --base ${sha}，提交五份JSON后重新CI`);
 return {base_revision:sha,files:AUTHORING_FILES,mode:fix?'fix':'check'};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),fix=args.includes('--fix'),i=args.indexOf('--base');
 if(args.some((v,n)=>!['--fix','--base'].includes(v)&&n!==i+1))throw Error('AUTHORING_SOURCE_ARGS_INVALID');
 console.log(JSON.stringify(checkAuthoringVersions(process.cwd(),{fix,base:i>=0?args[i+1]:'origin/main'})));
}
