// Parent-only metadata operations. Business rules remain in the original RPC functions.
import {appendFileSync} from 'node:fs';import {join} from 'node:path';import {randomUUID,createHash,createHmac,timingSafeEqual,createPrivateKey,createPublicKey} from 'node:crypto';
import {handleRpc,verifyRpcSource} from './leadgen-rpc.mjs';
const fail=code=>Object.assign(Error(code),{code});
export function createPreflightMetadata({directory,scope,source,createPool,verify=verifyRpcSource}){
 if(!['douyin_video_discovery','douyin_video_processing'].includes(scope?.workflow)||typeof createPool!=='function')throw fail('PREFLIGHT_METADATA_SCOPE');
 const fixed=structuredClone(scope),pending=new Set(),transports=new Set();let sealed=false,unknown=false;
 const ledger=join(directory,'preflight-metadata-'+randomUUID()+'.jsonl');
 const record=value=>{try{appendFileSync(ledger,JSON.stringify(value)+'\n',{mode:0o600});}catch{unknown=true;throw fail('PREFLIGHT_METADATA_RECORD_FAILED');}};
 const active=deadline=>{if(unknown)throw fail('PREFLIGHT_METADATA_UNKNOWN');if(sealed||!Number.isSafeInteger(deadline)||Date.now()>=deadline)throw fail('PREFLIGHT_METADATA_DEADLINE');};
 const admitted=input=>{
  const q=input?.request,step=fixed.workflow==='douyin_video_discovery'?'101':'102';
  if(input?.kind==='keywords'){
   if(step!=='101'||Object.keys(input).some(k=>!['kind','line','run','limit','keywords'].includes(k))||input.line!==fixed.line||input.run!==fixed.run||input.limit!==2||JSON.stringify(input.keywords)!==JSON.stringify(fixed.sources))throw fail('PREFLIGHT_METADATA_SCOPE');
  }else if(input?.kind!=='queue'||Object.keys(input).sort().join(',')!=='kind,request'||q?.op!=='company_config'||q.step!==step||q.line!==fixed.line||q.run!==fixed.run||q.source_run!==(fixed.source_run||undefined)||q.limit!==fixed.limit
   ||Object.keys(q).some(k=>!['op','step','line','run','source_run','limit','device_binding'].includes(k))||!q.device_binding||Object.keys(q.device_binding).sort().join(',')!=='device_serial,profile'||q.device_binding.profile!==fixed.profile||q.device_binding.device_serial!==fixed.serial)throw fail('PREFLIGHT_METADATA_SCOPE');
 };
 const call=async(input,{scope:activity}={})=>{
  admitted(input);const deadline=Math.min(activity?.worker_deadline_ms??activity?.deadline_ms,activity?.deadline_ms);active(deadline);
  try{verify(source);}catch{throw fail('PREFLIGHT_METADATA_SOURCE');}
  const operation=input.kind==='keywords'?'keywords':'company_config',id=randomUUID();record({id,operation,event:'intent'});
  let pool,transport;const job=(async()=>{
   try{
    const allocated=await createPool({deadlineMs:deadline});pool=allocated.pool;transport=allocated.transport;transports.add(transport);pool.on?.('error',()=>{unknown=true;void transport.close().catch(()=>{});});active(deadline);
    // A successfully authenticated endpoint must also match the authorized database identity.
    const expected=allocated.expectedIdentity;if(!expected?.database||!expected?.role)throw fail('PREFLIGHT_METADATA_IDENTITY');
    const identityClient=await pool.connect();let identityComplete=false;
    try{
     active(deadline);await identityClient.query('BEGIN READ ONLY');active(deadline);
     const sql=expected.system_identifier===undefined?'SELECT current_database() AS database, current_user AS role':'SELECT current_database() AS database, current_user AS role, system_identifier::text FROM pg_control_system()';
     const identity=(await identityClient.query(sql)).rows;
     if(identity.length!==1||identity[0].database!==expected.database||identity[0].role!==expected.role||expected.system_identifier!==undefined&&identity[0].system_identifier!==expected.system_identifier)throw fail('PREFLIGHT_METADATA_IDENTITY');
     active(deadline);await identityClient.query('COMMIT');identityComplete=true;
    }finally{identityClient.release(!identityComplete);}active(deadline);
    const guarded={query:(...args)=>{active(deadline);return pool.query(...args);},connect:async()=>{active(deadline);const client=await pool.connect();try{active(deadline);}catch(error){client.release();throw error;}return {query:(...args)=>{active(deadline);return client.query(...args);},release:()=>client.release()};},end:async()=>{}};
    const result=await handleRpc({...input,source},{verify:()=>{},pool:guarded});active(deadline);
    await pool.end();pool=null;const proof=await transport.seal();if(proof.execution_stopped!==true)throw fail('PREFLIGHT_METADATA_UNKNOWN');active(deadline);
    record({id,operation,event:'returned'});return result;
   }catch(error){
    unknown=true;const sqlstate=/^[0-9A-Z]{5}$/.test(error?.code||'')?error.code:undefined;
    try{record({id,operation,event:'unknown',...(sqlstate?{sqlstate}:{})});}catch{}
    // Never propagate PG errors, options, URI, stderr or nested causes to Runner/Agent logs.
    throw fail('PREFLIGHT_METADATA_UNKNOWN');
   }finally{
    if(pool){try{await transport?.close();}catch{}try{await pool.end();}catch{}}
   }
  })();pending.add(job);try{return await job;}finally{pending.delete(job);}
 };
 call.assertActive=()=>{if(unknown)throw fail('PREFLIGHT_METADATA_UNKNOWN');if(sealed)throw fail('PREFLIGHT_METADATA_DEADLINE');};
 call.close=async()=>{sealed=true;if(pending.size)unknown=true;await Promise.allSettled([...transports].map(t=>t.close()));await Promise.allSettled([...pending]);return {sealed,execution_stopped:!unknown,pending:pending.size};};
 call.snapshot=()=>({sealed,unknown,pending:pending.size,ledger});return call;
}


