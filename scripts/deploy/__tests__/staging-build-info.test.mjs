import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('dependency install is independent of candidate SHA and build-info uses actual SHA', t => {
  const dockerfile=readFileSync(resolve('apps/api/Dockerfile'),'utf8');
  assert.ok(dockerfile.indexOf('RUN npm ci --workspace=apps/api') < dockerfile.indexOf('ARG BUILD_SHA=unknown'));
  assert.ok(dockerfile.indexOf('ENV BUILD_SHA=${BUILD_SHA}') < dockerfile.indexOf('RUN npm run build'));
  const dir=mkdtempSync(join(tmpdir(),'staging-build-info-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'scripts')); copyFileSync(resolve('apps/api/scripts/write-build-info.sh'),join(dir,'scripts/write-build-info.sh'));
  writeFileSync(join(dir,'package.json'),JSON.stringify({version:'1.0.0'}));
  const sha='a'.repeat(40), result=spawnSync('bash',[join(dir,'scripts/write-build-info.sh')],{env:{...process.env,BUILD_SHA:sha},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); assert.equal(JSON.parse(readFileSync(join(dir,'dist/build-info.json'),'utf8')).sha,sha);
});
