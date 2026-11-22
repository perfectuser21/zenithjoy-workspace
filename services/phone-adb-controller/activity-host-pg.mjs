// Offline assembly of the known frozen Agent host. No ambient module search or business writes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const self=fileURLToPath(import.meta.url),hash=x=>createHash('sha256').update(x).digest('hex');
const need=(value,code)=>{if(!value)throw Error('ACTIVITY_HOST_PG_'+code);};
const BASE={
 'cleanup-result.mjs':'d45fd56c90ed6ebe478dae555eda655a6cb2302f0b95055bfa1120d86a2489c7',
 'business.mjs':'5c2c6fa45b9f4c4bbe83b4e8560a9206485d4e2f5f0370603d8b87607a27ea2f',
 'checker.mjs':'a84b739035ba1336c498dcb7defae3b4df9230c465189f22e849c184c51d8d54',
 'production-readback-local.mjs':'3ef2c8d58d3f7d4ed196af657bf60df6a669016ae9883793ad641d3a908612bc',
};
const PG_SOURCE=['preflight-pg-dependencies.mjs','preflight-pg-lock.json'];
const BASE102={
 'qualification/runtime-deps.mjs':'e456238788ca8c1e6c64ef5de73dd02ad127c3b2990636e713b1b73385bbbdcd',
 'qualification/helper.mjs':'df17982052891e1afdefd628a06e8f339ff646867b2b4bcd858e057288e33adc',
 'qualification/visual-evidence.mjs':'c9856cba758087d07bdc449544c3b74c76609a20757c58c13387d6eb0e9766b6',
 'collection-evidence/runtime-deps.mjs':'e4212d2945f9f27c0302dcb8365cd443bc836e247399cfc357d21eec5453b597',
};
function regular(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o022),'FILE');return fs.readFileSync(file);}
function runtime(root){need(typeof root==='string'&&path.isAbsolute(root)&&fs.realpathSync(root)===path.resolve(root),'ROOT');return root;}
async function dependency(root,pins){
 runtime(root);need(pins&&PG_SOURCE.every(n=>/^[a-f0-9]{64}$/.test(pins[n]||'')),'SOURCE');
 // Verify bytes before importing the verifier. The expected hashes are frozen by the owning run.
 for(const name of PG_SOURCE)need(hash(regular(path.join(root,name)))===pins[name],'SOURCE');
 return import(pathToFileURL(path.join(root,PG_SOURCE[0])).href);
}
export async function loadActivityHostPg(context){
 need(context?.verification?.pg,'CONTEXT');
 need(context.source_commit===context.verification.pg.deployment?.source_commit,'EXECUTION_SOURCE');
 const module=await dependency(context.runtime_root,context.verification.runtime_sha256);
 return module.loadPreflightPg({runtimeRoot:context.runtime_root,frozen:context.verification.pg});
}
function replaceOnce(text,before,after){need(text.split(before).length===2,'BASE_WIRING');return text.replace(before,after);}
export async function assembleActivityPgHost({baseRoot,targetRoot,runtimeRoot,sourceCommit,expectedSource,expectedDeployment,workflow='101',checkerMode='script'}){
 need(['101','102','103'].includes(workflow),'WORKFLOW');need(['script','agent'].includes(checkerMode),'CHECKER_MODE');
 need(/^[a-f0-9]{40}$/.test(sourceCommit||''),'SOURCE');runtime(baseRoot);runtime(runtimeRoot);
 need(typeof targetRoot==='string'&&path.isAbsolute(targetRoot)&&!fs.existsSync(targetRoot),'TARGET');
 const hostBase=checkerMode==='agent'?{'business.mjs':BASE['business.mjs']}:BASE;
 const base=workflow==='102'?{...hostBase,...BASE102}:hostBase;
 const files={};for(const [name,digest]of Object.entries(base)){const bytes=regular(path.join(baseRoot,name));need(hash(bytes)===digest,'BASE');files[name]=bytes.toString();}
 const module=await dependency(runtimeRoot,expectedSource);
 const pg={deployment:{source_commit:sourceCommit},preflight_pg:module.preflightPgLockIdentity({runtimeRoot})};
 module.verifyPreflightPg({runtimeRoot,frozen:pg});
 const observed=module.preflightPgDeployment({runtimeRoot,sourceCommit});
 need(expectedDeployment&&isDeepStrictEqual(observed,expectedDeployment),'DEPLOYMENT');
 files['business.mjs']=replaceOnce(files['business.mjs'],
  "const require=createRequire(path.join(c.runtime_root,'package.json')),pool=require('./leadgen-db-connect.js').getPool();",
  "const require=createRequire(path.join(c.runtime_root,'package.json')),{Pool}=await loadActivityHostPg(c),pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE||'zenithjoy'});");
 if(checkerMode==='script'){
 files['checker.mjs']=replaceOnce(files['checker.mjs'],
  "const require=createRequire(path.join(c.runtime_root,'package.json')),{Pool}=require('pg');",
  "const {Pool}=await loadActivityHostPg(c);").replace("import {createRequire} from 'node:module';\n",'');
 files['production-readback-local.mjs']=replaceOnce(files['production-readback-local.mjs'],"const {Pool}=require('pg');","const {Pool}=await loadActivityHostPg(c);");
 files['cleanup-result.mjs']=replaceOnce(files['cleanup-result.mjs'],"const require=createRequire(c.runtime_root+'/package.json'),{Pool}=require('pg');","const {Pool}=await loadActivityHostPg(c);").replace("import {createRequire} from 'node:module';",'');
 }
 for(const name of Object.keys(hostBase))files[name]="import {loadActivityHostPg} from './activity-host-pg.mjs';\n"+files[name];
 if(workflow==='102'){
  const oldRoot='/Users/administrator/.local/share/zenithjoy/leadgen-api-candidates/composite-97eac7e35dc3-phone-caa47f8ba3ae/services/phone-adb-controller';
  for(const name of ['qualification/runtime-deps.mjs','collection-evidence/runtime-deps.mjs']){
   files[name]=replaceOnce(files[name],"'97eac7e35dc3e098a4d7fdde76cdca6dbfb691fd'",JSON.stringify(sourceCommit));
   // Original files use distinct quote styles. Both exact original hashes were checked above.
   files[name]=replaceOnce(files[name],name.startsWith('qualification/')?JSON.stringify(oldRoot):"'"+oldRoot+"'",JSON.stringify(runtimeRoot));
   files[name]="import {loadActivityHostPg} from '../activity-host-pg.mjs';\n"+files[name];
  }
  const q='qualification/runtime-deps.mjs';
  files[q]=replaceOnce(files[q],'export function createRuntimeDeps(c){','export async function createRuntimeDeps(c){');
  files[q]=replaceOnce(files[q],"queue=require('./leadgen-queue.js'),pool=require('./leadgen-db-connect.js').getPool();","queue=require('./leadgen-queue.js'),{Pool}=await loadActivityHostPg(c),pool=new Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE||'zenithjoy'});");
  files['qualification/helper.mjs']=replaceOnce(files['qualification/helper.mjs'],'deps=injectedDeps||createRuntimeDeps(c);','deps=injectedDeps||await createRuntimeDeps(c);');
  files['collection-evidence/runtime-deps.mjs']=replaceOnce(files['collection-evidence/runtime-deps.mjs'],"{Pool}=require('pg')","{Pool}=await loadActivityHostPg(c)");
 }
 files['activity-host-pg.mjs']=regular(self).toString();
 files['context-pg.json']=JSON.stringify({pg,runtime_sha256:Object.fromEntries(PG_SOURCE.map(n=>[n,expectedSource[n]]))},null,2)+'\n';
 const receipt={schema:'activity-host-pg/v1',source_commit:sourceCommit,runtime_root:runtimeRoot,
  expected_source:Object.fromEntries(PG_SOURCE.map(n=>[n,expectedSource[n]])),expected_deployment:expectedDeployment,
  base_sha256:base,sha256:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)])),status:'assembled_not_started'};
 fs.mkdirSync(targetRoot,{mode:0o700});
 for(const [name,bytes]of Object.entries({...files,'activity-host-pg-receipt.json':JSON.stringify(receipt,null,2)+'\n'})){fs.mkdirSync(path.dirname(path.join(targetRoot,name)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(targetRoot,name),bytes,{flag:'wx',mode:0o600});}
 return {pg,receipt};
}
export async function checkActivityHostPgReady(context,config){
 const {Pool}=await loadActivityHostPg(context),pool=new Pool({...config,connectionTimeoutMillis:10000,max:1});let client;
 try{
  client=await pool.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='10000ms'");
  const db=(await client.query("SELECT current_database() AS name,current_setting('transaction_read_only') AS read_only")).rows[0];
  need(db?.name==='zenithjoy'&&db.read_only==='on','DATABASE');
  const rows=(await client.query('SELECT company_id,tenant_id,config_version,config_status,runtime_config FROM zenithjoy.tenant_company_profiles WHERE company_id=$1',[context.company_id])).rows,p=rows[0];
  need(rows.length===1&&p.tenant_id===context.tenant_id&&p.config_status==='enabled'&&Number(p.config_version)===context.verification.policy_version&&p.runtime_config?.policy_id===context.verification.policy_id,'POLICY');
  await client.query('ROLLBACK');
  return {status:'ready',database:db.name,read_only:true,company_id:p.company_id,policy_version:Number(p.config_version),source_commit:context.verification.pg.deployment.source_commit,snapshot_required_before_start:false};
 }finally{client?.release();await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{
  const [mode,file,...extra]=process.argv.slice(2);need(file&&!extra.length&&['assemble','check'].includes(mode),'CLI');
  const input=JSON.parse(regular(path.resolve(file)));
  if(mode==='assemble')console.log(JSON.stringify(await assembleActivityPgHost(input)));
  else {const credentials=JSON.parse(regular(path.join(os.homedir(),'.credentials/zenithjoy-db.json')));console.log(JSON.stringify(await checkActivityHostPgReady(input,{connectionString:credentials.DATABASE_URL})));}
 }catch(e){console.error(/^ACTIVITY_HOST_PG_[A-Z_]+$|^PREFLIGHT_PG_[A-Z_]+$/.test(e.message)?e.message:'ACTIVITY_HOST_PG_UNAVAILABLE');process.exitCode=1;}
}
