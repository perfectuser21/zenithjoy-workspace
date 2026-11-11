import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,realpathSync,rmSync,cpSync,appendFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fileURLToPath} from 'node:url';
import {createAdbShellV2Observer} from '../adb-shell-v2.mjs';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source={commit:'a'.repeat(40),files:['adb-shell-v2.mjs','adb-shell-v2-protocol.mjs'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
const frame=(id,bytes)=>{const header=Buffer.alloc(5);header[0]=id;header.writeUInt32LE(bytes.length,1);return Buffer.concat([header,bytes]);};

// A real loopback smart-socket peer only; no installed ADB service or phone.
async function runWire(t,{sdk='31',early=false,missingExit=false,holdEof=false}={}){
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'shell-v2-durable-'))),directory=join(temporary,'journal');mkdirSync(directory,{mode:0o700});
 const connections=new Set(),requests=[];let connectionIndex=0,closeStdinReceived=false;
 const server=createServer(socket=>{
  connections.add(socket);socket.on('error',()=>{});socket.once('close',()=>connections.delete(socket));
  const index=connectionIndex++;let buffered=Buffer.alloc(0),phase=0;
  const output=()=>socket[holdEof?'write':'end'](Buffer.concat([frame(1,Buffer.from(sdk+'\n')),frame(2,Buffer.from('fixture-stderr\n')),...(missingExit?[]:[frame(3,Buffer.from([0]))])]));
  socket.on('data',bytes=>{
   buffered=Buffer.concat([buffered,bytes]);
   while(true){
    if(index===1&&phase===2){
     if(early)return;
     if(buffered.length<5)return;
     assert.deepEqual(buffered.subarray(0,5),Buffer.from([4,0,0,0,0]));closeStdinReceived=true;phase=3;output();return;
    }
    if(buffered.length<4)return;
    const size=parseInt(buffered.subarray(0,4).toString('ascii'),16);if(buffered.length<4+size)return;
    const request=buffered.subarray(4,4+size).toString('ascii');buffered=buffered.subarray(4+size);requests.push(request);
    if(index===0){assert.equal(request,'host-serial:synthetic-fixture:features');socket.end('OKAY0008shell_v2');return;}
    if(phase===0)assert.equal(request,'host:transport:synthetic-fixture');
    else assert.equal(request,'shell,v2,raw:exec /system/bin/uiautomator dump --compressed /sdcard/douyin-leadgen-ui-synthetic.xml');
    socket.write('OKAY');phase++;
    if(phase===2&&early){output();return;}
   }
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;assert.ok(![5037,5041].includes(port));
 const now=Date.now(),scope={protocol:'adb-shell-v2-observation/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_video_discovery-synthetic__a1',source_commit:source.commit,profile:'synthetic',serial:'synthetic-fixture',endpoint:'tcp:127.0.0.1:'+port,epoch:1,claim:{claimed_by:'synthetic-wire-test',claimed_at:new Date(now).toISOString()},worker_deadline_ms:now+(holdEof?650:5000),cleanup_deadline_ms:now+6000};
 const observer=createAdbShellV2Observer({source,runtimeRoot:root,directory,scope,readAuthority:async()=>{
  // Force a short command's EXIT/EOF to arrive during authority admission.
  await new Promise(resolve=>setTimeout(resolve,10));
  return {scope,claimed_by:scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(scope.cleanup_deadline_ms+1000).toISOString()};
 }});
 t.after(async()=>{await observer.close();for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));rmSync(temporary,{recursive:true,force:true});});
 let receipt,error;try{receipt=await observer.observeDump();}catch(value){error=value;}
 const stopped=await observer.close(),names=readdirSync(directory).sort(),read=name=>JSON.parse(readFileSync(join(directory,name),'utf8'));
 return {receipt,error,stopped,names,read,scope,requests,closeStdinReceived};
}

for(const sdk of ['31','32'])test('wire outcome durably distinguishes SDK '+sdk+' output while preserving EXIT and both socket EOF/close events',async t=>{
 const f=await runWire(t,{sdk});assert.equal(f.error,undefined);assert.equal(f.receipt.exit_code,0);assert.equal(f.stopped.wire_complete,true);
 assert.equal(f.closeStdinReceived,true);
 for(const index of [0,1]){assert.ok(f.names.includes('socket-'+index+'.end.json'),'peer EOF must be durable');assert.ok(f.names.includes('socket-'+index+'.close.json'),'actual socket close must be durable');}
 for(const index of [0,1,2,3])assert.ok(f.names.includes('write-'+index+'.result.json'),'write callback result must be durable');
 const outcome=f.read('command.outcome.json');assert.equal(outcome.exit_code,0);assert.equal(Buffer.from(outcome.stdout_base64,'base64').toString(),sdk+'\n');assert.equal(Buffer.from(outcome.stderr_base64,'base64').toString(),'fixture-stderr\n');
 const terminal=f.read('terminal.json');assert.equal(terminal.error_code,null);assert.equal(terminal.snapshot.pending,0);assert.equal(terminal.snapshot.open_sockets,0);assert.equal(terminal.snapshot.wire_complete,true);assert.equal(terminal.snapshot.remote_execution_stopped,'not_attested');assert.match(terminal.scope_sha256,/^[a-f0-9]{64}$/);
});

test('short command EXIT and peer EOF before CloseStdin remains a complete wire outcome',async t=>{
 const f=await runWire(t,{early:true});assert.equal(f.error,undefined,'peer already ended must not turn a complete short command into a late write failure');assert.equal(f.receipt.exit_code,0);assert.equal(f.closeStdinReceived,false);
 const outcome=f.read('command.outcome.json');assert.equal(Buffer.from(outcome.stdout_base64,'base64').toString(),'31\n');assert.equal(outcome.exit_code,0);
 const terminal=f.read('terminal.json');assert.equal(terminal.error_code,null);assert.equal(terminal.snapshot.wire_complete,true);assert.equal(terminal.snapshot.remote_execution_stopped,'not_attested');
 assert.ok(f.names.includes('socket-1.end.json'));assert.ok(f.names.includes('socket-1.close.json'));
});

test('peer EOF without shell EXIT leaves an exact durable unknown reason and final socket state',async t=>{
 const f=await runWire(t,{early:true,missingExit:true});assert.ok(f.error);assert.equal(f.receipt,undefined);assert.equal(f.stopped.unknown,true);assert.equal(f.stopped.wire_complete,false);
 const terminal=f.read('terminal.json');assert.equal(terminal.error_code,f.error.code);assert.ok(terminal.snapshot.unknown_reasons.includes(f.error.code));assert.equal(terminal.snapshot.pending,0);assert.equal(terminal.snapshot.open_sockets,0);assert.equal(terminal.snapshot.remote_execution_stopped,'not_attested');
 assert.ok(f.names.includes('socket-1.end.json'));assert.ok(f.names.includes('socket-1.close.json'));
 assert.equal(f.names.includes('command.outcome.json'),false,'EOF cannot synthesize a decoded EXIT outcome');
});

// A peer that sends EXIT but never closes must not erase the decoded outcome
// when the deadline eventually seals the still-open channel.
test('decoded EXIT is durable even when peer withholds EOF until the deadline',async t=>{
 const f=await runWire(t,{holdEof:true});assert.ok(f.error);assert.equal(f.stopped.unknown,true);
 const outcome=f.read('command.outcome.json');assert.equal(outcome.exit_code,0);assert.equal(Buffer.from(outcome.stdout_base64,'base64').toString(),'31\n');
 const terminal=f.read('terminal.json');assert.equal(terminal.snapshot.wire_complete,false);assert.ok(terminal.snapshot.unknown_reasons.includes('ADB_SHELL_V2_DEADLINE'));assert.equal(terminal.snapshot.remote_execution_stopped,'not_attested');
});

test('unreturned authority admission leaves a durable pending close snapshot without asserting wire completion',async t=>{
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'shell-v2-pending-'))),directory=join(temporary,'journal');mkdirSync(directory,{mode:0o700});t.after(()=>rmSync(temporary,{recursive:true,force:true}));
 const now=Date.now(),scope={protocol:'adb-shell-v2-observation/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'douyin_video_discovery-synthetic__a1',source_commit:source.commit,profile:'synthetic',serial:'synthetic-fixture',endpoint:'tcp:127.0.0.1:1',epoch:1,claim:{claimed_by:'synthetic-pending-test',claimed_at:new Date(now).toISOString()},worker_deadline_ms:now+200,cleanup_deadline_ms:now+300};
 let admissions=0;
 const observer=createAdbShellV2Observer({source,runtimeRoot:root,directory,scope,readAuthority:()=>{admissions++;return new Promise(()=>{});}});
 await assert.rejects(()=>observer.observeDump(),/ADB_SHELL_V2_CLOSED|ADB_SHELL_V2_DEADLINE/);
 const stopped=await observer.close();assert.equal(admissions,1);assert.equal(stopped.pending,1);assert.equal(stopped.open_sockets,0,'admission has not authorized any socket');assert.equal(stopped.unknown,true);assert.equal(stopped.wire_complete,false);assert.ok(stopped.unknown_reasons.includes('ADB_SHELL_V2_CLEANUP_PENDING'));
 const names=readdirSync(directory);assert.ok(names.includes('close-0.snapshot.json'),'a close that cannot drain the pipeline must durably retain its pending state');
 const close=JSON.parse(readFileSync(join(directory,'close-0.snapshot.json'),'utf8'));assert.deepEqual(close.snapshot,stopped);assert.match(close.scope_sha256,/^[a-f0-9]{64}$/);assert.match(close.error_code,/^ADB_SHELL_V2_[A-Z_]+$/);assert.ok(Number.isFinite(Date.parse(close.observed_at)));assert.equal(close.snapshot.remote_execution_stopped,'not_attested');
 assert.equal(names.includes('command.outcome.json'),false);assert.equal(names.includes('terminal.json'),false,'a pending pipeline has not produced a terminal outcome');
});

