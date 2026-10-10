import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('.',import.meta.url));
function checked(command,args){
 const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:90000,maxBuffer:1000000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 return result.stdout+result.stderr;
}
test('手机Activity：部署指纹、前台保护、本人身份、独立回执和批次重试的真实回归',()=>{
 const output=checked('python3',['-m','unittest','discover','-s','.','-p','test_*.py','-v']);
 assert.match(output,/test_run_name_never_bypasses_human_foreground/);
 assert.match(output,/test_deploy_success_requires_remote_source_and_every_file_hash/);
 assert.match(output,/test_batch_retry_uses_stable_server_idempotency_key/);
 assert.match(output,/test_feed_author_is_not_current_account/);
 assert.match(output,/test_watchdog_requires_execution_not_schedule_creation/);
});
test('账号写回Activity：保留历史身份、人工覆盖和真实核验时间',()=>{
 const output=checked('node',['--test','test_publish.mjs']);
 assert.match(output,/tests 3/);
 assert.match(output,/fail 0/);
});
