import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
