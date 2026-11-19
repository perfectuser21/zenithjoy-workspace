import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
  for (const activity of activities[workflow]) await t.test(`${activity} admits an existing tap with frozen owner`, () => {
   const r=run(host,{activity,args:['tap','100','200'],replay:true}); admitted(r);
   const argv=r.calls[0].argv; assert.ok(argv.includes(r.controller));
   assert.equal(argv[argv.indexOf('--profile')+1],r.profile);
   assert.equal(argv[argv.indexOf('--lock-owner')+1],r.owner);
   assert.equal(r.replay.stdout,r.first.stdout); assert.equal(r.replay.dispatches,1);
  });
  await t.test('cleanup cannot start ordinary or unknown operations after business deadline', () => {
   for (const args of [['tap','100','200'],['future-phone-operation']]) {
    const r=run(host,{activity:'cleanup',late:true,args}); refused(r,/ABSOLUTE_DEADLINE/);
    assert.deepEqual(r.receipts,{});
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
