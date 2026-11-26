import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,linkSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,statSync,symlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pinPrivateFileClosure} from '../private-file-closure.mjs';

function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'private-closure-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const runtime=join(root,'runtime'),file=join(runtime,'source');
 mkdirSync(runtime,{mode:0o700});writeFileSync(file,'frozen',{mode:0o600});
 let byteChecks=0;
 const verify=()=>{byteChecks++;assert.equal(readFileSync(file,'utf8'),'frozen');};
 return {root,runtime,file,verify,byteChecks:()=>byteChecks};
}

test('closed phase checks exact bytes at both boundaries and tolerates separate evidence writes',t=>{
 const f=fixture(t),proof=pinPrivateFileClosure({root:f.root,files:[f.file],verify:f.verify});
 assert.equal(f.byteChecks(),1);
 writeFileSync(join(f.root,'evidence'),'wire proof',{mode:0o600});
 proof.check();proof.check();assert.equal(f.byteChecks(),1);
 proof.verifyBytes();assert.equal(f.byteChecks(),2);
});

for(const [name,change] of Object.entries({
 restoredMtime:({file})=>{const stat=statSync(file);writeFileSync(file,'forged');utimesSync(file,stat.atime,stat.mtime);},
 replacedInode:({file})=>{renameSync(file,file+'.old');writeFileSync(file,'frozen',{mode:0o600});},
 newHardLink:({file})=>linkSync(file,file+'.link'),
 writableMode:({file})=>chmodSync(file,0o666),
 aliasedDirectory:({root,runtime})=>{const moved=join(root,'moved');renameSync(runtime,moved);symlinkSync(moved,runtime);},
}))test(`mid-phase ${name} prevents further authorizations and complete close`,t=>{
 const f=fixture(t),proof=pinPrivateFileClosure({root:f.root,files:[f.file],verify:f.verify});
 change(f);
 assert.throws(()=>proof.check(),/PRIVATE_FILE_CLOSURE_DRIFT/);
 assert.throws(()=>proof.verifyBytes(),/PRIVATE_FILE_CLOSURE_DRIFT/);
});
