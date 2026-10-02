import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, cli, service } from './workflow-cli-fixture.mjs';

test('真实wrapper在native返回到probe加载窗口收到TERM仍保留已采评论', { timeout: 30000 }, async t => {
  const f = await fixture(t, ['matched']);
  const ready = join(f.home, 'native-returned');
  const preload = join(f.home, 'pause-probe.cjs');
  writeFileSync(preload, `const fs=require('node:fs');
const original=fs.readFileSync;let paused=false;
fs.readFileSync=function(file,...args){
 if(!paused && process.argv[1]?.endsWith('keyword-workflow-activity.js')
    && String(file).endsWith('/checks/social-keyword-leadgen.yaml')){
  paused=true;fs.writeFileSync(process.env.FIXTURE_PROBE_READY,'native已返回');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,800);
 }
 return original.call(this,file,...args);
};`);
  const input = { ...f.input, video: { ...f.input.videos[0], judgment_status: 'matched' },
    return_to_results: true, workflow_artifacts: {}, execution: {}, budget: { max_duration_s: 20, heartbeat_s: 1 } };
  const out = await cli(join(service, 'keyword-workflow-activity.js'), ['collection'], {
    env: { ...f.env, NODE_OPTIONS: f.env.NODE_OPTIONS + ' --require=' + preload, FIXTURE_PROBE_READY: ready },
    input, cancelWhen: ready,
  });
  assert.match(readFileSync(join(f.home, 'calls'), 'utf8'), /collect-comments/);
  assert.equal(out.signal, null, '窗口取消不能让wrapper按默认TERM退出并丢当前产物');
  const result = JSON.parse(out.stdout);
  assert.equal(result.outputs.comments.length, 1);
  assert.equal(result.outputs.comments[0].fields.评论原文, '如何报名1');
  assert.notEqual(result.status, 'completed');
});
