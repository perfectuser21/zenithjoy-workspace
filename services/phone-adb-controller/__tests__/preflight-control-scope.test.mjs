import test from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';import {execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
// These fixtures own private connection inputs; the CI scratch service belongs to other test processes.
function isolatePrivatePgEnvironment(t){const saved=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^PG[A-Z_]*$/.test(key)));for(const key of Object.keys(saved))delete process.env[key];t.after(()=>{for(const key of Object.keys(process.env))if(/^PG[A-Z_]*$/.test(key))delete process.env[key];Object.assign(process.env,saved);});}
test('control scope freezes independent source pins/central route without secrets and rejects late file drift',async t=>{
 isolatePrivatePgEnvironment(t);
 const home=realpathSync(mkdtempSync(join(os.tmpdir(),'preflight-control-')));t.after(()=>rmSync(home,{recursive:true,force:true}));const user=os.userInfo();t.mock.method(os,'userInfo',()=>({...user,homedir:home}));syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 mkdirSync(join(home,'.ssh'));mkdirSync(join(home,'.credentials'));mkdirSync(join(home,'runtime/config'),{recursive:true});
 const key=join(home,'.ssh/id_rsa');execFileSync('/usr/bin/ssh-keygen',['-q','-t','ed25519','-N','','-f',key]);const fp=execFileSync('/usr/bin/ssh-keygen',['-lf',key+'.pub'],{encoding:'utf8'}).trim().split(/\s+/)[1];
 writeFileSync(join(home,'.ssh/known_hosts'),'38.23.42.120 '+readFileSync(key+'.pub','utf8'),{mode:0o600});writeFileSync(join(home,'.credentials/zenithjoy-db.env'),'DATABASE_URL=postgresql://zenithjoy:FAKE_SECRET@127.0.0.1:15532/zenithjoy\n',{mode:0o600});
 const policy={version:1,database_identity:{database:'zenithjoy',role:'zenithjoy',system_identifier:'7662392643931066407'},hosts:[{target:'xian-m4',home,mode:'ssh',ssh:{ssh_bin:'/usr/bin/ssh',ssh_sha256:sha(readFileSync('/usr/bin/ssh')),user:'administrator',port:22,identity_fingerprint:fp,host_key_fingerprint:fp,host_key_kind:'ssh-ed25519'}}]};
 const bytes=Buffer.from(JSON.stringify(policy)),root=join(home,'runtime');writeFileSync(join(root,'config/preflight-control-hosts.json'),bytes);writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify({source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'a'.repeat(40),target:'xian-m4',files:[{path:'services/phone-adb-controller/config/preflight-control-hosts.json',deployed_path:'config/preflight-control-hosts.json',content_sha256:sha(bytes)}]}));
 const {freezePreflightControlScope,assertPreflightControlScope}=await import('../preflight-control-scope.mjs'),env={HOME:home,WF_BRAIN_WORKFLOW:'douyin_video_discovery',LEADGEN_EXECUTION_MODE:'agent'},transport={machine_id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',ssh_hostname:'100.71.151.105',ssh_hostkey_alias:'38.23.42.120'};
 for(const name of ['PGOPTIONS','PGSSLMODE','PGCLIENT_ENCODING','PGBINARY','PGREPLICATION'])assert.throws(()=>freezePreflightControlScope({root,env:{...env,[name]:'unapproved'},runtimeTransport:transport}),/PREFLIGHT_CONTROL_SCOPE/);
 const ambient=process.env.PGOPTIONS;try{process.env.PGOPTIONS='-c search_path=unapproved';assert.throws(()=>freezePreflightControlScope({root,env,runtimeTransport:transport}),/PREFLIGHT_CONTROL_SCOPE/);}finally{if(ambient===undefined)delete process.env.PGOPTIONS;else process.env.PGOPTIONS=ambient;}
 const scope=freezePreflightControlScope({root,env,runtimeTransport:transport});assert.equal(scope.ssh.hostname,'100.71.151.105');assert.equal(scope.ssh.hostkey_alias,'38.23.42.120');assert.equal(JSON.stringify(scope).includes('FAKE_SECRET'),false);assert.equal(JSON.stringify(scope).includes('postgresql:'),false);
 const frozen={execution_mode:'agent',workflow_version:{payload:{key:env.WF_BRAIN_WORKFLOW}},deployment:{source_commit:'a'.repeat(40),target:'xian-m4'},runtime_transport:transport,preflight_control_scope:scope,files:{'runtime/config/preflight-control-hosts.json':sha(bytes)}};
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);assert.equal(JSON.parse(readFileSync(join(dirname(require.resolve('pg-connection-string')),'package.json'),'utf8')).version,'2.11.0');const redirected=require('pg-connection-string').parse('postgresql://zenithjoy:FAKE_SECRET@127.0.0.1:15532/zenithjoy?host=203.0.113.10&port=5432');assert.equal(redirected.host,'203.0.113.10');assert.equal(redirected.port,'5432');
 const credential=join(home,'.credentials/zenithjoy-db.env'),originalCredential=readFileSync(credential);
 for(const uri of ['postgresql://zenithjoy:FAKE_SECRET@127.0.0.1:15532/zenithjoy?host=203.0.113.10&port=5432','postgresql://zenithjoy:FAKE_SECRET@127.0.0.1:15532/zenithjoy#fragment','postgresql://zenithjoy:FAKE_SECRET@127.1:15532/zenithjoy','postgresql://zenithjoy:FAKE_SECRET@127.0.0.1:15532/zenithjoy?']){writeFileSync(credential,'DATABASE_URL='+uri+'\n',{mode:0o600});assert.throws(()=>freezePreflightControlScope({root,env,runtimeTransport:transport}),/PREFLIGHT_CONTROL_SCOPE/);}writeFileSync(credential,originalCredential);
 assert.doesNotThrow(()=>assertPreflightControlScope({root,env,frozen}));writeFileSync(join(home,'.ssh/known_hosts'),'changed');assert.throws(()=>assertPreflightControlScope({root,env,frozen}),/PREFLIGHT_CONTROL/);
});

