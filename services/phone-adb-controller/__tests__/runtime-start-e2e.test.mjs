import { HISTORICAL_ENGINE_PLAN_DIR } from './fixtures/frozen-runtime.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('E2E：缺少版本快照时不得起跑，不触及ssh/adb/控制塔',()=>{
  const home=mkdtempSync(join(tmpdir(),'runtime-start-')); const bin=join(home,'bin');mkdirSync(bin);
  for(const name of ['ssh','adb','wall-report.sh'])writeFileSync(join(bin,name),'#!/bin/sh\necho external >> "$HOME/external"\nexit 1\n',{mode:0o755});
  const result=spawnSync('zsh',[resolve('services/phone-adb-controller/wf-run.sh'),'keyword_acquisition','fixture','SERIAL','biz','--tag','frozen-e2e'],{encoding:'utf8',timeout:15000,env:{...process.env,HOME:home,PATH:`${bin}:${process.env.PATH}`,BRAIN_URL:'',BRAIN_INTERNAL_TOKEN:'',WFR:resolve('services/phone-adb-controller/workflow-result.sh'),WFR_NODE:process.execPath,WALL_REPORT:join(bin,'wall-report.sh'),WF_PLAN_DIR:HISTORICAL_ENGINE_PLAN_DIR}});
  assert.match(result.stderr,/工作流定义版本冻结失败/);assert.doesNotMatch(result.stdout,/WF_RUN_STARTED/);assert.equal(result.status,1);assert.equal(existsSync(join(home,'external')),false);
});

test('E2E：已有完整冻结件但运行绑定无ACK，仍禁止首次ssh/adb/控制塔动作',async()=>{
 const {seedRunner}=await import('./fixtures/frozen-runtime.mjs');const {readFileSync,rmSync}=await import('node:fs');const {digest}=await import('../runtime-definition.mjs');
 const home=mkdtempSync(join(tmpdir(),'runtime-binding-start-')),bin=join(home,'bin');mkdirSync(bin);
 for(const name of ['ssh','adb','wall-report.sh'])writeFileSync(join(bin,name),'#!/bin/sh\necho external >> "$HOME/external"\nexit 1\n',{mode:0o755});
 const args=['keyword_acquisition','p1','SER1','biz','--tag','binding-gate'];
 const env={...process.env,HOME:home,PATH:`${bin}:${process.env.PATH}`,BRAIN_URL:'http://127.0.0.1:1',BRAIN_INTERNAL_TOKEN:'fixture',WFR_HOME:join(home,'wfr'),WFR_NODE:process.execPath,WALL_REPORT:join(bin,'wall-report.sh'),WF_PLAN_DIR:HISTORICAL_ENGINE_PLAN_DIR,WF_TESTING:'1',WF_BIND_RETRY_DELAYS:'0 0 0'};
 seedRunner(env,args);const dir=join(env.WFR_HOME,'ledger/social-keyword-leadgen-crontab-binding-gate'),file=join(dir,'run-definition.json');
 rmSync(join(dir,'run-bindings'),{recursive:true,force:true});
 const {snapshot_sha256,...body}=JSON.parse(readFileSync(file,'utf8'));body.release={...body.release,id:'release'};body.deployment={...body.deployment,observation_id:'observation'};body.workflow_version.payload_sha256='a'.repeat(64);body.schema_version=2;
 writeFileSync(file,JSON.stringify({...body,snapshot_sha256:digest(body)}));
 const result=spawnSync('zsh',[resolve('services/phone-adb-controller/wf-run.sh'),...args],{encoding:'utf8',timeout:15000,env});
 assert.match(result.stderr,/运行发布绑定未确认/);assert.doesNotMatch(result.stdout,/WF_RUN_STARTED/);assert.equal(result.status,1);assert.equal(existsSync(join(home,'external')),false);
});
