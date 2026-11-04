import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as definition from '../runtime-definition.mjs';

const task='11111111-1111-4111-8111-111111111111';
const env={LEADGEN_EXECUTION_MODE:'agent',WF_BRAIN_WORKFLOW:'douyin_video_discovery',WF_BRAIN_TASK_ID:task,WFR_TAG:'pure101',P:'xiaolongxia',SERIAL:'ANGYVB4311010223',LEADGEN_LINE:'yuesheng',LEADGEN_LIMIT:'2',WF_RUN_MAX_SECONDS:'1800',WF_RUN_START_TS:'1700000000',LEADGEN_SORT:'comprehensive',LEADGEN_TIME_LAYER:'one_week',LEADGEN_LOCATION:'unlimited'};
const expected={schema_version:1,workflow_key:'douyin_video_discovery',task_id:task,run_tag:'pure101',profile:'xiaolongxia',serial:'ANGYVB4311010223',line:'yuesheng',source_run:null,limit:2,comment_limit:null,run_max_seconds:1800,run_start_ts:1700000000,discovery_filters:{sort:'comprehensive',time_layer:'one_week',location:'unlimited'},collection_budget_s:null};
const snapshot=input=>({execution_mode:'agent',agent_input:input,workflow_version:{payload:{key:input.workflow_key}},files:{}});

test('Agent输入规范冻结真实身份、数量、绝对预算和101筛选，Code缺省不增加快照字段',()=>{
 assert.equal(typeof definition.agentInput,'function');assert.deepEqual(definition.agentInput(env),expected);assert.equal(definition.agentInput({}),null);
 const defaults={...env};for(const key of ['LEADGEN_SORT','LEADGEN_TIME_LAYER','LEADGEN_LOCATION','LEADGEN_LIMIT','WF_RUN_MAX_SECONDS'])delete defaults[key];
 assert.deepEqual(definition.agentInput(defaults),{...expected,limit:2,run_max_seconds:1800,discovery_filters:{sort:'latest',time_layer:'six_months',location:'same_city'}});
});

test('Agent每次启动拒绝任务、run、来源、配额、设备、筛选或预算任何漂移与撤销',()=>{
 assert.equal(typeof definition.assertAgentInput,'function');const fixed=snapshot(expected);assert.deepEqual(definition.assertAgentInput(fixed,env),expected);
 for(const [key,value] of Object.entries({WF_BRAIN_TASK_ID:'22222222-2222-4222-8222-222222222222',WFR_TAG:'changed',P:'another',SERIAL:'OTHER',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:'unexpected101',LEADGEN_LIMIT:'3',WF_RUN_MAX_SECONDS:'1900',WF_RUN_START_TS:'1700000001',LEADGEN_SORT:'latest',LEADGEN_TIME_LAYER:'one_day',LEADGEN_LOCATION:'same_city'}))assert.throws(()=>definition.assertAgentInput(fixed,{...env,[key]:value}),/AGENT_INPUT/);
 for(const key of ['WF_BRAIN_TASK_ID','WFR_TAG','P','SERIAL','LEADGEN_LINE','WF_RUN_START_TS']){const changed={...env};delete changed[key];assert.throws(()=>definition.assertAgentInput(fixed,changed),/AGENT_INPUT/);}
 assert.throws(()=>definition.assertAgentInput({...fixed,agent_input:undefined},env),/AGENT_INPUT/);
 assert.throws(()=>definition.assertAgentInput(snapshot({...expected,extra:'forged'}),env),/AGENT_INPUT/);
});

