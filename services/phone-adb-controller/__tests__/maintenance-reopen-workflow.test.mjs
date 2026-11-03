import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const workflow=readFileSync(join(root,'.github/workflows/phone-review-reopen.yml'),'utf8');
const remote=readFileSync(join(root,'.github/workflows/scripts/phone-review-reopen-remote.sh'),'utf8');

test('受控 reopen 只有人工 dispatch，Pilot 同 SHA 来源和独立两阶段',()=>{
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/workflow_run:|schedule:|push:/);
 assert.match(workflow,/implementation_run_id:/);
 assert.match(workflow,/phone-deploy-evidence\.mjs/);
 assert.match(workflow,/options: \[prepare, finalize\]/);
 assert.doesNotMatch(workflow,/\bpromote\b|maintenance-install/);
 assert.match(workflow,/concurrency:\s*\n\s*group: deploy-phone-adb-controller/);
});

test('远端仅向 M4 安装固定源码工具，正式 Host 读回后才返回，不恢复旧候选',()=>{
 assert.match(remote,/git -C "\$REPO" archive "\$SHA"/);
 assert.match(remote,/git -C .* rev-parse/);
 assert.match(remote,/merge-base --is-ancestor "\$SHA"/);
 assert.match(remote,/xian-m4/);
 assert.match(remote,/maintenance-reopen-host\.py/);
 assert.match(remote,/<\/dev\/null/);
 assert.doesNotMatch(remote,/phone-candidates\.sealed\.[^\n]*mv|docker rm|launchctl bootstrap|crontab -/);
});

// Execute the actual local command argv through the OpenSSH remote-shell boundary;
// no SSH binary, credentials, remote commands or network are used.
function remoteBoundary(phase, release, overrides={}){
 const call=workflow.match(/          ssh -o BatchMode=yes[\s\S]*?< \.github\/workflows\/scripts\/phone-review-reopen-remote\.sh/)[0]
  .replace(/< \.github\/workflows\/scripts\/phone-review-reopen-remote\.sh/,'');
 const stub='ssh() { while [ "$1" != bash ]; do shift; done; printf -v cmd "%s " "$@"; /bin/sh -c "$cmd"; }\n';
 const prefix=remote.slice(0,remote.indexOf('REPO='))+
  'printf "argc=%s release=<%s> run=<%s>\\n" "$#" "$RELEASE_ID" "$RUN_ID"\n';
 const env={PATH:process.env.PATH,SSH_USER:'fixture',SSH_HOST:'fixture.invalid',KEY_FILE:'/unused',
  CANDIDATE_SHA:'a'.repeat(40),REOPEN_PHASE:phase,SAFETY_TX:'phone-safety-'+'b'.repeat(24),
  RELEASE_ID:release,GITHUB_RUN_ID:'41670216260',...overrides};
 return spawnSync('/bin/bash',['-c',stub+call],{input:prefix,encoding:'utf8',env});
}
test('prepare空release经SSH shell拼接仍保留五参数',()=>{
 const r=remoteBoundary('prepare','');assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/argc=5 release=<> run=<41670216260>/);
});
test('finalize UUID保持原位置，非法SHA/phase/tx/release/run仍拒绝',()=>{
 const id='12345678-1234-4234-8234-123456789012',r=remoteBoundary('finalize',id);
 assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes('release=<'+id+'> run=<41670216260>'));
 for(const [phase,release,changes]of [['prepare',id,{}],['finalize','',{}],['finalize','bad',{}],
  ['prepare','',{CANDIDATE_SHA:'main'}],['invalid','',{}],['prepare','',{SAFETY_TX:'wrong'}],['prepare','',{GITHUB_RUN_ID:'0'}]]){
  assert.notEqual(remoteBoundary(phase,release,changes).status,0,JSON.stringify({phase,release,changes}));
 }
});


