import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
const root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function rig(t){
 const directory=mkdtempSync(join(tmpdir(),'preflight-native-domain-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const c=join(directory,'client.c'),binary=join(directory,'client'),escape=join(directory,'escaped');
 writeFileSync(c,'#include <unistd.h>\n#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <errno.h>\nint main(int argc,char**argv){if(!strcmp(argv[argc-1],"exit-one")){return 1;}if(!strcmp(argv[argc-1],"escape")){pid_t p=fork();if(p<0){fprintf(stderr,"fork_denied=%d\\n",errno);return 77;}if(p==0){setsid();FILE*f=fopen(getenv("ESCAPE_FILE"),"w");if(f){fputs("escaped",f);fclose(f);}sleep(2);}return 0;}puts("device");return 0;}\n');const cc=spawnSync('cc',[c,'-o',binary],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const {startPreflightNativeDomain}=await import('../preflight-native-domain.mjs');
 const now=Date.now(),domain=await startPreflightNativeDomain({root,directory,sourceFiles:{'preflight-local-step.py':hash(join(root,'preflight-local-step.py'))},python:{path:'/usr/bin/python3',sha256:hash('/usr/bin/python3')},policy:{adb_bin:binary,adb_sha256:hash(binary),endpoint:'tcp:127.0.0.1:12345'},serial:'SERIAL',workerDeadlineMs:now+10000,receiptDeadlineMs:now+12000,env:{...process.env,ESCAPE_FILE:escape}});t.after(()=>domain.close());return {directory,domain,escape};
}
test('local preflight domain owns every direct ADB/local leaf and closure capability cannot be cloned',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t);assert.equal((await r.domain.adb('get-state')).trim(),'device');const facts=JSON.parse(await r.domain.local('ui','<hierarchy/>'));assert.equal(facts.kind,'none');
 const closed=await r.domain.close();assert.equal(closed.execution_stopped,true);assert.equal(closed.adb.leaves.length,1);assert.equal(closed.local.leaves.length,1);
 const {preflightDomainClosure}=await import('../preflight-native-domain.mjs');assert.ok(preflightDomainClosure(r.domain));assert.equal(preflightDomainClosure(structuredClone(closed)),null);
 await assert.rejects(()=>r.domain.adb('get-state'),/PREFLIGHT_NATIVE_CLOSED/);
});
test('actual pinned C leaf cannot fork then setsid escape; failure never yields a cleanup capability',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t);await assert.rejects(()=>r.domain.adb('shell','escape'),/PREFLIGHT_ADB_REQUEST_FAILED/);const closed=await r.domain.close();assert.equal(existsSync(r.escape),false);assert.equal(closed.execution_stopped,false);
 const {preflightDomainClosure}=await import('../preflight-native-domain.mjs');assert.equal(preflightDomainClosure(r.domain),null);
});

test('actual exit1 is a returned host leaf, not evidence of an unclosed OS domain',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t);await assert.rejects(()=>r.domain.adb('shell','exit-one'),/PREFLIGHT_ADB_REQUEST_FAILED/);const closed=await r.domain.close();assert.equal(closed.execution_stopped,true);assert.equal(closed.command_failures,1);
});

test('returned parser refusal closes the complete host scope while preserving command failure',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t);await assert.rejects(()=>r.domain.local('ui','not XML'),/PREFLIGHT_LOCAL_REQUEST_FAILED/);const closed=await r.domain.close();assert.equal(closed.execution_stopped,true);assert.equal(closed.command_failures,1);assert.equal(closed.local.leaves[0].code,2);
});