const fingerprint=blob=>'SHA256:'+createHash('sha256').update(blob).digest('base64').replace(/=+$/,'');
function sshString(value){const length=Buffer.alloc(4);length.writeUInt32BE(value.length);return Buffer.concat([length,value]);}
export function preflightSshIdentityFingerprint(bytes){
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length>128*1024)throw Error();const text=bytes.toString('ascii');
  if(text.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')){
   const body=text.match(/^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END OPENSSH PRIVATE KEY-----\s*$/);if(!body)throw Error();
   const data=Buffer.from(body[1].replace(/\s/g,''),'base64'),magic=Buffer.from('openssh-key-v1\0');if(!data.subarray(0,magic.length).equals(magic))throw Error();let at=magic.length;
   const str=()=>{if(at+4>data.length)throw Error();const length=data.readUInt32BE(at);at+=4;if(length>data.length-at)throw Error();const out=data.subarray(at,at+length);at+=length;return out;};
   if(str().toString()!=='none'||str().toString()!=='none'||str().length!==0||at+4>data.length||data.readUInt32BE(at)!==1)throw Error();at+=4;
   const publicBlob=str();str();if(at!==data.length)throw Error();return fingerprint(publicBlob);
  }
  const privateKey=createPrivateKey(bytes);if(privateKey.asymmetricKeyType!=='rsa')throw Error();const publicKey=createPublicKey(privateKey).export({format:'jwk'});
  const mpint=key=>{const raw=Buffer.from(publicKey[key],'base64url');return raw[0]&0x80?Buffer.concat([Buffer.from([0]),raw]):raw;};
  return fingerprint(Buffer.concat([sshString(Buffer.from('ssh-rsa')),sshString(mpint('e')),sshString(mpint('n'))]));
 }catch{throw fail('PREFLIGHT_CONTROL_IDENTITY');}
}
function selectPreflightKnownHostKey(text,alias,expected){
 try{
  const matches=token=>{
   if(token===alias)return true;if(!token.startsWith('|1|'))return false;const parts=token.split('|');if(parts.length!==4)return false;
   const actual=createHmac('sha1',Buffer.from(parts[2],'base64')).update(alias).digest(),stored=Buffer.from(parts[3],'base64');return stored.length===actual.length&&timingSafeEqual(stored,actual);
  };
  const selected=[];
  for(const line of text.split(/\r?\n/)){
   const fields=line.trim().split(/\s+/);if(!line.trim()||line.trim().startsWith('#'))continue;
   const marked=fields[0].startsWith('@'),hosts=fields[marked?1:0],kind=fields[marked?2:1],blob=fields[marked?3:2];
   if(!hosts||!blob||!hosts.split(',').some(matches))continue;
   if(fingerprint(Buffer.from(blob,'base64'))!==expected)continue;
   if(marked||!['ssh-ed25519','ssh-rsa','ecdsa-sha2-nistp256'].includes(kind))throw Error();selected.push({kind,blob:Buffer.from(blob,'base64').toString('base64')});
  }
  if(selected.length!==1)throw Error();return selected[0];
 }catch{throw fail('PREFLIGHT_CONTROL_HOST_KEY');}
}

export function preflightKnownHostKey(text,alias,expected){return selectPreflightKnownHostKey(text,alias,expected).kind;}
export function preflightPinnedKnownHosts(text,alias,expected,kind){
 if(!/^[-A-Za-z0-9_.]{1,200}$/.test(alias||''))throw fail('PREFLIGHT_CONTROL_HOST_KEY');
 const entry=selectPreflightKnownHostKey(text,alias,expected);if(entry.kind!==kind)throw fail('PREFLIGHT_CONTROL_HOST_KEY');
 return Buffer.from(alias+' '+entry.kind+' '+entry.blob+'\n');
}
