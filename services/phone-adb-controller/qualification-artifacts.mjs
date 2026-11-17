// Host-only, read-only verification of frozen qualification originals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Error(code);};
function pinned(file,expected){
 if(typeof file!=='string'||!path.isAbsolute(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||!/^[a-f0-9]{64}$/.test(expected||''))fail('QUALIFICATION_SOURCE_UNBOUND');
 const bytes=fs.readFileSync(file);if(digest(bytes)!==expected)fail('QUALIFICATION_SOURCE_CHANGED');return bytes;
}
export function verifyQualificationDeviceBinding({context:c,spec,videoId,originRun,platformAccounts},env){
 if(spec.video_id!==videoId||spec.expected_run!==originRun||spec.serial!==c.serial)fail('QUALIFICATION_ARTIFACT_SCOPE_MISMATCH');
 if(!env||env.ZJ_ADB_HOST_CONFIG!==c.adb_host_config||env.DOUYIN_PHONE_REGISTRY!==c.phone_registry)fail('QUALIFICATION_TRANSPORT_ENV_UNBOUND');
 for(const key of ['phone_controller','adb_host_config','phone_registry'])pinned(c[key],c[key+'_sha256']);
 const root=fs.realpathSync(c.runtime_root);if(!fs.realpathSync(c.phone_controller).startsWith(root+path.sep))fail('QUALIFICATION_CONTROLLER_SCOPE');
 const policy=JSON.parse(fs.readFileSync(c.adb_host_config));if(![1,2].includes(policy.schema_version)||!['mmv','xian-m4'].includes(policy.host_id)||!/^tcp:127\.0\.0\.1:\d{1,5}$/.test(policy.endpoint||''))fail('QUALIFICATION_HOST_POLICY');
 const lines=fs.readFileSync(c.phone_registry,'utf8').split(/\r?\n/).filter(x=>x&&!x.startsWith('#')),header=lines.shift()?.split('\t');
 if(!header||!['profile','serial','enabled'].every(x=>header.includes(x)))fail('QUALIFICATION_REGISTRY_SCHEMA');
 const rows=lines.map(x=>Object.fromEntries(x.split('\t').map((v,i)=>[header[i],v]))).filter(x=>x.profile===c.profile);
 if(rows.length!==1||rows[0].enabled!=='true'||rows[0].serial!==c.adb_serial||spec.serial!==rows[0].serial)fail('QUALIFICATION_ADB_BINDING_MISMATCH');
 const accounts=platformAccounts?.filter(x=>x.profile===c.profile);
 if(accounts?.length!==1||accounts[0].enabled!==true||accounts[0].verification_status!=='verified'||accounts[0].device_serial!==c.serial||accounts[0].douyin_id!==c.account)fail('QUALIFICATION_PHYSICAL_BINDING_MISMATCH');
 const relative='runtime/runtime-policy-sdk33.json',runtime=JSON.parse(pinned(path.join(root,relative),c.verification?.runtime_sha256?.[relative]));
 if(runtime.schema!=='scrcpy-sdk33-pinned-v1'||runtime.version!=='3.3.4'||spec.client_sha256!==runtime.client_sha256||spec.server_sha256!==runtime.server_sha256)fail('QUALIFICATION_RUNTIME_BINDING_MISMATCH');
 return {physical_serial:c.serial,adb_serial:rows[0].serial,profile:c.profile,policy_sha256:c.adb_host_config_sha256,registry_sha256:c.phone_registry_sha256};
}
export async function verifyQualificationArtifacts(input,{env,pythonBin='/usr/bin/python3'}={}){
 const device_binding=verifyQualificationDeviceBinding(input,env),program=fileURLToPath(new URL('./qualification-artifacts.py',import.meta.url));
 pinned(program,input.context.verification.qualification_sha256?.['qualification-artifacts.py']);
 pinned(fileURLToPath(import.meta.url),input.context.verification.qualification_sha256?.['qualification-artifacts.mjs']);
 if(typeof pythonBin!=='string'||!path.isAbsolute(pythonBin))fail('QUALIFICATION_PYTHON_UNBOUND');
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(pythonBin,[program],{env,stdio:['pipe','pipe','pipe']});let output='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('QUALIFICATION_CHECK_TIMEOUT'));},20000);
  child.stdout.on('data',b=>{output+=b;if(output.length>1024*1024){child.kill('SIGKILL');finish(Error('QUALIFICATION_CHECK_OUTPUT_LIMIT'));}});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.once('error',()=>finish(Error('QUALIFICATION_CHECK_UNAVAILABLE')));
  child.once('close',code=>{if(code!==0)return finish(Error('QUALIFICATION_CHECK_FAILED'));try{finish(null,JSON.parse(output));}catch{finish(Error('QUALIFICATION_CHECK_INVALID'));}});
  child.stdin.end(JSON.stringify({kind:'recording',spec:input.spec}));
 });
 return {...result,device_binding};
}
