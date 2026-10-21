import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url);
test('安装包构建只登记候选，模块产物固定到源码目录且缺失必失败',()=>{
 const build=readFileSync(new URL('.github/workflows/agent-installpack.yml',root),'utf8');
 assert.doesNotMatch(build,/-X PUT|\/install-pack\/manifest/);
 assert.match(build,/\/install-pack\/candidates/);
 assert.match(build,/source_sha/);
 assert.match(build,/retention-days: 30/);
 assert.doesNotMatch(build,/pending \(beta\)|跳过上传/);
 assert.match(build,/modules\/candidates\/\$\{GITHUB_SHA\}/);
});
test('正式晋级单独执行：共享生产锁、完整固定来源、实际验收、版本读回',()=>{
 const file=readFileSync(new URL('.github/workflows/promote-installpack.yml',root),'utf8');
 assert.match(file,/group: zenithjoy-production-hk/);
 assert.match(file,/acceptance_run_key/);assert.match(file,/scripts\/release-gate\/installpack-promote.mjs/);
 assert.doesNotMatch(file,/continue-on-error/);
});

test('包内必须带固定源码身份，候选构建不能写正式版本记录',()=>{
 const build=readFileSync(new URL('services/agent/scripts/build-install-pack.sh',root),'utf8');
 assert.match(build,/release-source\.json/);assert.doesNotMatch(build,/notion-agent-token/);
});
