import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const ledger=new URL('../ledger.mjs',import.meta.url).href,receipts=new URL('../runtime-receipts.mjs',import.meta.url).href;
function directory(t){const d=mkdtempSync(join(tmpdir(),'preflight-recorder-'));t.after(()=>rmSync(d,{recursive:true,force:true}));return d;}
test('parent ledger export preserves the real stage item and legacy CLI updates that same ledger',t=>{
 const dir=directory(t),code=`const m=await import(${JSON.stringify(ledger)});m.setLedgerStage({runDir:${JSON.stringify(dir)},stage:'preflight',status:'completed',n:'1',word:''});`;
 const p=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,'');
 const doc=JSON.parse(readFileSync(join(dir,'ledger.json')));assert.equal(doc.stages.preflight.status,'completed');assert.equal(doc.stages.preflight.items[0].n,1);assert.equal(doc.stages.preflight.items[0].word,'');
 const legacy=spawnSync(process.execPath,[new URL(ledger).pathname,'set','--run-dir',dir,'--stage','preflight','--status','failed','--n','1','--word',''],{encoding:'utf8'});assert.equal(legacy.status,0,legacy.stderr);
 const updated=JSON.parse(readFileSync(join(dir,'ledger.json')));assert.equal(updated.stages.preflight.status,'failed');assert.equal(updated.stages.preflight.items.length,1);
});
test('parent mark-start export and original CLI preserve each real durable start across different seconds',t=>{
 const dir=directory(t),clock=iso=>`const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(iso)}]));}};`,code=`${clock('2026-11-05T03:48:43.000Z')}const m=await import(${JSON.stringify(receipts)});m.markActivityStart({dir:${JSON.stringify(dir)},attempt:'a1',activity:'preflight',n:1});`;
 const p=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(p.stdout,'');
 const occurrenceFile=join(dir,'occurrences',readdirSync(join(dir,'occurrences'))[0]),before=JSON.parse(readFileSync(occurrenceFile,'utf8'));
 assert.equal(before.slot,'a1.preflight.1');assert.equal(before.started_at,'2026-11-05T03:48:43Z');assert.equal(readFileSync(join(dir,'span-start.a1.preflight.1'),'utf8'),before.started_at);
 const legacy=spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(clock('2026-11-05T03:48:44.000Z'))}`,new URL(receipts).pathname,'mark-start','preflight','1'],{env:{...process.env,WFR_RUN_DIR:dir,WFR_ATTEMPT:'a1'},encoding:'utf8'});assert.equal(legacy.status,0,legacy.stderr);
 const after=JSON.parse(readFileSync(occurrenceFile,'utf8'));assert.equal(after.slot,before.slot);assert.notEqual(after.key,before.key);assert.equal(after.started_at,'2026-11-05T03:48:44Z');
 assert.equal(readFileSync(join(dir,'span-start.a1.preflight.1'),'utf8'),after.started_at);assert.equal(readdirSync(join(dir,'occurrences')).length,1);
});
test('real workflow recorder dispatch keeps agent preflight entirely in parent fs functions',async t=>{
 const dir=directory(t),workflow=await import('../leadgen-workflow.mjs');
 const options={root:new URL('../',import.meta.url).pathname,env:{WFR_RUN_DIR:dir,WFR_ATTEMPT:'a1',WF_BRAIN_WORKFLOW:'douyin_video_discovery'},executionMode:'agent',execute:async()=>{throw Error('UNCONTROLLED_RECORDER_OUTER');}};
 await workflow.recordActivityBookkeeping({phase:'start',activity:'preflight'},options);
 await workflow.recordActivityBookkeeping({phase:'execution',activity:'preflight',evidence:{status:'completed'}},options);
 assert.ok(readFileSync(join(dir,'span-start.a1.preflight.1'),'utf8'));assert.equal(JSON.parse(readFileSync(join(dir,'ledger.json'))).stages.preflight.status,'completed');
});

test('direct failure cleanup records the same occurrence and failed ledger in parent without outer',async t=>{
 const dir=directory(t),workflow=await import('../leadgen-workflow.mjs'),options={root:new URL('../',import.meta.url).pathname,env:{WFR_RUN_DIR:dir,WFR_ATTEMPT:'a1',WF_BRAIN_WORKFLOW:'douyin_video_processing'},executionMode:'agent',execute:async()=>{throw Error('UNCONTROLLED_CLEANUP_RECORDER_OUTER');}};
 await workflow.recordActivityBookkeeping({phase:'start',activity:'cleanup'},options);await workflow.recordActivityBookkeeping({phase:'verification',activity:'cleanup',evidence:{status:'failed'}},options);
 assert.ok(readFileSync(join(dir,'span-start.a1.cleanup.1'),'utf8'));assert.equal(JSON.parse(readFileSync(join(dir,'ledger.json'))).stages.cleanup.status,'failed');
});
