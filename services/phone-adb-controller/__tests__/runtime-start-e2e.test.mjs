import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('E2E：缺少版本快照时不得起跑，不触及ssh/adb/控制塔',()=>{
  const home=mkdtempSync(join(tmpdir(),'runtime-start-')); const bin=join(home,'bin');mkdirSync(bin);
  for(const name of ['ssh','adb','wall-report.sh'])writeFileSync(join(bin,name),'#!/bin/sh\necho external >> "$HOME/external"\nexit 1\n',{mode:0o755});
  const result=spawnSync('zsh',[resolve('services/phone-adb-controller/wf-run.sh'),'keyword_acquisition','fixture','SERIAL','biz','--tag','frozen-e2e'],{encoding:'utf8',timeout:15000,env:{...process.env,HOME:home,PATH:`${bin}:${process.env.PATH}`,BRAIN_URL:'',BRAIN_INTERNAL_TOKEN:'',WFR:resolve('services/phone-adb-controller/workflow-result.sh'),WFR_NODE:process.execPath,WALL_REPORT:join(bin,'wall-report.sh'),WF_PLAN_DIR:resolve('services/phone-adb-controller/plans')}});
  assert.doesNotMatch(result.stdout,/WF_RUN_STARTED/);assert.equal(result.status,1);assert.equal(existsSync(join(home,'external')),false);
});