async function fragmentedWire(t,{pieces=1,change,changeAt='payload',trailing=false}={}){
 const temporary=realpathSync(mkdtempSync(join(tmpdir(),'shell-v2-fragments-'))),runtime=join(temporary,'runtime'),directory=join(temporary,'journal');
 mkdirSync(runtime,{mode:0o700});mkdirSync(directory,{mode:0o700});
 cpSync(root,runtime,{recursive:true,filter:path=>!path.split('/').some(part=>['__tests__','node_modules','__pycache__'].includes(part))});
 const fixed={commit:source.commit,files:source.files.map(f=>({...f,sha256:sha(readFileSync(join(runtime,f.path)))}))};
 const {createAdbShellV2Observer:create}=await import(pathToFileURL(join(runtime,'adb-shell-v2.mjs')));
 const sockets=new Set(),requests=[],timers=new Set();let connections=0,admissions=0,revoked=false,observer;
 const mutate=()=>{
  if(change==='source')appendFileSync(join(runtime,'adb-shell-v2-protocol.mjs'),'\n');
  else if(change==='owner')chmodSync(directory,0o755);
  else if(change==='cancel')observer.seal();
  else if(change)revoked=true;
 };
 const later=fn=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},15);timers.add(timer);};
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));
  const index=connections++;let buffer=Buffer.alloc(0),phase=0;
  const output=()=>{
   let n=0;const send=()=>{
    if(socket.destroyed)return;
    if(n===pieces){socket.end(Buffer.concat([frame(3,Buffer.from([0])),...(trailing?[frame(1,Buffer.from('late'))]:[])]));return;}
    socket.write(frame(1,Buffer.from('part-'+n+'\n')));if(n++===0&&changeAt==='payload')mutate();later(send);
   };send();
  };
  socket.on('data',bytes=>{
   buffer=Buffer.concat([buffer,bytes]);
   while(true){
    if(index===1&&phase===2){if(buffer.length<5)return;assert.deepEqual(buffer.subarray(0,5),Buffer.from([4,0,0,0,0]));requests.push('CloseStdin');phase++;output();return;}
    if(buffer.length<4)return;const size=parseInt(buffer.subarray(0,4).toString(),16);if(buffer.length<4+size)return;
    const request=buffer.subarray(4,4+size).toString();buffer=buffer.subarray(4+size);requests.push(request);
    if(index===0){socket.end('OKAY0008shell_v2');return;}
    if(phase++===0){if(changeAt==='transport')mutate();socket.write('OKAY');}else socket.write('OKAY');
   }
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const now=Date.now(),scope={protocol:'adb-shell-v2-observation/v1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',run_id:'fragments__a1',source_commit:source.commit,profile:'synthetic',serial:'synthetic-fixture',endpoint:'tcp:127.0.0.1:'+server.address().port,epoch:1,claim:{claimed_by:'synthetic-fragments',claimed_at:new Date(now).toISOString()},worker_deadline_ms:now+5000,cleanup_deadline_ms:now+6000};
 observer=create({source:fixed,runtimeRoot:runtime,directory,scope,readAuthority:async()=>{
  admissions++;if(revoked&&change==='daemon')throw Object.assign(Error('FIXTURE_DAEMON_CHANGED'),{code:'FIXTURE_DAEMON_CHANGED'});
  return {scope,claimed_by:revoked&&change==='task'?'revoked':scope.claim.claimed_by,claimed_at:scope.claim.claimed_at,lease_until:new Date(revoked&&change==='lease'?now-1:scope.cleanup_deadline_ms+1000).toISOString()};
 }});
 t.after(async()=>{for(const timer of timers)clearTimeout(timer);try{await observer.close();}finally{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));rmSync(temporary,{recursive:true,force:true});}});
 let receipt,error;try{receipt=await observer.observeDump();}catch(value){error=value;}
 let stopped;try{stopped=await observer.close();}catch(closeError){if(change!=='owner')throw closeError;assert.match(closeError.code,/ADB_SHELL_V2_JOURNAL/);stopped=observer.snapshot();chmodSync(directory,0o700);}return {receipt,error,stopped,admissions,requests,observer,scope,directory};
}

