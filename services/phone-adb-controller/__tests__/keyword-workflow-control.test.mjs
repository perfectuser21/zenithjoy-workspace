import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let createWorkflowControl;
try { ({ createWorkflowControl } = require('../keyword-workflow-control.js')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const input = { run_tag: 'lease-fixture', device: { profile: 'jinoshengyuan-work', lock_holder: 'lease-fixture' } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const end = Date.now() + 2500;
  while (!check() && Date.now() < end) await sleep(10);
  assert.ok(check(), label);
}
function fixture(config = {}) {
  const home = mkdtempSync(path.join(tmpdir(), 'keyword-control-'));
  const stateFile = path.join(home, 'state.json'), log = path.join(home, 'commands.jsonl');
  const receiptPath = path.join(home, 'receipt.json'), stopFile = path.join(home, 'stop');
  mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ owner: input.run_tag, ...config }));
  writeFileSync(path.join(home, '.local/bin/douyin-phone-adb'), `#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2),action=args[2];
const read=()=>JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE));
const record=row=>fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({pid:process.pid,action,args,...row})+'\\n');
record({phase:'start'});process.on('exit',()=>record({phase:'exit'}));
process.on('SIGTERM',()=>process.exit(143));
async function main(){
  const before=read();if(before.delay_action===action)await new Promise(r=>setTimeout(r,before.delay_ms||180));
  const s=read();
  if(action==='lock-status'){console.log(s.unknown?'unrecognized':s.owner?'lock=held owner='+s.owner+' stale=false ttl=1800s':'lock=free');return;}
  if(action!=='lock-refresh'){process.exitCode=99;return;}
  // 测试边界也在提交时核对 owner，拒绝等待期间换锁的请求。
  if(s.owner!==args[3]){record({phase:'rejected',owner:s.owner});process.exitCode=1;return;}
  if(s.refresh_loses_owner){s.owner='foreign';fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(s));}
  record({phase:'refreshed',owner:s.owner});console.log('lock=refreshed owner='+args[3]);
}
main().catch(e=>{console.error(e);process.exitCode=1;});`, { mode: 0o755 });
  const rows = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const set = patch => writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(readFileSync(stateFile)), ...patch }));
  const control = extra => {
    assert.equal(typeof createWorkflowControl, 'function', '缺少整批续租与软停止控制入口');
    return createWorkflowControl(input, { receiptPath, stopFile, env: { HOME: home,
      FIXTURE_STATE: stateFile, FIXTURE_LOG: log }, leaseIntervalMs: 25, maxSeconds: 30, ...extra });
  };
  return { home, rows, set, control, stopFile, receiptPath, cleanup: () => writeFileSync(receiptPath,
    JSON.stringify({ run_tag: input.run_tag, last_event: { event_type: 'ACTIVITY_STARTED', activity: 'cleanup' } })),
  dispose: () => rmSync(home, { recursive: true, force: true }) };
}

test('真实控制器子进程对本run续租并读回，跨活动gap仍持续', async () => {
  const f = fixture(); let c;
  try { c = f.control(); await until(() => f.rows().filter(r => r.phase === 'refreshed').length >= 2, '未持续续租');
    assert.equal(c.signal.aborted, false);
    const rows = f.rows().filter(r => r.phase === 'start');
    const refresh = rows.findIndex(r => r.action === 'lock-refresh');
    assert.equal(rows[refresh - 1].action, 'lock-status'); assert.equal(rows[refresh + 1].action, 'lock-status');
    assert.deepEqual(rows[refresh].args, ['--profile', input.device.profile, 'lock-refresh', input.run_tag]);
  } finally { await c?.dispose(); f.dispose(); }
});

test('未获锁free可等待，foreign绝不刷新并软停止', async () => {
  const f = fixture({ owner: null }); let c;
  try { c = f.control(); await until(() => f.rows().some(r => r.phase === 'exit'), '未检查空锁');
    assert.equal(c.signal.aborted, false); assert.equal(f.rows().some(r => r.action === 'lock-refresh'), false);
    f.set({ owner: 'foreign' }); await until(() => c.signal.aborted, '外来owner没有软停止');
    assert.equal(c.reason(), 'foreign_lock'); assert.ok(existsSync(f.stopFile));
    assert.equal(f.rows().some(r => r.action === 'lock-refresh'), false);
  } finally { await c?.dispose(); f.dispose(); }
});

test('本run已持锁后unknown或free均软停止', async () => {
  for (const patch of [{ unknown: true }, { owner: null }]) {
    const f = fixture(); let c;
    try { c = f.control(); await until(() => f.rows().some(r => r.phase === 'refreshed'), '未先获锁');
      f.set(patch); await until(() => c.signal.aborted, '锁丢失没有软停止');
      assert.equal(c.reason(), 'lock_unavailable');
    } finally { await c?.dispose(); f.dispose(); }
  }
});

