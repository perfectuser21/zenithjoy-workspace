import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { deploymentManifest } from '../deployment-manifest.mjs';
test('部署manifest必须绑定git固定commit的真实字节，dirty同HEAD不能盖章',()=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-fixed-'));const source=join(root,'services/phone-adb-controller');mkdirSync(source,{recursive:true});writeFileSync(join(source,'run.sh'),'original\n');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 git('init','-b','cp-10021800-runtime-fixture');git('add','.');const tree=git('write-tree').toString().trim();const commit=git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture').toString().trim();
 const manifest=deploymentManifest(root,['run.sh'],{commit});assert.match(manifest.source_commit,/^[a-f0-9]{40}$/);assert.equal(manifest.files[0].deployed_path,'run.sh');
 git('update-ref','HEAD',commit);
 const cli=join(root,'manifest-cli-link.mjs');symlinkSync(new URL('../deployment-manifest.mjs',import.meta.url).pathname,cli);
 const output=execFileSync(process.execPath,[cli,root,'run.sh'],{encoding:'utf8'});
 assert.deepEqual(JSON.parse(output),manifest,'符号链接部署入口必须真正执行并输出manifest');
 writeFileSync(join(source,'run.sh'),'dirty\n');assert.throws(()=>deploymentManifest(root,['run.sh'],{commit}),/固定commit/);
});

// 直接执行部署脚本的计划循环，覆盖非交互SSH中Homebrew不在PATH的场景。
test('计划JSON部署在远端PATH无node时仍校验真实字节，非法JSON阻止完成', t => {
  const root = mkdtempSync(join(tmpdir(), 'deployment-plan-node-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), remote = join(root, 'remote');
  mkdirSync(join(source, 'plans'), { recursive: true });
  mkdirSync(join(remote, 'bin-harvest', 'plans'), { recursive: true });
  const file = join(source, 'plans', 'fixture.steps.json');
  writeFileSync(file, '{"steps":[]}');
  const emptyPath = join(root, 'remote-empty-path'); mkdirSync(emptyPath);
  const noNode = spawnSync('/bin/bash', ['-c', 'command -v node'], { env: { PATH: emptyPath } });
  assert.notEqual(noNode.status, 0, '远端模拟PATH不得含node');
  const script = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  const start = script.indexOf('  for f in "${DEVICE_PLAN_FILES[@]}"; do');
  assert.ok(start >= 0);
  const end = script.indexOf('\n  done', start) + '\n  done'.length;
  const loop = script.slice(start, end);
  const fakeSSH = join(root, 'ssh');
  writeFileSync(fakeSSH, `#!/bin/bash
command="$2"
printf '%s\\n' "$command" >> "$REMOTE_LOG"
command="\${command//\\~\\//$REMOTE_HOME/}"
command="\${command//\\/opt\\/homebrew\\/bin\\/node/$FIXTURE_NODE}"
PATH="$REMOTE_PATH" /bin/bash -c "$command"
`, { mode: 0o700 });
  const run = () => spawnSync('/bin/bash', ['-c', `
D="$1"; host=xian-m4; FAILED=0
DEVICE_PLAN_FILES=(plans/fixture.steps.json)
push_atomic(){ /bin/cp "$1" "$REMOTE_HOME/bin-harvest/plans/$4"; }
${loop}
exit "$FAILED"
`, '_', source], { encoding: 'utf8', env: { ...process.env, PATH: `${root}:/usr/bin:/bin`,
    REMOTE_HOME: remote, REMOTE_PATH: emptyPath, REMOTE_LOG: join(root, 'remote.log'), FIXTURE_NODE: process.execPath } });
  const valid = run();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  assert.match(readFileSync(join(root, 'remote.log'), 'utf8'), /\/opt\/homebrew\/bin\/node -e/);
  writeFileSync(file, '{');
  const invalid = run();
  assert.equal(invalid.status, 1, '非法JSON不得完成部署');
  assert.match(invalid.stdout, /语法检查失败/);
});

test('部署后collect必须读实际文件字节和机器身份，篡改拒绝而非复制声明摘要',()=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-readback-'));writeFileSync(join(root,'run.sh'),'actual\n');
 const manifest={source_repo:'fixture/repo',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/run.sh',deployed_path:'run.sh',content_sha256:createHash('sha256').update('actual\n').digest('hex')}]};
 const mf=join(root,'manifest.json');writeFileSync(mf,JSON.stringify(manifest));
 const cli=new URL('../deployment-manifest.mjs',import.meta.url).pathname;
 const r=spawnSync(process.execPath,[cli,'collect',root,mf],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const result=JSON.parse(r.stdout);assert.equal(result.files[0].content_sha256,manifest.files[0].content_sha256);assert.equal(result.observed_hostname,hostname());
 writeFileSync(join(root,'run.sh'),'tampered');const bad=spawnSync(process.execPath,[cli,'collect',root,mf],{encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/实际.*digest/);
});
