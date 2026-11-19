import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const probe = new URL('./fixtures/host-phone-access.py', import.meta.url);
function run(host, input) {
 const p = spawnSync('python3', [probe.pathname, host.profile.cwd, JSON.stringify(input)],
  {encoding:'utf8', timeout:20000, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
}
function admitted(r) { assert.equal(r.first.rc, 0, r.first.error || r.first.stdout); assert.equal(r.calls.length, 1); }
function refused(r, pattern) {
 assert.equal(r.calls.length, 0); assert.match(r.first.error || r.first.stdout, pattern);
}
const activities = {101:['preflight','collect_videos','cleanup'],102:['preflight','dedup','qualification','collection','cleanup'],
 103:['scoring','mark_leads','cleanup'],104:['preflight','send_dm','write_back','cleanup']};
for (const workflow of Object.keys(activities)) test(`${workflow} actual host shares phone operations without Activity command allowlists`, async t => {
 const f = await foundationFixture(workflow);
 try {
  const host = await prepareLeadgenHost(f);
  const instructions=readFileSync(host.profile.cwd+'/TOOLS.txt','utf8');
  assert.match(instructions,/不再按Activity列手机命令名单/);
  assert.match(instructions,/commenter-profile-card-link VID UID NICKNAME_B64 BODY_SHA EID/);
  assert.match(instructions,/text-input UTF8_TEXT/);
  assert.match(instructions,/不是|不代表已有数据库评论ID/);
  for (const activity of activities[workflow]) await t.test(`${activity} admits an existing tap with frozen owner`, () => {
   const r=run(host,{activity,args:['tap','100','200'],replay:true}); admitted(r);
   const argv=r.calls[0].argv; assert.ok(argv.includes(r.controller));
   assert.equal(argv[argv.indexOf('--profile')+1],r.profile);
   assert.equal(argv[argv.indexOf('--lock-owner')+1],r.owner);
   assert.equal(r.replay.stdout,r.first.stdout); assert.equal(r.replay.dispatches,1);
  });
  await t.test('ordinary screenshot, text, swipe and back reuse the controller ABI',()=>{
   for(const args of [['snapshot-evidence','$RUN-screen'],['text-input','测试文字'],['swipe','20','30','20','10','100'],['back']]) {
    const r=run(host,{activity:'cleanup',args});admitted(r);assert.ok(r.locks.length>0);
    if(args[0]!=='back') assert.equal(r.calls[0].argv[r.calls[0].argv.indexOf('--lock-owner')+1],r.owner);
   }
  });
  if(workflow==='102') await t.test('collection can call existing native profile link APIs with run evidence and original owner ABI',()=>{
   const strict=['commenter-profile-card-link','$VID','target-uid','bmFtZQ==','a'.repeat(64),'$RUN-resume1-person'];
   const r=run(host,{activity:'collection',args:strict}); admitted(r);
   assert.equal(r.calls[0].argv[r.calls[0].argv.indexOf('--lock-owner')+1],r.owner);
   assert.ok(r.locks.length>0);
   admitted(run(host,{activity:'collection',args:['commenter-card-link','$RUN-card']}));
   for(const args of [[...strict.slice(0,-1),'foreign-card'],['commenter-card-link','foreign-card']]) {
    const denied=run(host,{activity:'collection',args});refused(denied,/EVIDENCE_RUN_SCOPE/);assert.deepEqual(denied.receipts,{});
   }
   const foreign=run(host,{activity:'collection',args:[strict[0],'7722222222222222222',...strict.slice(2)]});
   refused(foreign,/VIDEO_SCOPE/);assert.deepEqual(foreign.receipts,{});
  });
  if(workflow==='102') await t.test('the existing one-capture run budget cannot be reset by changing Activity',()=>{
   const args=['record-start','$RUN-v$VID-capture'];
   for(const unknown of [false,true]) {
    const r=run(host,{activity:'qualification',next_activity:'collection',args,unknown});
    assert.equal(r.first.dispatches,1);assert.equal(r.calls.length,1);
    assert.match(r.other.error || r.other.stdout,/SINGLE_CAPTURE_OR_SEEK_LIMIT|PRIOR_ACTION_UNKNOWN/);
   }
  });
  if(workflow==='102') await t.test('deterministic capture budget rejection leaves cleanup available without clearing real unknowns',()=>{
   for(const unknown of [false,true]) {
    const r=run(host,{activity:'qualification',next_activity:'collection',args:['record-start','$RUN-v$VID-capture'],unknown,cleanup_after:true});
    assert.equal(r.other.dispatches,1);
    assert.equal(r.receipts['phone-new-action.json'],undefined);
    if(unknown) {
     assert.match(r.other.error,/PRIOR_ACTION_UNKNOWN/);assert.match(r.cleanup.error,/PRIOR_ACTION_UNKNOWN/);
     assert.equal(r.receipts['phone-action.json'].state,'unknown');assert.equal(r.calls.length,1);
    } else {
     assert.equal(r.other.rc,2,r.other.error);const rejection=JSON.parse(r.other.stdout);
     assert.equal(rejection.result.data.dispatched,false);assert.equal(rejection.result.data.phase,'pre_dispatch');
     assert.match(rejection.result.error,/SINGLE_CAPTURE_OR_SEEK_LIMIT/);
     assert.equal(r.cleanup.rc,0,r.cleanup.error);assert.equal(r.calls.length,2);
     assert.equal(r.receipts['phone-cleanup.json'].state,'terminal');
    }
   }
  });
  if(workflow==='101') await t.test('a Workflow without a configured capture budget gains no invented single-capture limit',()=>{
   const r=run(host,{activity:'preflight',next_activity:'collect_videos',args:['record-start','$RUN-capture']});
   assert.equal(r.first.rc,0);assert.equal(r.other.rc,0,r.other.error);assert.equal(r.calls.length,2);
  });
  await t.test('cleanup cannot start ordinary or unknown operations after business deadline', () => {
   for (const args of [['tap','100','200'],['future-phone-operation']]) {
    const r=run(host,{activity:'cleanup',late:true,args}); refused(r,/ABSOLUTE_DEADLINE/);
    assert.deepEqual(r.receipts,{});
   }
  });
  await t.test('existing read-only foreground and status stay usable before acquiring a local lock', () => {
   for(const args of [['foreground'],['status']]) {
    const r=run(host,{activity:'cleanup',late:true,local_free:true,args});admitted(r);
    assert.equal(r.calls[0].argv.includes('--lock-owner'),false);assert.equal(r.locks.length,0);
   }
  });
  await t.test('existing read-only and own cleanup operations retain cleanup time, not new acquisition', () => {
   for (const args of [['record-status','$RUN-capture'],['close-app'],['lock-release-exact','$OWNER']]) {
    const r=run(host,{activity:'cleanup',late:true,args}); admitted(r);
   }
   const r=run(host,{activity:'cleanup',late:true,args:['lock-acquire-new','$OWNER']}); refused(r,/ABSOLUTE_DEADLINE/);
  });
  await t.test('absolute cleanup deadline still refuses all actions', () => {
   const r=run(host,{activity:'cleanup',expired:true,args:['record-status','$RUN-capture']});
   refused(r,/ABSOLUTE_DEADLINE|budget_exhausted/); assert.deepEqual(r.receipts,{});
  });
  await t.test('fixed task identity, task owner, device lock owner and evidence scope remain required', () => {
   for(const fields of [{wrong_identity:true},{task_foreign:true},{owner_foreign:true}]) {
    refused(run(host,{activity:'preflight',args:['tap','100','200'],...fields}),/ACTIVITY_SCOPE|TASK_AUTHORITY|RESOURCE_AUTHORITY/);
   }
   for(const args of [['snapshot-evidence','foreign-evidence'],['lock-release-exact','foreign'],['open-video','7722222222222222222','$RUN-video']]) {
    refused(run(host,{activity:'cleanup',args}),/EVIDENCE_RUN_SCOPE|LOCAL_OWNER_SCOPE|VIDEO_SCOPE/);
   }
  });
  await t.test('existing evidence-bearing phone APIs bind their actual EID argument to this run',()=>{
   for(const args of [['locate','bmFtZQ==','foreign'],['locate-tap','bmFtZQ==','foreign'],
    ['open-user-profile','target','foreign'],['set-playback-speed','1','foreign'],
    ['evidence-bundle','foreign'],['profile-video-cards','foreign'],['search-grid-scroll','foreign','up']]) {
    const r=run(host,{activity:'cleanup',args});refused(r,/EVIDENCE_RUN_SCOPE/);assert.deepEqual(r.receipts,{});
   }
  });
  await t.test('external command execution, overrides and explicit unapproved outward operations stay closed', () => {
   for(const args of [['with-lock','$OWNER','--','sh','-c','exit 0'],['--profile','other','tap','1','2'],
    ['tap','1','2','--lock-owner','foreign'],['account-switch','other'],['private-message-send','unapproved'],
    ['tap-evidence','1','2','$RUN-tap','--outward','send'],['lock-release','$OWNER'],['lock-reap']]) {
    const r=run(host,{activity:'preflight',args}); refused(r,/PHONE_|LOCAL_OWNER_SCOPE/); assert.deepEqual(r.receipts,{});
   }
  });
  await t.test('post-dispatch uncertainty cannot replay the same or a renamed action', () => {
   const r=run(host,{activity:'preflight',args:['tap','100','200'],unknown:true,replay:true});
   assert.equal(r.calls.length,1); assert.equal(r.receipts['phone-action.json'].state,'unknown');
   assert.match(r.replay.error,/ACTION_UNKNOWN_NO_REPLAY/); assert.match(r.other.error,/PRIOR_ACTION_UNKNOWN/);
  });
 } finally { f.close(); }
});