test('续租命令成功仍必须检查真实owner读回', async () => {
  const f = fixture({ refresh_loses_owner: true }); let c;
  try { c = f.control(); await until(() => c.signal.aborted, '错误续租回执被当作成功');
    assert.equal(c.reason(), 'foreign_lock');
    const actions = f.rows().filter(r => r.phase === 'start').map(r => r.action);
    assert.deepEqual(actions, ['lock-status', 'lock-refresh', 'lock-status']);
  } finally { await c?.dispose(); f.dispose(); }
});

test('cleanup先停止续期，inflight status不会再发refresh', async () => {
  const f = fixture({ delay_action: 'lock-status', delay_ms: 180 }); let c;
  try { c = f.control(); await until(() => f.rows().some(r => r.phase === 'start'), '未发起租约检查');
    f.cleanup(); f.set({ owner: 'foreign' }); await sleep(220); await c.dispose();
    assert.equal(c.signal.aborted, false); assert.equal(f.rows().some(r => r.action === 'lock-refresh'), false);
    const n = f.rows().length; await sleep(70); assert.equal(f.rows().length, n);
  } finally { await c?.dispose(); f.dispose(); }
});

test('cleanup中已有refresh须停止并等待退出，dispose无活子进程', async () => {
  const f = fixture({ delay_action: 'lock-refresh', delay_ms: 220 }); let c;
  try { c = f.control(); await until(() => f.rows().some(r => r.action === 'lock-refresh' && r.phase === 'start'), '未发起续期');
    f.cleanup(); f.set({ owner: 'foreign' }); await c.dispose();
    assert.equal(f.rows().some(r => r.phase === 'refreshed'), false);
    assert.equal(c.signal.aborted, false);
    for (const pid of new Set(f.rows().map(r => r.pid))) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { await c?.dispose(); f.dispose(); }
});

test('总截止只写自身stopfile并发软取消信号，dispose后定时器停', async () => {
  const f = fixture({ owner: null }); let c;
  try { c = f.control({ maxSeconds: 0.06 }); await until(() => c.signal.aborted, '整批截止没有软取消');
    assert.equal(c.reason(), 'deadline'); assert.ok(existsSync(f.stopFile));
    assert.equal(f.rows().some(r => !['lock-status', 'lock-refresh'].includes(r.action)), false);
    await c.dispose(); const n = f.rows().length; await sleep(70); assert.equal(f.rows().length, n);
  } finally { await c?.dispose(); f.dispose(); }
});

test('沿用run起跑时间和父取消信号，父取消不取消finalizer自身预算', async () => {
  const f = fixture({ owner: null }); let c;
  try { const parent = new AbortController(); c = f.control({ signal: parent.signal }); parent.abort();
    assert.equal(c.signal.aborted, true); assert.equal(c.reason(), 'interrupted'); assert.ok(existsSync(f.stopFile));
    await c.dispose();
    c = f.control({ env: { HOME: f.home, WF_RUN_START_TS: String(Math.floor(Date.now() / 1000) - 31),
      FIXTURE_STATE: path.join(f.home, 'state.json'), FIXTURE_LOG: path.join(f.home, 'commands.jsonl') } });
    await until(() => c.signal.aborted, '截止未沿用整批起跑时间'); assert.equal(c.reason(), 'deadline');
  } finally { await c?.dispose(); f.dispose(); }
});

test('快速cleanup覆盖last_event后仍从活动记录停止续期', async () => {
  const f = fixture({ delay_action: 'lock-status', delay_ms: 180 }); let c;
  try { c = f.control(); await until(() => f.rows().some(r => r.phase === 'start'), '未发起检查');
    f.cleanup();
    writeFileSync(f.receiptPath, JSON.stringify({ run_tag: input.run_tag, activities: [{ key: 'cleanup', status: 'completed' }],
      last_event: { event_type: 'ACTIVITY_FINISHED', activity: 'cleanup' } }));
    f.set({ owner: null }); await sleep(220);
    assert.equal(c.signal.aborted, false, '快速归位之后不应误报失锁');
    assert.equal(f.rows().some(r => r.action === 'lock-refresh'), false);
    assert.ok(c.events.some(e => e.event_type === 'LOCK_LEASE_STOPPED'), '应确认归位已开始并停止续租');
  } finally { await c?.dispose(); f.dispose(); }
});

test('env总预算生效，未知锁及非法预算拒绝', async () => {
  const f = fixture({ unknown: true }); let c;
  try { c = f.control(); await until(() => c.signal.aborted, '未知锁必须安全停止');
    assert.equal(c.reason(), 'lock_unavailable'); await c.dispose();
    c = f.control({ maxSeconds: undefined, env: { HOME: f.home, WF_RUN_MAX_SECONDS: '0',
      FIXTURE_STATE: path.join(f.home, 'state.json'), FIXTURE_LOG: path.join(f.home, 'commands.jsonl') } });
    await until(() => c.signal.aborted, 'env总预算未生效'); assert.equal(c.reason(), 'deadline');
    assert.throws(() => f.control({ maxSeconds: -1 }), /budget_invalid/);
    assert.throws(() => f.control({ leaseIntervalMs: 1800000 }), /budget_invalid/);
  } finally { await c?.dispose(); f.dispose(); }
});
