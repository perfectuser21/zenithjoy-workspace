/** 旧fakeclient也必须先经过真实只读socket；没有生产免probe开关。 */
import {spawn} from 'node:child_process';
import {workerPath} from './adb-socket-fixture-worker.mjs';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=mkdtempSync(join(tmpdir(),'adb-socket-fixture-')),ready=join(root,'ready');
const child=spawn(process.execPath,[workerPath,ready,String(process.pid)],{stdio:'ignore'});child.unref();
const deadline=Date.now()+5000;while(!existsSync(ready)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
if(!existsSync(ready))throw Error('fake existing ADB socket did not become ready');
process.env.ADB_SERVER_SOCKET='tcp:127.0.0.1:'+readFileSync(ready,'utf8').trim();
process.on('exit',()=>{try{child.kill('SIGTERM');}catch{}rmSync(root,{recursive:true,force:true});});
export function fixtureAdb(bin){
 const file=join(root,createHash('sha256').update(bin).digest('hex'));
 // fake旧客户端显式声明相同ADB协议，其余参数/输出原样交原fixture。
 writeFileSync(file,'#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = version ]; then printf "Android Debug Bridge version 1.0.41\\n"; exit 0; fi\nexec '+"'"+bin.replaceAll("'","'\\''")+"'"+' "$@"\n',{mode:0o755});
 return file;
}
