import {readPhonePeerPrivateEnvironment} from './official-phone-peer-private-env.mjs';
// Fixed SSH stdio entry. No listening socket, model session or Activity loop.
import {createInterface} from 'node:readline';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hostname} from 'node:os';
import {peerHash,phonePeerEnvelope,verifyPhonePeerEnvelope,createPhonePeerOperationHost} from './official-phone-peer-protocol.mjs';
import {createPhonePeerRuntime} from './official-phone-peer-runtime.mjs';
export async function runPhonePeerStdio({input=process.stdin,output=process.stdout,environment=process.env,root=dirname(fileURLToPath(import.meta.url))}={}){
 const key=environment.KERNEL_FLEET_BRIDGE_TOKEN;
 if(typeof key!=='string'||key.length<32||!environment.BRAIN_URL||!environment.BRAIN_INTERNAL_TOKEN)throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');
 let runtime,host,deadline,closed=false;
 const emit=value=>new Promise((yes,no)=>output.write(JSON.stringify(value)+'\n',error=>error?no(error):yes()));
 const lines=createInterface({input,crlfDelay:Infinity,terminal:false});
 try{
  for await(const line of lines){
   if(Buffer.byteLength(line)>16*1024*1024)throw Error('OFFICIAL_PHONE_PEER_FRAME');
   const envelope=JSON.parse(line);
   if(!host){
    const bootstrap=verifyPhonePeerEnvelope(envelope,key);
    runtime=await createPhonePeerRuntime({bootstrap,root,environment});
    host=createPhonePeerOperationHost({session:runtime.session,key,directory:runtime.directory,authorize:runtime.assertAuthority,execute:runtime.execute,snapshot:runtime.snapshot,seal:runtime.close,hostIdentity:{hostname:hostname(),pid:process.pid,uid:process.getuid(),runtime_root:root}});
    deadline=setTimeout(()=>{lines.close();input.destroy();},Math.max(1,runtime.session.deadline_ms-Date.now()));
    await emit(phonePeerEnvelope({protocol:'official-phone-peer-ready/v1',session_sha256:peerHash(runtime.session),descriptor_sha256:runtime.session.descriptor_sha256,host:'xian-m4'},key));
   }else{await emit(await host.handle(envelope));if(host.snapshot().closed)closed=true;}
  }
  if(!closed)throw Error('OFFICIAL_PHONE_PEER_UNSEALED_EOF');
 }finally{clearTimeout(deadline);lines.close();if(runtime&&!closed)await runtime.abort();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||process.argv[2]!=='--stdio')process.exitCode=64;
 else runPhonePeerStdio({environment:{...process.env,...readPhonePeerPrivateEnvironment(process.env.HOME)}}).catch(()=>{process.stderr.write('OFFICIAL_PHONE_PEER_FAILED\n');process.exitCode=1;});
}
