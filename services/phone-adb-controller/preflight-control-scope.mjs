// File-only authorization input. Private values never enter a frozen snapshot or diagnostic.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {userInfo} from 'node:os';import {createHash} from 'node:crypto';
import {preflightSshIdentityFingerprint,preflightKnownHostKey} from './preflight-metadata.mjs';
const path='config/preflight-control-hosts.json',repo='perfectuser21/zenithjoy-workspace',mmv='ed3555dc-4777-446c-bdf0-d928d6a08ef1',sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const fail=()=>{throw Error('PREFLIGHT_CONTROL_SCOPE');};
function privateBytes(file){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>256*1024)fail();return readFileSync(file);}
function material({root,env,runtimeTransport}){
 try{
  const manifest=JSON.parse(readFileSync(join(root,'deployment-manifest.json'),'utf8')),entry=manifest.files?.find(x=>x.deployed_path===path),bytes=readFileSync(join(root,path));
  if(manifest.source_repo!==repo||!/^[a-f0-9]{40}$/.test(manifest.source_commit||'')||entry?.path!=='services/phone-adb-controller/'+path||entry.content_sha256!==sha(bytes))fail();
  const policy=JSON.parse(bytes);if(policy.version!==1||!Array.isArray(policy.hosts))fail();const rows=policy.hosts.filter(h=>h.target===manifest.target);if(rows.length!==1)fail();const h=rows[0],home=realpathSync(userInfo().homedir);
  if(realpathSync(h.home)!==home||realpathSync(env.HOME)!==home||!['ssh','local'].includes(h.mode))fail();
  const identity=policy.database_identity;if(!identity?.database||!identity.role||!/^\d{1,30}$/.test(identity.system_identifier||''))fail();
  const credentials=join(home,'.credentials/zenithjoy-db.env'),credentialBytes=privateBytes(credentials),lines=credentialBytes.toString('utf8').split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
  if(lines.length!==1||!lines[0].startsWith('DATABASE_URL='))fail();let uri=lines[0].slice(13);if(/^(['"]).*\1$/.test(uri))uri=uri.slice(1,-1);const url=new URL(uri);
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='15532'||decodeURIComponent(url.username)!==identity.role||!url.password||url.pathname!=='/'+identity.database)fail();
  const scope={version:1,target:manifest.target,source_commit:manifest.source_commit,policy_sha256:sha(bytes),mode:h.mode,credentials_path:credentials,credentials_sha256:sha(credentialBytes),database_identity:structuredClone(identity)};
  if(h.mode==='ssh'){
   const ssh=h.ssh;if(ssh?.ssh_bin!=='/usr/bin/ssh'||!/^[a-f0-9]{64}$/.test(ssh.ssh_sha256||'')||sha(readFileSync(ssh.ssh_bin))!==ssh.ssh_sha256||ssh.port!==22||!/^[-A-Za-z0-9_]+$/.test(ssh.user||''))fail();
   const ip=v=>typeof v==='string'&&/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v)&&v.split('.').every(n=>Number(n)<256);
   if(runtimeTransport?.machine_id!==mmv||!ip(runtimeTransport.ssh_hostname)||!ip(runtimeTransport.ssh_hostkey_alias))fail();
   const key=join(home,'.ssh/id_rsa'),known=join(home,'.ssh/known_hosts'),keyBytes=privateBytes(key),knownBytes=privateBytes(known);
   if(preflightSshIdentityFingerprint(keyBytes)!==ssh.identity_fingerprint||preflightKnownHostKey(knownBytes.toString('utf8'),runtimeTransport.ssh_hostkey_alias,ssh.host_key_fingerprint)!==ssh.host_key_kind)fail();
   scope.ssh={ssh_bin:ssh.ssh_bin,ssh_sha256:ssh.ssh_sha256,hostname:runtimeTransport.ssh_hostname,hostkey_alias:runtimeTransport.ssh_hostkey_alias,user:ssh.user,port:22,identity:key,identity_sha256:sha(keyBytes),identity_fingerprint:ssh.identity_fingerprint,known_hosts:known,known_hosts_sha256:sha(knownBytes),host_key_fingerprint:ssh.host_key_fingerprint,host_key_kind:ssh.host_key_kind,pg_port:15532};
  }
  return {scope,uri};
 }catch{fail();}
}
export function freezePreflightControlScope({root,env,runtimeTransport}){
 if(env.LEADGEN_EXECUTION_MODE!=='agent'||!['douyin_video_discovery','douyin_video_processing'].includes(env.WF_BRAIN_WORKFLOW))return undefined;
 return material({root,env,runtimeTransport}).scope;
}
export function assertPreflightControlScope({root,env,frozen}){
 if(!frozen?.preflight_control_scope||frozen.execution_mode!=='agent'||!['douyin_video_discovery','douyin_video_processing'].includes(frozen.workflow_version?.payload?.key))fail();
 const actual=material({root,env,runtimeTransport:frozen.runtime_transport}).scope;
 if(actual.source_commit!==frozen.deployment.source_commit||actual.target!==frozen.deployment.target||frozen.files?.['runtime/'+path]!==actual.policy_sha256||canonical(actual)!==canonical(frozen.preflight_control_scope))fail();return actual;
}
export function createPreflightPoolFactory({runtimeRoot,frozen,env}){
 const scope=assertPreflightControlScope({root:runtimeRoot,env,frozen});
 return async({deadlineMs})=>{
  if(!Number.isSafeInteger(deadlineMs)||Date.now()>=deadlineMs)throw Error('PREFLIGHT_CONTROL_DEADLINE');assertPreflightControlScope({root:runtimeRoot,env,frozen});
  const {loadPreflightPg}=await import('./preflight-pg-dependencies.mjs'),{Pool}=loadPreflightPg({runtimeRoot,frozen});
  const {uri}=material({root:runtimeRoot,env,runtimeTransport:frozen.runtime_transport});let transport,pool;
  if(scope.mode==='ssh'){
   const {createPreflightPgStream}=await import('./preflight-pg-stream.mjs');transport=await createPreflightPgStream({directory:env.WFR_RUN_DIR,policy:scope.ssh,deadlineMs});
   pool=new Pool({connectionString:uri,max:1,stream:transport.stream,connectionTimeoutMillis:Math.max(1,deadlineMs-Date.now()),application_name:'zenithjoy-preflight'});
  }else{
   ({pool,transport}=createPreflightLocalPool({Pool,connectionString:uri,deadlineMs}));
  }
  return {pool,transport,expectedIdentity:structuredClone(scope.database_identity)};
 };
}

// One private Pool per admitted metadata request. Ending its owned clients is
// transport closure only; the metadata caller preserves all commit uncertainty.
export function createPreflightLocalPool({Pool,connectionString,deadlineMs}){
 if(!Number.isSafeInteger(deadlineMs)||Date.now()>=deadlineMs)throw Error('PREFLIGHT_CONTROL_DEADLINE');
 const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:Math.max(1,deadlineMs-Date.now()),query_timeout:Math.max(1,deadlineMs-Date.now()),application_name:'zenithjoy-preflight'}),clients=new Set();let timedOut=false,closed=false,closing;
 pool.on('connect',client=>{clients.add(client);if(closed||Date.now()>=deadlineMs){timedOut=true;void client.end().catch(()=>{});}});pool.on('remove',client=>clients.delete(client));
 const close=()=>closing??=(async()=>{closed=true;clearTimeout(timer);if(Date.now()>=deadlineMs)timedOut=true;await Promise.allSettled([...clients].map(client=>client.end()));if(!pool.ending)await pool.end();return {domain:'parent-pg-no-native-process-v1',execution_stopped:pool.ended===true&&!timedOut,deadline_exceeded:timedOut};})();
 const timer=setTimeout(()=>{timedOut=true;void close().catch(()=>{});},Math.max(1,deadlineMs-Date.now()));timer.unref();
 return {pool,transport:{seal:close,close}};
}
