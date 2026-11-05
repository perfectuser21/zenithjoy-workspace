import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = path => readFileSync(path,'utf8');
test('retired web and Kotlin workflows are absent from automatic CI',()=>{
 for(const name of ['e2e-line02-keyword-comment.yml','e2e-line02-android-collect.yml','nightly-real-machine-staging.yml']) assert.equal(existsSync('.github/workflows/'+name),false);
});
test('交互执行器只使用明确批准的用户和专用profile，核实session和候选回执',()=>{
 const runner=read('.github/workflows/scripts/run-line02-candidate.ps1');
 assert.match(runner,/-LogonType Interactive -RunLevel Limited/);
 assert.match(runner,/APPROVED_TEST_USER_NOT_LOGGED_IN/);
 assert.match(runner,/CANDIDATE_SHA_MISMATCH/);
 assert.match(runner,/CANDIDATE_RECEIPT_IDENTITY_MISMATCH/);
 assert.match(runner,/CANDIDATE_GATE_FAILED/);
 assert.match(runner,/Unregister-ScheduledTask/);
 assert.doesNotMatch(runner,/Get-ChildItem.*[Pp]rofile|Desktop\\zenithjoy-agent/);
});
test('异常路径必须留存证据并在返回前确认本次进程树退出',()=>{
 const runner=read('.github/workflows/scripts/run-line02-candidate.ps1');
 assert.match(runner,/ZJProcessGroup.*Attach/);
 assert.match(runner,/start_ticks/);
 assert.match(runner,/PROCESS_TREE_NOT_REAPED/);
 assert.match(runner,/line02-candidate-evidence/);
 assert.doesNotMatch(runner,/Remove-Item -LiteralPath \$directory -Recurse/);
});
