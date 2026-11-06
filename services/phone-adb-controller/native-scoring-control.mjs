// 103独立冻结键；仅MMV local/serial none。包依赖共用SSRI，不借手机权限。
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';import {join,resolve} from 'node:path';import {userInfo} from 'node:os';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {readPgControlMaterial,createPreflightLocalPool} from './preflight-control-scope.mjs';import {loadScoringPg} from './preflight-pg-dependencies.mjs';
const require=createRequire(import.meta.url),routes=require('./line-routes.js'),sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=()=>{throw Error('SCORING_CONTROL_SCOPE');};
function bytes(path){let fd;try{if(realpathSync(path)!==resolve(path))fail();fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const a=fstatSync(fd),before=lstatSync(path);if(!a.isFile()||before.isSymbolicLink()||a.uid!==process.getuid()||(a.mode&0o777)!==0o600||a.size>512*1024)fail();const b=readFileSync(fd),after=fstatSync(fd);if(a.dev!==after.dev||a.ino!==after.ino||a.size!==after.size||a.mtimeMs!==after.mtimeMs||a.dev!==before.dev||a.ino!==before.ino)fail();return b;}catch{fail();}finally{if(fd!==undefined)closeSync(fd);}}
function token(b,key){const rows=[...b.toString('utf8').matchAll(new RegExp('^(?:export )?'+key+'=(.+)$','gm'))];if(rows.length!==1)fail();const value=rows[0][1].trim().replace(/^(['"])(.*)\1$/,'$2');if(!value||/[\r\n]/.test(value))fail();return value;}
function material({root,env}){
 try{
  if(env.WF_BRAIN_WORKFLOW!=='douyin_comment_scoring'||env.LEADGEN_EXECUTION_MODE!=='agent'||env.P!=='mmv-scoring'||env.SERIAL!=='none')fail();
  const home=realpathSync(userInfo().homedir),base=readPgControlMaterial({root,env});if(base.scope.mode!=='local'||base.scope.target!=='mmv')fail();
  const db=bytes(base.scope.credentials_path);if(sha(db)!==base.scope.credentials_sha256)fail();
  const files={model:join(home,'.credentials/openrouter.env'),crm:join(home,'.credentials/leadgen-feishu-accounts.json'),brain:join(home,'.credentials/cecelia-internal.env')},raw=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,bytes(p)]));
  const apiKey=token(raw.model,'OPENROUTER_API_KEY'),brainToken=token(raw.brain,'CECELIA_INTERNAL_TOKEN'),credentials=JSON.parse(raw.crm),account=routes.routeOf(env.LEADGEN_LINE).account;
  if(!credentials?.[account]?.appId||!credentials[account].appSecret)fail();
  const manifest=JSON.parse(readFileSync(join(root,'deployment-manifest.json'),'utf8')),path='config/collection-phone-hosts.json',policy=readFileSync(join(root,path)),entry=manifest.files.filter(f=>f.deployed_path===path);
  if(entry.length!==1||entry[0].path!=='services/phone-adb-controller/'+path||entry[0].content_sha256!==sha(policy))fail();
  const pins=JSON.parse(policy).hosts.filter(h=>h.target==='mmv').map(h=>h.executables?.python);if(!pins.length||pins.some(p=>!p||canonical(p)!==canonical(pins[0]))||!/^[a-f0-9]{64}$/.test(pins[0].sha256||'')||typeof pins[0].path!=='string')fail();
  const scope={...base.scope,protocol:'native-scoring-control/v1',python_policy_sha256:sha(policy),python:structuredClone(pins[0]),business_credentials:Object.fromEntries(Object.entries(files).map(([k,path])=>[k,{path,sha256:sha(raw[k])}]))};
  return {scope,uri:base.uri,apiKey,brainToken,feishuCredentials:{[account]:structuredClone(credentials[account])}};
 }catch{fail();}
}
export function freezeScoringControlScope(options){if(options.env.LEADGEN_EXECUTION_MODE!=='agent'||options.env.WF_BRAIN_WORKFLOW!=='douyin_comment_scoring')return undefined;return material(options).scope;}
export function assertScoringControlScope({root,env,frozen}){
 if(frozen.execution_mode!=='agent'||frozen.workflow_version?.payload?.key!=='douyin_comment_scoring'||frozen.agent_input?.workflow_key!=='douyin_comment_scoring'||frozen.agent_input.profile!=='mmv-scoring'||frozen.agent_input.serial!=='none'||Object.hasOwn(frozen,'preflight_control_scope')||Object.hasOwn(frozen,'control_scope'))fail();
 const actual=material({root,env}).scope;if(actual.source_commit!==frozen.deployment.source_commit||actual.target!==frozen.deployment.target||frozen.files?.['runtime/config/preflight-control-hosts.json']!==actual.policy_sha256||frozen.files?.['runtime/config/collection-phone-hosts.json']!==actual.python_policy_sha256||canonical(actual)!==canonical(frozen.scoring_control_scope))fail();return actual;
}
export function readScoringCredentials(options){assertScoringControlScope(options);const {apiKey,brainToken,feishuCredentials}=material(options);return {apiKey,brainToken,feishuCredentials};}
export function createScoringPoolFactory({runtimeRoot,frozen,env}){
 const fixed=assertScoringControlScope({root:runtimeRoot,frozen,env});const {Pool}=loadScoringPg({runtimeRoot,frozen});
 return async({deadlineMs})=>{assertScoringControlScope({root:runtimeRoot,frozen,env});const {uri}=material({root:runtimeRoot,env});const allocation=createPreflightLocalPool({Pool,connectionString:uri,deadlineMs});return {...allocation,expectedIdentity:structuredClone(fixed.database_identity)};};
}