test('owned local PG pool enforces the original absolute deadline without closing an independent connection',{skip:process.platform!=='darwin'},async t=>{
 isolatePrivatePgEnvironment(t);
 const {privatePgSsh}=await import('./helpers/preflight-private-pg-ssh.mjs');
 const f=await privatePgSsh(t),{createRequire}=await import('node:module'),{Pool}=createRequire(import.meta.url)('pg');
 const {createPreflightLocalPool}=await import('../preflight-control-scope.mjs');const uri=`postgresql://preflight_fixture@127.0.0.1:${f.connection.port}/postgres`,start=Date.now();
 const owned=createPreflightLocalPool({Pool,connectionString:uri,deadlineMs:start+200});f.beforeStop(()=>owned.transport.close());
 await assert.rejects(()=>owned.pool.query('SELECT pg_sleep(2)'));const proof=await owned.transport.close();assert.equal(proof.execution_stopped,false);assert.equal(proof.deadline_exceeded,true);assert.equal(owned.pool.ended,true);assert.ok(Date.now()-start<1500);
 const separate=new Pool(f.connection);try{assert.equal((await separate.query('SELECT 1 AS actual')).rows[0].actual,1);}finally{await separate.end();}
});


test('explicit existing cloud registry metadata freezes path/full bytes/row and rejects restart drift without default fallback',async t=>{
 const {freezePreflightProfile,assertPreflightProfile}=await import('../preflight-control-scope.mjs');assert.equal(typeof freezePreflightProfile,'function');
 const directory=realpathSync(mkdtempSync(join(os.tmpdir(),'preflight-cloud-profile-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));const path=join(directory,'cloud-phone-test-profiles.tsv');
 const text='profile\tserial\tmodel\twidth\theight\tenabled\ncloud-phone-test\t47.100.213.173:10001\tiPad Pro\t720\t1280\ttrue\n';writeFileSync(path,text,{mode:0o600});
 const env={HOME:directory,P:'cloud-phone-test',SERIAL:'47.100.213.173:10001',DOUYIN_PHONE_REGISTRY:path},profile=freezePreflightProfile({env});assert.equal(profile.path,path);assert.equal(profile.sha256,sha(Buffer.from(text)));assert.deepEqual([profile.model,profile.width,profile.height,profile.enabled],['iPad Pro',720,1280,true]);
 const frozen={agent_input:{profile:env.P,serial:env.SERIAL},preflight_profile:profile};assert.deepEqual(assertPreflightProfile({env,frozen}),profile);assert.throws(()=>assertPreflightProfile({env,frozen:{...frozen,preflight_profile:undefined}}),/PREFLIGHT_PROFILE/);
 const another=join(directory,'other.tsv');writeFileSync(another,text,{mode:0o600});assert.throws(()=>assertPreflightProfile({env:{...env,DOUYIN_PHONE_REGISTRY:another},frozen}),/PREFLIGHT_PROFILE/);
 for(const change of [text.replace('720','721'),text.replace('iPad Pro','Other'),text.replace('true','0'),text.replace(':10001',':10002'),text+'#different full-file bytes\n']){writeFileSync(path,change);assert.throws(()=>assertPreflightProfile({env,frozen}),/PREFLIGHT_PROFILE/);}writeFileSync(path,text);
 assert.throws(()=>freezePreflightProfile({env:{...env,DOUYIN_PHONE_REGISTRY:undefined}}),/PREFLIGHT_PROFILE/);
});
