import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,cpSync,existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {installPreflightPg,preflightPgDeployment,preflightPgLockIdentity} from '../preflight-pg-dependencies.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/activity-host-pg.json',import.meta.url)));
const fixture102=JSON.parse(readFileSync(new URL('./fixtures/activity-host-102.json',import.meta.url)));
const implementation=new URL('../activity-host-pg.mjs',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
let f;
test.before(async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'activity-host-pg-'))),runtime=join(root,'runtime'),base=join(root,'base');
 mkdirSync(runtime,{mode:0o700});mkdirSync(base,{mode:0o700});
 for(const [name,v] of Object.entries(fixture.files)){assert.equal(sha(v.source),v.sha256);writeFileSync(join(base,name),v.source,{mode:0o600});}
 for(const [name,v] of Object.entries(fixture102.files).filter(([n])=>n.endsWith('.mjs'))){mkdirSync(join(base,name,'..'),{recursive:true});writeFileSync(join(base,name),v.source,{mode:0o600});}
 for(const name of ['leadgen-db-lib.js','leadgen-queue.js','queued-recipient-evidence.js','company-config-lib.js'])writeFileSync(join(runtime,name),'module.exports={};',{mode:0o600});
 for(const name of ['preflight-pg-dependencies.mjs','preflight-pg-lock.json','leadgen-db-connect.js'])cpSync(new URL('../'+name,import.meta.url),join(runtime,name));
 const sourceCommit='a'.repeat(40);await installPreflightPg({runtimeRoot:runtime,sourceCommit});
 const expectedSource=Object.fromEntries(['preflight-pg-dependencies.mjs','preflight-pg-lock.json'].map(n=>[n,sha(readFileSync(join(runtime,n)))]));
 f={root,runtime,base,sourceCommit,expectedSource,expectedDeployment:preflightPgDeployment({runtimeRoot:runtime,sourceCommit})};
});
for(const name of ['qualification/runtime-deps.mjs','collection-evidence/runtime-deps.mjs'])test(`102 ${name} real initialization uses verified PG with sanitized host environment`,async()=>{
 const targetRoot=join(f.root,'102-'+name.split('/')[0]);
 const assembled=await (await import(implementation)).assembleActivityPgHost({baseRoot:f.base,targetRoot,runtimeRoot:f.runtime,sourceCommit:f.sourceCommit,expectedSource:f.expectedSource,expectedDeployment:f.expectedDeployment,workflow:'102'});
 const file=join(targetRoot,name),raw=existsSync(file)?readFileSync(file,'utf8'):fixture102.files[name].source;
 const line=raw.split('\n').find(l=>l.includes('pool=')&&l.includes('require('));
 const context={source_commit:f.sourceCommit,runtime_root:f.runtime,verification:{runtime_sha256:f.expectedSource,pg:assembled.pg}};
 const imports=raw.includes('loadActivityHostPg')?`import {loadActivityHostPg} from ${JSON.stringify(pathToFileURL(join(targetRoot,'activity-host-pg.mjs')).href)};`:'';
 const result=child(`import {createRequire} from 'node:module';${imports}const c=${JSON.stringify(context)},ROOT=c.runtime_root,need=()=>{};${name.startsWith('qualification/')?"const require=createRequire(ROOT+'/package.json');":''}${line}\nconsole.log(typeof pool.query);await pool.end();`,targetRoot);
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'function');assert.ok(existsSync(file));
 assert.ok(raw.includes(JSON.stringify(f.runtime)),'runtime is fixed from approved assembly input');assert.ok(raw.includes(f.sourceCommit));
 assert.match(readFileSync(join(targetRoot,'qualification/helper.mjs'),'utf8'),/deps=injectedDeps\|\|await createRuntimeDeps\(c\)/);
});
test('102 wrapper original drift rejects before creating an output directory',async()=>{
 const base=join(f.root,'102-bad-base');cpSync(f.base,base,{recursive:true});writeFileSync(join(base,'qualification/runtime-deps.mjs'),'modified');
 const targetRoot=join(f.root,'102-bad-output');
 await assert.rejects((await import(implementation)).assembleActivityPgHost({baseRoot:base,targetRoot,runtimeRoot:f.runtime,sourceCommit:f.sourceCommit,expectedSource:f.expectedSource,expectedDeployment:f.expectedDeployment,workflow:'102'}),/ACTIVITY_HOST_PG_BASE/);
 assert.equal(existsSync(targetRoot),false);
});
test.after(()=>{if(f)rmSync(f.root,{recursive:true,force:true});});
async function candidate(name){
 const targetRoot=join(f.root,name);
 if(existsSync(implementation))return {targetRoot,...await (await import(implementation)).assembleActivityPgHost({baseRoot:f.base,targetRoot,runtimeRoot:f.runtime,sourceCommit:f.sourceCommit,expectedSource:f.expectedSource,expectedDeployment:f.expectedDeployment})};
 // RED baseline executes the exact old host bytes, rather than failing on a missing helper import.
 cpSync(f.base,targetRoot,{recursive:true});return {targetRoot,pg:{deployment:{source_commit:f.sourceCommit},preflight_pg:preflightPgLockIdentity({runtimeRoot:f.runtime})}};
}
function child(script,root){
 return spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:15000,env:{HOME:f.root,PATH:process.env.PATH,NODE_PATH:'',NODE_OPTIONS:'',NODE_PG_FORCE_NATIVE:''}});
}
for(const name of ['business.mjs','checker.mjs','production-readback-local.mjs'])test(`${name} actual frozen PG initialization works with the host sanitized environment`,async()=>{
 const c=await candidate(name.replaceAll('.','-'));
 const context={source_commit:f.sourceCommit,runtime_root:f.runtime,verification:{runtime_sha256:f.expectedSource,pg:c.pg}};
 const raw=readFileSync(join(c.targetRoot,name),'utf8');
 // Execute the real initialization statements extracted from each frozen entry, not a replacement loader.
 let body;
 if(name==='business.mjs')body=raw.split('\n').find(l=>l.includes('pool=')&&l.includes('const require='))+'\nconsole.log(typeof pool.query);await pool.end();';
 else if(name==='checker.mjs')body=raw.split('\n').find(l=>l.includes('{Pool}=' )).split(';const privateDB=')[0]+';console.log(typeof new Pool().query);';
 else body=raw.split('\n').find(l=>l.includes('const {Pool}='))+'\nconsole.log(typeof new Pool().query);';
 const imports=raw.includes("from './activity-host-pg.mjs'")?`import {loadActivityHostPg} from ${JSON.stringify(pathToFileURL(join(c.targetRoot,'activity-host-pg.mjs')).href)};`:'';
 const r=child(`import path from 'node:path';import {createRequire} from 'node:module';${imports}\nconst c=${JSON.stringify(context)},root=c.runtime_root;${name==='production-readback-local.mjs'?"const require=createRequire(root+'/package.json');":''}\n${body}`,c.targetRoot);
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'function');
});
test('cleanup-result.mjs actual frozen PG initialization works with the host sanitized environment',async()=>{
 const c=await candidate('cleanup-result');
 const context={source_commit:f.sourceCommit,runtime_root:f.runtime,verification:{runtime_sha256:f.expectedSource,pg:c.pg}};
 const file=join(c.targetRoot,'cleanup-result.mjs');
 // If the assembler omits this entry, execute the original failing initialization, not a missing-file error.
 const raw=existsSync(file)?readFileSync(file,'utf8'):fixture.files['cleanup-result.mjs'].source;
 const init=raw.split('\n').find(l=>l.includes('{Pool}=')).split(';pool=new Pool')[0];
 const imports=raw.includes("from './activity-host-pg.mjs'")?`import {loadActivityHostPg} from ${JSON.stringify(pathToFileURL(join(c.targetRoot,'activity-host-pg.mjs')).href)};`:'';
 const r=child(`import {createRequire} from 'node:module';${imports}const c=${JSON.stringify(context)};${init};console.log(typeof new Pool().query);`,c.targetRoot);
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'function');assert.equal(existsSync(file),true);
});
test('assembly preserves old host and refuses a changed baseline before creating output',async()=>{
 const api=await import(implementation),bad=join(f.root,'bad-base');cpSync(f.base,bad,{recursive:true});writeFileSync(join(bad,'checker.mjs'),'different');
 const targetRoot=join(f.root,'bad-output');await assert.rejects(api.assembleActivityPgHost({...f,baseRoot:bad,targetRoot,runtimeRoot:f.runtime}),/ACTIVITY_HOST_PG_BASE/);assert.equal(existsSync(targetRoot),false);
 for(const [name,v]of Object.entries(fixture.files))assert.equal(sha(readFileSync(join(f.base,name))),v.sha256);
});
test('unadmitted source and dependency mutation reject before code or database use',async()=>{
 const api=await import(implementation),targetRoot=join(f.root,'bad-admission');
 await assert.rejects(api.assembleActivityPgHost({...f,baseRoot:f.base,targetRoot,runtimeRoot:f.runtime,expectedSource:{...f.expectedSource,'preflight-pg-dependencies.mjs':'0'.repeat(64)}}),/ACTIVITY_HOST_PG_SOURCE/);assert.equal(existsSync(targetRoot),false);
 const c=await candidate('tamper'),context={source_commit:f.sourceCommit,runtime_root:f.runtime,verification:{runtime_sha256:f.expectedSource,pg:c.pg}};
 const dep=join(f.runtime,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'),original=readFileSync(dep);writeFileSync(dep,'throw Error("UNTRUSTED_MODULE_EXECUTED")');
 try{const r=child(`import {loadActivityHostPg} from ${JSON.stringify(pathToFileURL(join(c.targetRoot,'activity-host-pg.mjs')).href)};await loadActivityHostPg(${JSON.stringify(context)});`,c.targetRoot);assert.notEqual(r.status,0);assert.match(r.stderr,/PREFLIGHT_PG_FILE_DIGEST/);assert.doesNotMatch(r.stderr,/UNTRUSTED_MODULE_EXECUTED/);}finally{writeFileSync(dep,original);}
});
test('frozen dependency lock and execution source must match before returning a Pool',async()=>{
 const c=await candidate('frozen-binding'),api=await import(pathToFileURL(join(c.targetRoot,'activity-host-pg.mjs')));
 const context={source_commit:f.sourceCommit,runtime_root:f.runtime,verification:{runtime_sha256:f.expectedSource,pg:c.pg}};
 for(const mutate of [v=>v.verification.pg.preflight_pg.lock_sha256='b'.repeat(64),v=>v.verification.pg.preflight_pg.package_lock_sha256='b'.repeat(64),v=>v.verification.pg.deployment.source_commit='b'.repeat(40),v=>v.source_commit='b'.repeat(40)]){
  const changed=structuredClone(context);mutate(changed);await assert.rejects(api.loadActivityHostPg(changed),/ACTIVITY_HOST_PG_|PREFLIGHT_PG_/);
 }
});
test('readiness uses only read-only queries and does not require or create a run snapshot',async()=>{
 const api=await import(implementation),c=await candidate('readiness');
 const context={source_commit:f.sourceCommit,runtime_root:f.runtime,company_id:'fixture-company',tenant_id:'fixture-tenant',verification:{runtime_sha256:f.expectedSource,pg:c.pg,policy_version:34,policy_id:'fixture-policy'}};
 const require=createRequire(pathToFileURL(join(f.runtime,'_dependencies/preflight-pg/package.json'))),{Pool}=require('pg'),original=Pool.prototype.connect,queries=[];
 // SQL result fixture only; loading still uses the actual verified official PG closure.
 Pool.prototype.connect=async()=>({release(){},async query(sql){queries.push(sql);if(sql.includes('current_database'))return {rows:[{name:'zenithjoy',read_only:'on'}]};if(sql.includes('tenant_company_profiles'))return {rows:[{company_id:context.company_id,tenant_id:context.tenant_id,config_status:'enabled',config_version:34,runtime_config:{policy_id:'fixture-policy'}}]};return {rows:[]};}});
 try{assert.equal((await api.checkActivityHostPgReady(context,{})).status,'ready');assert.equal(queries[0],'BEGIN READ ONLY');assert.equal(queries.at(-1),'ROLLBACK');assert.equal(queries.length,5);assert.ok(queries.every(q=>!q.includes('company_config_runs')));}finally{Pool.prototype.connect=original;}
});
