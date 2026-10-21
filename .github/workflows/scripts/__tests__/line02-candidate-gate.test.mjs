import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const source = resolve('.github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh');
function fixture(t, mode = 'success') {
  const dir = mkdtempSync(join(tmpdir(), 'line02-candidate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agent = join(dir, 'services/agent');
  mkdirSync(join(agent, 'publishers'), { recursive: true });
  const kw = mode === 'expired' ? {ok: false, error: 'DOUYIN_SESSION_EXPIRED'} : {ok: true, video_urls: ['https://www.douyin.com/video/123']};
  writeFileSync(join(agent, 'publishers/keyword-search-douyin.cjs'), `console.log('fixture keyword'); console.log(${JSON.stringify(JSON.stringify(kw))}); process.exit(${mode === 'bad-exit' ? 2 : 0});`);
  writeFileSync(join(agent, 'publishers/crawl-comments-douyin.cjs'), `console.log('fixture comments'); console.log(JSON.stringify({ok:true,commenters:[{sec_uid:'123',nickname:'test',comment_text:'test'}]}));`);
  copyFileSync(source, join(dir, 'smoke.sh'));
  for (const args of [['init', '-q'], ['add', '.']]) {
    const result = spawnSync('git', args, {cwd:dir, encoding:'utf8'}); assert.equal(result.status,0,result.stderr);
  }
  const tree = spawnSync('git',['write-tree'],{cwd:dir,encoding:'utf8'}).stdout.trim();
  const sha = spawnSync('git',['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture'],{cwd:dir,encoding:'utf8'}).stdout.trim();
  assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(spawnSync('git',['update-ref','HEAD',sha],{cwd:dir}).status,0);
  const run = (extra={}) => spawnSync('bash',[join(dir,'smoke.sh')],{cwd:dir,encoding:'utf8',env:{...process.env,AGENT_DIR:agent,GITHUB_WORKSPACE:dir,GITHUB_SHA:sha,NODE_EXE:process.execPath,...extra}});
  return {dir,agent,sha,run};
}
test('真实共享入口拒绝过期抖音会话，不能exit 0变成nightly绿', t => {
  const {run}=fixture(t,'expired'); const result=run();
  assert.notEqual(result.status,0,result.stdout); assert.match(result.stdout,/DOUYIN_SESSION_EXPIRED/);
});
test('真实共享入口拒绝非候选SHA及latest installed目录', t => {
  const {run}=fixture(t); const result=run({GITHUB_SHA:'0'.repeat(40)});
  assert.notEqual(result.status,0); assert.match(result.stdout,/CANDIDATE_SHA_MISMATCH/);
  const foreign=run({AGENT_DIR:'/tmp/old-installed-agent'}); assert.notEqual(foreign.status,0); assert.match(foreign.stdout,/CANDIDATE_SOURCE_MISMATCH/);
});
test('脚本输出ok=true但进程非零仍拒绝，不能吞子进程错误', t=>{
  const {run}=fixture(t,'bad-exit'); const result=run(); assert.notEqual(result.status,0,result.stdout);
});
test('同SHA源码真实两段进程均成功且评论字段齐全才通过', t=>{
  const {run}=fixture(t); const result=run(); assert.equal(result.status,0,result.stdout+result.stderr); assert.match(result.stdout,/smoke PASS/);
});