test('102采样与来源、采集预算冻结；103精确来源不借手机身份',()=>{
 assert.equal(typeof definition.agentInput,'function');
 const e102={...env,WF_BRAIN_WORKFLOW:'douyin_video_processing',WFR_TAG:'pure102',LEADGEN_SOURCE_RUN:'pure101',LEADGEN_COMMENT_LIMIT:'5',QUEUED_VIDEO_COLLECTION_SECONDS:'480'};
 for(const key of ['LEADGEN_SORT','LEADGEN_TIME_LAYER','LEADGEN_LOCATION'])delete e102[key];
 const input=definition.agentInput(e102);assert.equal(input.comment_limit,5);assert.equal(input.source_run,'pure101');assert.equal(input.collection_budget_s,480);assert.equal(input.discovery_filters,null);
 for(const mutation of [{LEADGEN_SOURCE_RUN:'other101'},{LEADGEN_COMMENT_LIMIT:'6'},{QUEUED_VIDEO_COLLECTION_SECONDS:'481'}])assert.throws(()=>definition.assertAgentInput(snapshot(input),{...e102,...mutation}),/AGENT_INPUT/);
 const e103={...env,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WFR_TAG:'pure103',P:'mmv-scoring',SERIAL:'none',LEADGEN_SOURCE_RUN:'pure102'};for(const key of ['LEADGEN_SORT','LEADGEN_TIME_LAYER','LEADGEN_LOCATION'])delete e103[key];
 const scoring=definition.agentInput(e103);assert.equal(scoring.source_run,'pure102');assert.equal(scoring.serial,'none');assert.equal(scoring.comment_limit,null);
 assert.throws(()=>definition.assertAgentInput(snapshot(scoring),{...e103,LEADGEN_SOURCE_RUN:'other102'}),/AGENT_INPUT/);
});

test('真实budget CLI续跑恢复冻结起点；显式改起点或其它输入失败且不输出shell片段',t=>{
 assert.equal(typeof definition.agentInput,'function');const root=mkdtempSync(join(tmpdir(),'primary-input-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const runDir=join(root,'run');mkdirSync(runDir);const body=snapshot(expected);writeFileSync(join(runDir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:definition.digest(body)}));
 const bin=new URL('../runtime-receipts.mjs',import.meta.url).pathname;
 const invoke=change=>spawnSync(process.execPath,[bin,'agent-budget'],{env:{...process.env,...env,WF_RUN_START_TS:undefined,WFR_RUN_DIR:runDir,...change},encoding:'utf8'});
 const restored=invoke({});assert.equal(restored.status,0,restored.stderr);assert.equal(restored.stdout,'export WF_RUN_START_TS=1700000000 WF_RUN_MAX_SECONDS=1800\n');
 for(const change of [{WF_RUN_START_TS:'1700000001'},{LEADGEN_LIMIT:'3'},{LEADGEN_SORT:'latest'},{WF_RUN_MAX_SECONDS:'1801'}]){const bad=invoke(change);assert.notEqual(bad.status,0);assert.equal(bad.stdout,'');assert.match(bad.stderr,/AGENT_INPUT/);}
});

test('正式zsh入口在prepare及业务启动之前拒绝冻结预算起点漂移',t=>{
 assert.equal(typeof definition.agentInput,'function');const root=mkdtempSync(join(tmpdir(),'primary-real-cli-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const home=join(root,'home');mkdirSync(join(home,'.local/bin'),{recursive:true});const host=join(home,'.local/bin/hostname');writeFileSync(host,'#!/bin/sh\nprintf "aad17-2\\n"\n');chmodSync(host,0o700);
 const runHome=join(root,'runs'),runDir=join(runHome,'ledger/douyin_comment_scoring-pure103');mkdirSync(runDir,{recursive:true});
 const localEnv={...env,WF_BRAIN_WORKFLOW:'douyin_comment_scoring',WFR_TAG:'pure103',P:'mmv-scoring',SERIAL:'none',LEADGEN_SOURCE_RUN:'pure102'};for(const key of ['LEADGEN_SORT','LEADGEN_TIME_LAYER','LEADGEN_LOCATION'])delete localEnv[key];
 const input=definition.agentInput(localEnv),body=snapshot(input);writeFileSync(join(runDir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:definition.digest(body)}));
 const result=spawnSync('/bin/zsh',[new URL('../leadgen-run.sh',import.meta.url).pathname,'douyin_comment_scoring','mmv-scoring','none','yuesheng','pure103'],{env:{...process.env,...localEnv,HOME:home,WFR_HOME:runHome,WF_RUN_START_TS:'1700000001'},encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/AGENT_INPUT/);assert.doesNotMatch(result.stdout,/WF_RUN_STARTED/);
});
