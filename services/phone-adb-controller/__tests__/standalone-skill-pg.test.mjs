import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {agentInput,digest} from '../runtime-definition.mjs';
import {standaloneScope} from '../standalone-skill-authority.mjs';
import {installPreflightPg,preflightPgLockIdentity} from '../preflight-pg-dependencies.mjs';
import {publicDomainPgRequired,loadPublicDomainPg,verifyPublicDomainTask,verifyPublicDomainCompany} from '../public-domain-pg.mjs';
const list=(root,prefix='')=>readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(e=>{const p=prefix?prefix+'/'+e.name:e.name;return e.isDirectory()?list(root,p):[p];});
let fixture;
test.before(async()=>{
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'standalone-real-pg-'))),runtime=join(dir,'runtime'),source='c'.repeat(40),task=randomUUID(),run=randomUUID(),workflow=randomUUID(),version=randomUUID();
 mkdirSync(runtime,{mode:0o700});mkdirSync(join(dir,'skill'),{mode:0o700});writeFileSync(join(dir,'skill/SKILL.md'),'独立Skill方法',{mode:0o600});copyFileSync(new URL('../preflight-pg-lock.json',import.meta.url),join(runtime,'preflight-pg-lock.json'));
 await installPreflightPg({runtimeRoot:runtime,sourceCommit:source});
 const env={NODE_PATH:'',NODE_OPTIONS:'',NODE_PG_FORCE_NATIVE:'',WFR_RUN_DIR:dir,WF_HOME:runtime,LEADGEN_EXECUTION_MODE:'agent',WFR_RUN_ID:run,WFR_ATTEMPT:'a1',WF_BRAIN_TASK_ID:task,WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'direct101',P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'1',LEADGEN_SORT:'latest',LEADGEN_TIME_LAYER:'one_week',LEADGEN_LOCATION:'unlimited',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'1200',DATABASE_URL:'postgresql://unit-only@127.0.0.1:1/not-connected'};
 const company={company_id:randomUUID(),tenant_id:randomUUID(),version:26,policy_id:'original-v26'},skill={name:'douyin-leadgen-direct',version:'0.1.0',source_commit:'a'.repeat(40),path:'skill/SKILL.md',sha256:digest(readFileSync(join(dir,'skill/SKILL.md')))},p={protocol:'codex-exec-v1',task_id:task,run_id:run,task_run_id:randomUUID(),claimer:'codex-direct101-api',claimed_at:new Date().toISOString(),machine_id:'us-mac-m4',profile_sha256:'a'.repeat(64),skill,scope_sha256:'b'.repeat(64),company,approved_keywords:['AI办公'],deadline_ms:Date.now()+1100000,cleanup_deadline_ms:Date.now()+1200000,run_binding:{run_binding_id:randomUUID(),workflow_id:workflow,workflow_definition_version_id:version,attempt_key:task+':1',activities:{collect_videos:{reference_id:randomUUID(),activity_id:randomUUID(),activity_definition_version_id:randomUUID()}}}};
 const files={'skill/SKILL.md':skill.sha256,...Object.fromEntries(list(runtime).map(n=>['runtime/'+n,digest(readFileSync(join(runtime,n)))]))};
 const frozen={execution_mode:'agent',primary_host:'codex-exec-v1',deployment:{source_commit:source,target:'mmv'},release:{id:randomUUID()},public_pg:preflightPgLockIdentity({runtimeRoot:runtime}),workflow_version:{id:version,payload:{workflow_id:workflow,key:env.WF_BRAIN_WORKFLOW}},run_identity:{tag:env.WFR_TAG,run_id:run,profile:env.P,serial:env.SERIAL},agent_input:agentInput(env),standalone_skill:p,discovery_phone_scope:{profile:env.P,serial:env.SERIAL,expected_account:'77980009922'},files};
 p.scope=standaloneScope(frozen);p.scope_sha256=digest(p.scope);frozen.snapshot_sha256=digest(frozen);writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen),{mode:0o600});
 const registered={id:task,status:'in_progress',claimed_by:p.claimer,claimed_at:p.claimed_at,payload:{execution_mode:'standalone-skill',scope:p.scope,skill},result:{codex_skill_direct:p}};
 fixture={dir,runtime,frozen,p,company,env,registered,input:{kind:'queue',source:{commit:source,execution:{run:env.WFR_TAG,run_id:run,profile:env.P,line:env.LEADGEN_LINE}},request:{op:'company_config',run:env.WFR_TAG,line:env.LEADGEN_LINE,step:'101',device_binding:{profile:env.P,device_serial:env.SERIAL}}}};
});
test.after(()=>{if(fixture)rmSync(fixture.dir,{recursive:true,force:true});});
test('canonical standalone snapshot selects the existing fixed PG path and loads the real locked package without NODE_PATH',async()=>{
 const f=fixture;assert.equal(f.frozen.agent_input.company,undefined);assert.equal(f.frozen.public_domain,undefined);assert.equal(publicDomainPgRequired(f.runtime),true,'standalone must not fall through to bare require(pg)');
 const pool=loadPublicDomainPg({runtimeRoot:f.runtime,input:f.input,env:f.env});
 try{const require=createRequire(join(f.runtime,'_dependencies/preflight-pg/package.json'));assert.equal(require.resolve('pg'),join(f.runtime,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'));assert.equal(pool.constructor,require('pg').Pool);assert.equal(pool.totalCount,0,'constructing the real pool must not connect to a DB');}
 finally{await pool.end();}
});
test('standalone fixed PG rejects changed source, task, execution context or ambient module routing',()=>{
 const f=fixture;for(const [env,input]of [
  [{...f.env,WF_BRAIN_TASK_ID:randomUUID()},f.input],
  [f.env,{...f.input,source:{...f.input.source,commit:'d'.repeat(40)}}],
  [f.env,{...f.input,source:{...f.input.source,execution:{...f.input.source.execution,line:'other'}}}],
  [f.env,{...f.input,source:{commit:f.input.source.commit}}],
  [{...f.env,NODE_PATH:'/outside'},f.input]
 ])assert.throws(()=>loadPublicDomainPg({runtimeRoot:f.runtime,input,env}),/PUBLIC_DOMAIN_PG_SCOPE/);
});
test('standalone RPC claim uses the actual Brain Task scope and rejects a changed claimant',async()=>{
 const f=fixture;let task=f.registered,reads=0;const server=createServer((_req,res)=>{reads++;res.setHeader('content-type','application/json');res.end(JSON.stringify(task));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const env={...f.env,BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'unit-only'};
 try{assert.equal((await verifyPublicDomainTask({runtimeRoot:f.runtime,env})).claim_verified,true);task={...task,claimed_by:'other'};await assert.rejects(verifyPublicDomainTask({runtimeRoot:f.runtime,env}),/PUBLIC_DOMAIN_PG_SCOPE/);assert.equal(reads,2);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('company verification matches actual company tenant version and policy before any business query',async()=>{
 const f=fixture,good={...f.company,status:'enabled',line_key:f.env.LEADGEN_LINE};let profile=good,runRows=[];const queries=[];
 const pool={query:async(sql,args)=>{queries.push({sql,args});if(sql.includes('tenant_company_profiles'))return {rows:[profile]};if(sql.includes('company_config_runs'))return {rows:runRows};throw Error('BUSINESS_EFFECT_NOT_EXPECTED');}};
 assert.equal((await verifyPublicDomainCompany({runtimeRoot:f.runtime,pool,env:f.env})).verified,true);
 for(const change of [{company_id:randomUUID()},{tenant_id:randomUUID()},{version:27},{policy_id:'another-policy'},{status:'disabled'},{line_key:'other'}]){profile={...good,...change};await assert.rejects(verifyPublicDomainCompany({runtimeRoot:f.runtime,pool,env:f.env}),/PUBLIC_DOMAIN_PG_SCOPE/);}
 profile=good;runRows=[{...good,tenant_id:randomUUID()}];await assert.rejects(verifyPublicDomainCompany({runtimeRoot:f.runtime,pool,env:f.env}),/PUBLIC_DOMAIN_PG_SCOPE/);
 assert.ok(queries.some(q=>q.sql.includes('tenant_company_profiles')&&q.args.includes(f.env.LEADGEN_LINE)),'current line mapping must be checked, not only a self-selected company ID');
});
test('standalone PG refuses a tampered dependency even when a rewritten local snapshot matches its bytes',()=>{
 const f=fixture,path=join(f.runtime,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'),original=readFileSync(path),snapshot=readFileSync(join(f.dir,'run-definition.json'));
 try{
  const changed=Buffer.concat([original,Buffer.from('\n// altered dependency\n')]);writeFileSync(path,changed);const forged=structuredClone(f.frozen);forged.files['runtime/_dependencies/preflight-pg/node_modules/pg/lib/index.js']=digest(changed);delete forged.snapshot_sha256;forged.snapshot_sha256=digest(forged);writeFileSync(join(f.dir,'run-definition.json'),JSON.stringify(forged));
  assert.throws(()=>loadPublicDomainPg({runtimeRoot:f.runtime,input:f.input,env:f.env}),/PREFLIGHT_PG_FILE_DIGEST/);
 }finally{writeFileSync(path,original);writeFileSync(join(f.dir,'run-definition.json'),snapshot);}
});
test('standalone RPC requires an explicit Brain URL in the tool host environment',async()=>{
 const f=fixture;await assert.rejects(verifyPublicDomainTask({runtimeRoot:f.runtime,env:{...f.env,BRAIN_INTERNAL_TOKEN:'unit-only'}}),/^Error: PUBLIC_DOMAIN_PG_SCOPE$/);
});
