import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../../nightly-real-machine-staging.yml',import.meta.url),'utf8');
const blocks=[...workflow.matchAll(/^      - name: Verify GitHub checkout proxy\n        shell: bash\n        run: \|\n((?:          .*\n)+)/gm)].map(m=>m[1].replace(/^          /gm,''));
function run(body,{status=0,count,existing={}}={}){
 const dir=mkdtempSync(join(tmpdir(),'nightly-proxy-'));
 try{
  const envfile=join(dir,'github-env'),fake=join(dir,'curl');
  writeFileSync(envfile,'SENTINEL=preserve\n');
  writeFileSync(fake,`#!/bin/sh\nprintf '%s\\n' "$@" > "$FAKE_ARGS"\nexit ${status}\n`);chmodSync(fake,0o755);
  const env={...process.env,...existing,PATH:dir+':'+process.env.PATH,GITHUB_ENV:envfile,FAKE_ARGS:join(dir,'args')};
  delete env.GIT_CONFIG_COUNT;
  if(count!==undefined)env.GIT_CONFIG_COUNT=count;
  const result=spawnSync('bash',['-e','-o','pipefail','-c',body],{env,encoding:'utf8'});
  return {result,output:readFileSync(envfile,'utf8'),args:readFileSync(join(dir,'args'),'utf8')};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('both live nightly jobs run identical proxy check before checkout',()=>{
 assert.equal(blocks.length,2);assert.equal(blocks[0],blocks[1]);
 for(const job of ['douyin-read','account-scan']){
  const section=workflow.split(`  ${job}:`)[1].split(/\n  [a-z][a-z-]+:/)[0];
  assert.ok(section.indexOf('Verify GitHub checkout proxy')<section.indexOf('uses: actions/checkout@v4'));
 }
});
test('live shell command checks TLS through fixed loopback and preserves Git config',()=>{
 const {result,output,args}=run(blocks[0],{count:'2',existing:{GIT_CONFIG_KEY_0:'user.name',GIT_CONFIG_VALUE_0:'sentinel-zero',GIT_CONFIG_KEY_1:'credential.helper',GIT_CONFIG_VALUE_1:'sentinel-one'}});
 assert.equal(result.status,0,result.stderr);assert.match(args,/--proxy\nhttp:\/\/127\.0\.0\.1:7890\n/);assert.match(args,/https:\/\/github\.com\//);assert.doesNotMatch(args,/--insecure|-k\n/);
 assert.equal(output,'SENTINEL=preserve\nGIT_CONFIG_KEY_2=http.https://github.com/.proxy\nGIT_CONFIG_VALUE_2=http://127.0.0.1:7890\nGIT_CONFIG_COUNT=3\n');
});
test('unavailable proxy fails before setting any git configuration',()=>{
 const {result,output}=run(blocks[0],{status:7});assert.notEqual(result.status,0);assert.equal(output,'SENTINEL=preserve\n');
});
test('invalid existing git config counts fail rather than overwrite',()=>{
 for(const count of ['-1','abc','2147483647','1\nOTHER=bad']){
  const {result,output}=run(blocks[0],{count});assert.notEqual(result.status,0);assert.equal(output,'SENTINEL=preserve\n');
 }
});
test('unset count appends at zero',()=>{
 const {result,output}=run(blocks[0]);assert.equal(result.status,0,result.stderr);assert.match(output,/GIT_CONFIG_KEY_0=http\.https:\/\/github\.com\/\.proxy/);assert.match(output,/GIT_CONFIG_COUNT=1/);
});
