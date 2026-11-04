import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {writeFileSync,existsSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
import {privatePgSsh} from './helpers/preflight-private-pg-ssh.mjs';
const {Pool}=createRequire(import.meta.url)('pg');
const supported=process.platform==='darwin';
// Real PG + SSH, not a fake RPC result: catches an unowned/fork-capable transport or replay connection.
test('private PG request uses an owned nofork SSH stream and returns every leaf before sealing',{skip:!supported},async t=>{
 const f=await privatePgSsh(t),{createPreflightPgStream}=await import('../preflight-pg-stream.mjs');
 const transport=await createPreflightPgStream({directory:f.directory,policy:f.policy,deadlineMs:Date.now()+10000});t.after(()=>transport.close());
 const pool=new Pool({...f.connection,max:1,stream:transport.stream});t.after(()=>pool.ended?undefined:pool.end());
 const identity=(await pool.query('SELECT current_database() AS db, current_user AS username')).rows[0];
 assert.deepEqual(identity,{db:'postgres',username:'preflight_fixture'});
 await pool.end();const proof=await transport.seal();
 assert.equal(proof.execution_stopped,true);assert.equal(proof.leaves.length,1);assert.equal(proof.leaves[0].kernel_nofork,true);
 assert.throws(()=>transport.stream(),/PREFLIGHT_TRANSPORT_CLOSED/);
});
test('hostile user config ProxyCommand and askpass never run; wrong pinned host key refuses PG',{skip:!supported},async t=>{
 const f=await privatePgSsh(t),{createPreflightPgStream}=await import('../preflight-pg-stream.mjs');
 const home=join(f.directory,'hostile-home'),marker=join(f.directory,'escape');mkdirSync(join(home,'.ssh'),{recursive:true});
 const command=join(f.directory,'escape.sh');writeFileSync(command,`#!/bin/sh\ntouch ${marker}\n`,{mode:0o700});writeFileSync(join(home,'.ssh/config'),`Host *\n ProxyCommand ${command}\n LocalCommand ${command}\n PermitLocalCommand yes\n`);
 const transport=await createPreflightPgStream({directory:f.directory,policy:f.policy,deadlineMs:Date.now()+10000,env:{...process.env,HOME:home,SSH_ASKPASS:command,SSH_ASKPASS_REQUIRE:'force',SSH_AUTH_SOCK:'/untrusted/agent'}});t.after(()=>transport.close());
 const pool=new Pool({...f.connection,max:1,stream:transport.stream});
 assert.equal((await pool.query('SELECT 42 AS answer')).rows[0].answer,42);await pool.end();assert.equal(existsSync(marker),false);
 assert.equal((await transport.seal()).execution_stopped,true);
 const wrong={...f.policy,known_hosts_sha256:'a'.repeat(64)};
 await assert.rejects(()=>createPreflightPgStream({directory:f.directory,policy:wrong,deadlineMs:Date.now()+10000}),/PREFLIGHT_TRANSPORT_PIN/);
});

test('deadline closes the actual SSH leaf without retry and preserves unknown request outcome',{skip:!supported},async t=>{
 const f=await privatePgSsh(t),{createPreflightPgStream}=await import('../preflight-pg-stream.mjs');
 const transport=await createPreflightPgStream({directory:f.directory,policy:f.policy,deadlineMs:Date.now()+500});t.after(()=>transport.close());
 const pool=new Pool({...f.connection,max:1,stream:transport.stream});t.after(()=>pool.ended?undefined:pool.end());
 await assert.rejects(()=>pool.query('SELECT pg_sleep(3)'));
 await pool.end();const proof=await transport.seal();assert.equal(proof.execution_stopped,false);
 assert.equal(proof.leaves.length,1);assert.ok(proof.leaves[0].ended_at);
 assert.throws(()=>transport.stream(),/PREFLIGHT_TRANSPORT_CLOSED/);
});

test('parent metadata runs the original company freeze and independently reads the committed same-run snapshot',{skip:!supported},async t=>{
 const f=await privatePgSsh(t),{createPreflightPgStream}=await import('../preflight-pg-stream.mjs'),{createPreflightMetadata}=await import('../preflight-metadata.mjs');
 const setup=new Pool(f.connection);f.beforeStop(()=>setup.end());
 await setup.query(`CREATE SCHEMA zenithjoy;
 CREATE TABLE zenithjoy.tenant_company_profiles(company_id text,tenant_id text,config_version int,config_status text,runtime_config jsonb);
 CREATE TABLE zenithjoy.company_config_versions(company_id text,version int,tenant_id text,snapshot jsonb);
 CREATE TABLE zenithjoy.company_config_runs(company_id text,run_id text,version int,tenant_id text,snapshot jsonb,task_inputs jsonb,source_run text,UNIQUE(company_id,run_id));`);
 const snapshot={company_id:'company',tenant_id:'tenant',version:1,config_status:'enabled',wiki:{products:[{id:'product',name:'product'}],audiences:['customer']},runtime_config:{routing:{line_key:'yuesheng'},policy_id:'policy',video_judgment:{instructions:'original company policy'},platform_accounts:[{company_id:'company',tenant_id:'tenant',platform:'douyin',profile:'fixture',device_serial:'fixture-serial',douyin_id:'actual-account',verification_status:'verified',enabled:true}]}};
 await setup.query('INSERT INTO zenithjoy.tenant_company_profiles VALUES($1,$2,1,$3,$4)', ['company','tenant','enabled',JSON.stringify(snapshot.runtime_config)]);
 await setup.query('INSERT INTO zenithjoy.company_config_versions VALUES($1,1,$2,$3)', ['company','tenant',JSON.stringify(snapshot)]);
 await setup.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,1,$3,$4,$5,null)', ['company','new101','tenant',JSON.stringify(snapshot),'{}']);
 const metadata=createPreflightMetadata({directory:f.directory,scope:{workflow:'douyin_video_processing',line:'yuesheng',run:'new102',source_run:'new101',limit:2,profile:'fixture',serial:'fixture-serial'},source:{commit:'a'.repeat(40)},verify:()=>{},createPool:async({deadlineMs})=>{
  const transport=await createPreflightPgStream({directory:f.directory,policy:f.policy,deadlineMs});return {pool:new Pool({...f.connection,max:1,stream:transport.stream}),transport,expectedIdentity:{database:'postgres',role:'preflight_fixture'}};
 }});t.after(()=>metadata.close());
 const result=await metadata({kind:'queue',request:{op:'company_config',step:'102',line:'yuesheng',run:'new102',source_run:'new101',limit:2,device_binding:{profile:'fixture',device_serial:'fixture-serial'}}},{scope:{deadline_ms:Date.now()+10000}});
 assert.equal(result.result.device_binding.douyin_id,'actual-account');
 const rows=(await setup.query('SELECT source_run,task_inputs FROM zenithjoy.company_config_runs WHERE run_id=$1',['new102'])).rows;
 assert.deepEqual(rows,[{source_run:'new101',task_inputs:{device_binding:{profile:'fixture',device_serial:'fixture-serial'}}}]);
 assert.equal(metadata.snapshot().unknown,false);
});

for(const mismatch of ['host-key','identity'])test('real SSH refuses mismatched '+mismatch+' with no fallback or second leaf',{skip:!supported},async t=>{
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');const f=await privatePgSsh(t),{createPreflightPgStream}=await import('../preflight-pg-stream.mjs');
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');let policy={...f.policy};
 if(mismatch==='host-key'){const path=join(f.directory,'wrong_hosts');writeFileSync(path,'preflight_fixture '+readFileSync(join(f.directory,'identity.pub'),'utf8'),{mode:0o600});policy={...policy,known_hosts:path,known_hosts_sha256:hash(path)};}
 else policy={...policy,identity:join(f.directory,'host'),identity_sha256:hash(join(f.directory,'host'))};
 const transport=await createPreflightPgStream({directory:f.directory,policy,deadlineMs:Date.now()+5000});t.after(()=>transport.close());
 const pool=new Pool({...f.connection,max:1,stream:transport.stream});t.after(()=>pool.ended?undefined:pool.end());
 await assert.rejects(()=>pool.query('SELECT 1'));await pool.end();const proof=await transport.seal();assert.equal(proof.leaves.length,1);assert.equal(proof.leaves[0].code,255);
});
