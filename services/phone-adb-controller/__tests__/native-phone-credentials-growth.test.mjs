// Actual synthetic HOME file growth between fstat and the first real FD read.
// No production credential path or token is read, and no read result is mocked.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';
import {createNativePhoneCredentialReader} from '../native-phone-credentials.mjs';
test('credential FD read remains bounded when the same private inode grows after fstat',t=>{
 const home=fs.realpathSync(fs.mkdtempSync(join(os.tmpdir(),'native-credential-growth-'))),folder=join(home,'.credentials'),path=join(folder,'dashscope.env');fs.mkdirSync(folder,{mode:0o700});const raw=Buffer.from('DASHSCOPE_API_KEY=synthetic-only-token\n');fs.writeFileSync(path,raw,{mode:0o600});
 const originalUserInfo=os.userInfo,originalReadFileSync=fs.readFileSync,originalReadSync=fs.readSync;
 let armed=false,grown=false,insideReadFile=false,readBytes=0;
 t.after(()=>{os.userInfo=originalUserInfo;fs.readFileSync=originalReadFileSync;fs.readSync=originalReadSync;syncBuiltinESMExports();fs.rmSync(home,{recursive:true,force:true});});
 os.userInfo=()=>({uid:process.getuid(),gid:process.getgid(),homedir:home,username:'synthetic',shell:'/bin/false'});syncBuiltinESMExports();
 const frozen={collection_phone_scope:{credentials:{dashscope:{path,sha256:createHash('sha256').update(raw).digest('hex')}}}},reader=createNativePhoneCredentialReader({provider:'dashscope',frozen});
 const grow=fd=>{if(armed&&!grown&&typeof fd==='number'){grown=true;fs.appendFileSync(path,Buffer.alloc(1024*1024,65));}};
 fs.readFileSync=(fd,...args)=>{grow(fd);insideReadFile=true;try{const result=originalReadFileSync(fd,...args);if(armed&&typeof fd==='number')readBytes+=result.length;return result;}finally{insideReadFile=false;}};
 fs.readSync=(fd,...args)=>{grow(fd);const count=originalReadSync(fd,...args);if(armed&&!insideReadFile)readBytes+=count;return count;};syncBuiltinESMExports();armed=true;
 assert.throws(reader,/NATIVE_PHONE_CREDENTIAL/);assert.equal(grown,true,'growth must occur inside the actual FD-read window');assert.ok(readBytes>0,'the real grown FD must be read before rejecting');assert.ok(readBytes<=65537,`read ${readBytes} bytes despite the 65536-byte credential limit`);
});