// Execute the whole workflow shell block with an executable SSH stub. This tests
// transport configuration and pin-file lifecycle, not a real host handshake.
function trustedFirstHop(overrides={}){
 const dir=mkdtempSync(join(tmpdir(),'reopen-host-key-'));
 const receipt=join(dir,'receipt.json'),bin=join(dir,'bin');mkdirSync(bin);
 const ssh=join(bin,'ssh');
 writeFileSync(ssh,`#!/usr/bin/env node
const fs=require('node:fs'),assert=require('node:assert/strict');
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const options=args.filter((x,i)=>i&&args[i-1]==='-o');
for(const x of ['BatchMode=yes','StrictHostKeyChecking=yes','HostKeyAlias=zenithjoy-mmv','GlobalKnownHostsFile=/dev/null','HostKeyAlgorithms=ssh-ed25519','UpdateHostKeys=no'])assert.ok(options.includes(x),'missing pinned SSH option '+x);
assert.ok(!options.some(x=>/StrictHostKeyChecking=(?:no|accept-new)/.test(x)));
const known=options.find(x=>x.startsWith('UserKnownHostsFile='));assert.ok(known,'explicit pin file required');
const path=known.slice('UserKnownHostsFile='.length),file=fs.lstatSync(path);
assert.ok(file.isFile()&&!file.isSymbolicLink());assert.equal(file.mode&0o777,0o600);
assert.notEqual(path,process.env.REVIEW_HOST_PIN);assert.deepEqual(fs.readFileSync(path),fs.readFileSync(process.env.REVIEW_HOST_PIN));
assert.equal(fs.readFileSync(option('-i'),'utf8'),'fixture-private-key\\n');
fs.writeFileSync(process.env.STUB_RECEIPT,JSON.stringify({path,key:option('-i'),options}));
process.stdin.resume();
`,{mode:0o700});
 const body=workflow.slice(workflow.lastIndexOf('        run: |')+'        run: |'.length)
  .split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
 const result=spawnSync('/bin/bash',['-c',body],{cwd:root,encoding:'utf8',env:{PATH:bin+':'+process.env.PATH,
  SSH_KEY:'fixture-private-key',SSH_USER:'fixture',SSH_HOST:'fixture.invalid',CANDIDATE_SHA:'a'.repeat(40),
  SAFETY_TX:'phone-safety-'+'b'.repeat(24),REOPEN_PHASE:'prepare',RELEASE_ID:'',GITHUB_RUN_ID:'41704537378',
  REVIEW_HOST_PIN:join(root,'.github/ssh/zenithjoy-mmv.known_hosts'),STUB_RECEIPT:receipt,...overrides}});
 let data;if(existsSync(receipt))data=JSON.parse(readFileSync(receipt,'utf8'));
 const cleaned=data?!existsSync(data.path)&&!existsSync(data.key):undefined;
 rmSync(dir,{recursive:true,force:true});return{...result,data,cleaned};
}
test('首跳实际shell只用认证版本化pin和私有临时文件，正常退出清理密钥与pin',()=>{
 const r=trustedFirstHop();assert.equal(r.status,0,r.stderr);assert.ok(r.data);assert.equal(r.cleaned,true);
});
test('首跳pin必须是单一认证ED25519主机公钥，拒绝动态发现或放宽校验',()=>{
 const path=join(root,'.github/ssh/zenithjoy-mmv.known_hosts');
 const lines=readFileSync(path,'utf8').trim().split('\n');assert.equal(lines.length,1);
 assert.match(lines[0],/^zenithjoy-mmv ssh-ed25519 [A-Za-z0-9+/]+=*$/);
 const r=spawnSync('ssh-keygen',['-lf',path],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/SHA256:zPRRZ6ib0YutSv9NiW1MK5Yv\+0tcTlk7UXggNXnTH1k/);
 assert.doesNotMatch(workflow,/ssh-keyscan|StrictHostKeyChecking=(?:no|accept-new)/);
});
test('首跳非法prepare/finalize输入在任何SSH与公钥读取前拒绝',()=>{
 for(const values of [{REOPEN_PHASE:'invalid'},{CANDIDATE_SHA:'main'},{RELEASE_ID:'wrong'},
  {REOPEN_PHASE:'finalize',RELEASE_ID:''}]){
  const r=trustedFirstHop(values);assert.notEqual(r.status,0);assert.equal(r.data,undefined);
 }
});
