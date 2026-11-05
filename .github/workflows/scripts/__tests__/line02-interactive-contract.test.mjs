import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import YAML from 'yaml';
const read = path => readFileSync(path,'utf8');
test('retired web Douyin is absent from automatic CI; Android nightly remains',()=>{
 const workflow=YAML.parse(read('.github/workflows/nightly-real-machine-staging.yml'));
 assert.equal(workflow.jobs['douyin-read'],undefined);
 assert.equal(workflow.jobs['account-scan']['continue-on-error'],undefined);
 assert.equal(existsSync('.github/workflows/e2e-line02-keyword-comment.yml'),false);
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
test('nightly only runs Android account scan and reports its actual result',()=>{
 const workflow=YAML.parse(read('.github/workflows/nightly-real-machine-staging.yml'));
 assert.deepEqual(Object.keys(workflow.jobs),['account-scan','nightly-report']);
 assert.deepEqual(workflow.jobs['nightly-report'].needs,['account-scan']);
 assert.match(workflow.jobs['account-scan'].steps.find(s=>s.id==='run').run,/exit "\$CODE"/);
 assert.doesNotMatch(workflow.jobs['nightly-report'].steps[0].run,/douyin-read|DOUYIN|真抖音/);
});
for(const row of [
 {android:'success',code:'0',pass:true},
 {android:'failure',code:'3',pass:false},
])test('actual nightly report safe transport fixture '+JSON.stringify(row),async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'nightly-report-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const bin=join(dir,'bin');mkdirSync(bin);const calls=join(dir,'calls');const summary=join(dir,'summary');
 writeFileSync(join(bin,'gh'),'#!'+process.execPath+'\n'+`const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_GH_CALLS,JSON.stringify(args)+'\\n');if(args[0]!=='issue'||!['list','create'].includes(args[1]))process.exit(80);if(args[1]==='list')process.stdout.write('0');\n`,{mode:0o755});
 const wf=YAML.parse(read('.github/workflows/nightly-real-machine-staging.yml'));
 const command=wf.jobs['nightly-report'].steps[0].run.replaceAll('${{ needs.account-scan.result }}',row.android).replaceAll('${{ needs.account-scan.outputs.exit_code }}',row.code);
 const r=spawnSync('bash',['-e','-o','pipefail','-c',command],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,GITHUB_STEP_SUMMARY:summary,GITHUB_REPOSITORY:'fixture/repository',GITHUB_SERVER_URL:'https://github.com',GITHUB_RUN_ID:'fixture-run',FIXTURE_GH_CALLS:calls}});
 assert.ifError(r.error);assert.equal(r.status===0,row.pass,r.stdout+r.stderr);const body=readFileSync(summary,'utf8');assert.doesNotMatch(body,/微信/);assert.match(body,/account-scan/);
 if(row.pass)assert.equal(existsSync(calls),false);else{const observed=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(observed.length,2);assert.equal(observed[1][1],'create');if(row.code==='3')assert.match(observed[1].join(' '),/envfail/);}
});