test('pure shell response fragmentation does not multiply fresh business admissions',async t=>{
 const one=await fragmentedWire(t),many=await fragmentedWire(t,{pieces:8});
 assert.equal(one.error,undefined);assert.equal(many.error,undefined);assert.deepEqual(many.requests,one.requests);
 assert.equal(many.admissions,one.admissions,'receiving more response frames must not reauthorize a business effect');
 assert.equal(one.admissions,7,'two connects, four writes including CloseStdin, and final capability admission remain fresh');
 assert.equal(many.stopped.wire_complete,true);assert.equal(many.receipt.stdout_bytes,56);
});

for(const change of ['task','lease','daemon','source','owner','cancel'])test('receive-time '+change+' drift never grants a wire capability',async t=>{
 const f=await fragmentedWire(t,{pieces:4,change});assert.ok(f.error);assert.equal(f.receipt,undefined);assert.equal(f.stopped.wire_complete,false);assert.equal(f.stopped.unknown,true);
 assert.equal(f.requests.at(-1),'CloseStdin');assert.equal(f.requests.length,4,'draining cannot send a new business request');
 assert.equal(f.observer.verifyWireReceipt({}, {scope:f.scope}),false);
});

for(const change of ['task','lease','daemon','source','owner','cancel'])test('transport response '+change+' drift rejects the next write before sending',async t=>{
 const f=await fragmentedWire(t,{change,changeAt:'transport'});assert.ok(f.error);assert.equal(f.receipt,undefined);assert.equal(f.stopped.wire_complete,false);
 assert.equal(f.requests.length,2);assert.match(f.requests[1],/^host:transport:/);assert.equal(f.requests.some(r=>r.startsWith('shell,')),false);
});

test('trailing shell frame after EXIT cannot become a wire capability',async t=>{
 const f=await fragmentedWire(t,{pieces:3,trailing:true});assert.ok(f.error);assert.equal(f.receipt,undefined);assert.equal(f.stopped.wire_complete,false);assert.equal(f.stopped.unknown,true);
});
