import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('GP anchor lint self-tests use private inputs and do not depend on the current PR diff',()=>{
 const file=fileURLToPath(new URL('./lint-gp-anchor.test.sh',import.meta.url));
 const result=spawnSync('bash',[file],{env:{...process.env,PATH:'/opt/homebrew/bin:'+process.env.PATH},encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
