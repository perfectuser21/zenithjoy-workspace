// Synthetic slow observer, real execInput/receipt/producer/controller and Unix socket.
// This reproduces a structural scheduling condition, not the historical 2003ms cause.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {execInput} from '../../leadgen-client.mjs';
import {startCollectionLeafProducer} from '../../collection-leaf-producer.mjs';
import {receiptPath} from '../../native-operation-receipt.mjs';

const mode=process.argv[2],dir=mkdtempSync(join(tmpdir(),'native-ipc-synthetic-'));
const pythonResult=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'});
if(pythonResult.status!==0)throw Error('FIXTURE_REAL_PYTHON_REQUIRED');
const python=pythonResult.stdout.trim(),bin=join(dir,'bin'),marker=join(dir,'slow-observer-started');
mkdirSync(bin,{mode:0o700});
writeFileSync(join(bin,'python3'),`#!${python}
import os,sys,time
from pathlib import Path
if len(sys.argv)>3 and sys.argv[-1]=='children':
 try:
  with open(${JSON.stringify(marker)},'x') as out:out.write('actual-inspector-child-started')
  time.sleep(${mode==='slow-children'?'2.8':'0'})
 except FileExistsError:pass
os.execv(${JSON.stringify(python)},[${JSON.stringify(python)},*sys.argv[1:]])
`,{mode:0o755});
const source=join(dir,'fixture-adb.c'),adb=join(dir,'fixture-adb');
writeFileSync(source,'#include <stdio.h>\n#include <string.h>\nint main(int n,char**a){if(n==2&&!strcmp(a[1],"version")){puts("Android Debug Bridge version 1.0.41");return 0;}if(!strcmp(a[n-1],"get-state")){puts("device");return 0;}puts("mCurrentFocus=Window{0 u0 fixture.app/.Screen}");return 0;}\n');
const cc=spawnSync('cc',[source,'-o',adb],{encoding:'utf8'});
if(cc.status!==0)throw Error('FIXTURE_CC_REQUIRED: '+cc.stderr);
chmodSync(adb,0o755);
// A different event loop serves the fake host inventory even when the observed
// Node thread is blocked. No production ADB port or device is contacted.
const host=new Worker(`const{parentPort}=require('node:worker_threads');const net=require('node:net');
const server=net.createServer(s=>{let b=Buffer.alloc(0);s.on('data',x=>{b=Buffer.concat([b,x]);if(b.length<4)return;const n=parseInt(b.subarray(0,4).toString(),16);if(b.length<4+n)return;const q=b.subarray(4,4+n).toString();const v=q==='host:version'?'0029':q==='host:devices'?'IPC-FAKE\\tdevice\\n':null;if(v===null){s.end('FAIL0000');return;}s.end('OKAY'+Buffer.byteLength(v).toString(16).padStart(4,'0')+v);});});server.listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));`,{eval:true});
const port=await new Promise((yes,no)=>{host.once('message',yes);host.once('error',no);});
const policy={schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:`tcp:127.0.0.1:${port}`,forbidden_ports:[],adb_bin:adb,adb_realpath:realpathSync(adb),adb_sha256:createHash('sha256').update(readFileSync(adb)).digest('hex')};
const policyFile=join(dir,'policy.json'),registry=join(dir,'profiles.tsv'),runDir=join(dir,'run');
writeFileSync(policyFile,JSON.stringify(policy),{mode:0o600});
writeFileSync(registry,'profile\tserial\tmodel\twidth\theight\tenabled\nipc-fixture\tIPC-FAKE\tfixture\t720\t1280\ttrue\n',{mode:0o600});
mkdirSync(runDir,{mode:0o700});
const beforePath=process.env.PATH;
let producer,result,error,proof;
try{
 process.env.PATH=bin+':'+beforePath;
 producer=await startCollectionLeafProducer({directory:dir,policy,serial:'IPC-FAKE',deadlineMs:Date.now()+14000,env:process.env});
 const receipt={runDir,operationId:'controller-ipc',runId:'synthetic-controller-ipc',taskId:'synthetic-task',profile:'ipc-fixture',serial:'IPC-FAKE',sourceCommit:'a'.repeat(40),owner:'synthetic-owner',activity:'collection'};
 const env={...process.env,...producer.env,HOME:dir,DOUYIN_PHONE_REGISTRY:registry,DOUYIN_PHONE_TMP_ROOT:join(dir,'phone'),DOUYIN_PYTHON_BIN:python,DOUYIN_ADB_BIN:fileURLToPath(new URL('../../adb-managed-client.py',import.meta.url)),WFR_COLLECTION_POLICY_FILE:policyFile,ZJ_ADB_HOST_CONFIG:policyFile};
 for(const k of ['ADB_SERVER_SOCKET','ANDROID_ADB_SERVER_PORT','ANDROID_ADB_SERVER_ADDRESS','DOUYIN_ADB_PORT'])delete env[k];
 try{result=await execInput(python,[fileURLToPath(new URL('./native-ipc-controller.py',import.meta.url)),marker,fileURLToPath(new URL('../../douyin-phone-adb',import.meta.url))],{receipt,env,timeoutMs:11000});}
 catch(e){error={message:e.message,executionStopped:e.executionStopped};}
 proof=JSON.parse(readFileSync(receiptPath(runDir,receipt.operationId),'utf8'));
 const lifecycle=await producer.seal();
 console.log(JSON.stringify({mode,synthetic_trigger:true,real_controller:true,real_managed_client:true,real_producer:true,result,error,proof,lifecycle,observer_marker_exists:readFileSync(marker,'utf8')==='actual-inspector-child-started'}));
}finally{
 if(producer)await producer.close();
 process.env.PATH=beforePath;await host.terminate();rmSync(dir,{recursive:true,force:true});
}
