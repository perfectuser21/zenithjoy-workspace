import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root = new URL('../../../../', import.meta.url);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'publisher-registry-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  for (const path of ['scripts/sync-registry.cjs','docs/registry','services/content-pipeline/scripts/publishers']) {
    mkdirSync(join(dir,path,'..'),{recursive:true});
    cpSync(new URL(path,root),join(dir,path),{recursive:true});
  }
  return {dir, run:() => spawnSync(process.execPath,['scripts/sync-registry.cjs'], {cwd:dir,encoding:'utf8',timeout:10000})};
}
test('registry checks all eight current publishing platforms', t => {
  const f=fixture(t), r=f.run(); assert.equal(r.status,0,r.stdout+r.stderr);
  for(const name of ['douyin','kuaishou','xiaohongshu','toutiao','weibo','shipinhao','wechat','zhihu'])
    assert.match(r.stdout,new RegExp('pub_'+name+':'),name);
});
test('unregistered new entry under current source fails the actual checker', t => {
  const f=fixture(t); writeFileSync(join(f.dir,'services/content-pipeline/scripts/publishers/douyin-publisher/publish-unregistered.js'),'// fixture');
  const r=f.run(); assert.equal(r.status,1,r.stdout+r.stderr); assert.match(r.stdout,/publish-unregistered.js/);
});
test('missing registered entry under current source fails the actual checker', t => {
  const f=fixture(t); rmSync(join(f.dir,'services/content-pipeline/scripts/publishers/douyin-publisher/publish-douyin-image.js'));
  const r=f.run(); assert.equal(r.status,1,r.stdout+r.stderr); assert.match(r.stdout,/publish-douyin-image.js/);
});
