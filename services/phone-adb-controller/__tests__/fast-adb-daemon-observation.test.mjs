import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {openFastAdbDaemonObservation} from '../fast-adb-daemon-observation.mjs';
import {digest} from '../device-epoch-fence-reference.mjs';
import {preflightTestPython} from './helpers/preflight-test-python.mjs';

const skip=process.platform!=='darwin'||process.arch!=='arm64';
async function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'adb-daemon-observe-')));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const c=join(dir,'fixture.c'),binary=join(dir,'fixture'),policy=join(dir,'policy.json');
 writeFileSync(policy,'{}',{mode:0o600});
 writeFileSync(c,`#include <arpa/inet.h>
#include <stdio.h>
#include <unistd.h>
int main(void){int s=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_addr={.s_addr=htonl(INADDR_LOOPBACK)}};
 socklen_t n=sizeof(a);if(s<0||bind(s,(void*)&a,n)||listen(s,2)||getsockname(s,(void*)&a,&n))return 1;
 printf("%u\\n",ntohs(a.sin_port));fflush(stdout);getchar();return 0;}`);
 execFileSync('/usr/bin/cc',[c,'-o',binary]);
 const daemon=spawn(binary,[],{stdio:['pipe','pipe','pipe']});
 const closed=once(daemon,'close');
 t.after(async()=>{daemon.stdin.end();await closed;});
 const [raw]=await once(daemon.stdout,'data'),port=Number(raw.toString().trim());
 assert.ok(port>=49152,'uses only an ephemeral synthetic listener');
 const ps=field=>execFileSync('/bin/ps',['-p',String(daemon.pid),'-o',field+'='],{encoding:'utf8',env:{LANG:'C',LC_ALL:'C',TZ:'UTC'}}).trim();
 const expected={pid:daemon.pid,uid:process.getuid(),endpoint:`tcp:127.0.0.1:${port}`,executable:binary,executable_sha256:digest(readFileSync(binary)),
  policy_path:policy,policy_sha256:digest('{}'),start_identity:ps('lstart'),command:ps('command')};
 const pythonPath=realpathSync(execFileSync(preflightTestPython,['-I','-B','-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim());
 const pinnedPath=join(dir,'pinned-python');symlinkSync(pythonPath,pinnedPath);
 const python={path:pinnedPath,sha256:digest(readFileSync(pythonPath))};
 const files=Object.fromEntries(['adb-daemon-observation-fast.py','adb-process-observation.py'].map(name=>['runtime/'+name,digest(readFileSync(new URL('../'+name,import.meta.url)))]));
 return {daemon,closed,expected,policy,open:(deadlineMs)=>openFastAdbDaemonObservation({python,frozen:{files},deadlineMs})};
}

test('fresh Darwin listener, UID, executable, command and kernel birth are checked repeatedly', {skip},async t=>{
 const f=await fixture(t),observation=f.open();
 try{
  assert.deepEqual(await observation.read(f.expected),f.expected);
  assert.deepEqual(await observation.read(f.expected),f.expected);
  await observation.close(true);
 }finally{await observation.close(false);}
});

test('rejects a missing listener, wrong UID/path/start, staleness, peer exit and mid-operation file changes', {skip},async t=>{
 const f=await fixture(t);
 const anotherPort=Number(f.expected.endpoint.split(':').at(-1))===65535?65534:65535;
 for(const patch of [{endpoint:`tcp:127.0.0.1:${anotherPort}`},{uid:f.expected.uid+1},{executable:f.policy,executable_sha256:digest('{}')},{start_identity:'wrong'},{command:'wrong'}]){
  const observation=f.open();try{await assert.rejects(observation.read({...f.expected,...patch}),/EPOCH_DAEMON_/);}finally{await observation.close(false);}
 }
 const stale=f.open(Date.now()-1);
 try{await assert.rejects(stale.read(f.expected),/EPOCH_DAEMON_/);}finally{await stale.close(false);}
 const observation=f.open();
 try{
  await observation.read(f.expected);
  writeFileSync(f.policy,'[]');
  await assert.rejects(observation.read(f.expected),/EPOCH_DAEMON_SOURCE/);
  await assert.rejects(observation.close(true),/EPOCH_DAEMON_SOURCE/);
 }finally{await observation.close(false);}
 writeFileSync(f.policy,'{}');
 const exited=f.open();try{
  await exited.read(f.expected);f.daemon.stdin.end();await f.closed;
  await assert.rejects(exited.read(f.expected),/EPOCH_DAEMON_/);
 }finally{await exited.close(false);}
});
