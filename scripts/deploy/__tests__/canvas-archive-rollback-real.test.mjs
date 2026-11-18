import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';

// Real docker save/load of a disposable scratch image, with no network. Docker
// state is cleaned only for the randomly named fixture created by this test.
test('restores a real OCI image after its fixture image is removed',t=>{
  const version=spawnSync('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8'});
  if(version.status!==0){t.skip('Docker daemon unavailable');return;}
  const docker=execFileSync('which',['docker'],{encoding:'utf8'}).trim();
  const root=mkdtempSync(join(realpathSync(tmpdir()),'canvas-real-'));
  const image='canvas-restore-fixture:'+randomBytes(8).toString('hex');
  t.after(()=>{spawnSync(docker,['image','rm',image]);rmSync(root,{recursive:true,force:true})});
  const bin=join(root,'bin'),parts=join(root,'layer'),releases=join(root,'releases'),archives=join(root,'archives'),store=join(root,'dockerstore'),containerd=join(root,'containerd');
  for(const p of [bin,parts,join(releases,'release'),join(archives,'release'),join(store,'tmp'),join(containerd,'io.containerd.content.v1.content'),join(containerd,'io.containerd.snapshotter.v1.overlayfs')])mkdirSync(p,{recursive:true,mode:0o700});
  writeFileSync(join(parts,'test.txt'),'synthetic staging fixture\n');
  const layer=join(root,'layer.tar');assert.equal(spawnSync('tar',['-cf',layer,'-C',parts,'test.txt']).status,0);
  assert.equal(spawnSync(docker,['image','import',layer,image]).status,0);
  const id=execFileSync(docker,['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).trim();
  const archive=join(archives,'release','image.archive.tar');assert.equal(spawnSync(docker,['image','save','--output',archive,image]).status,0);chmodSync(archive,0o600);
  const sha=createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(releases,'release','receipt.json'),JSON.stringify({image_id:id}),{mode:0o600});
  writeFileSync(join(archives,'release','image.archive.json'),JSON.stringify({version:1,sha256:sha,image_id:id,required_free_bytes:1024}),{mode:0o600});
  assert.equal(spawnSync(docker,['image','rm',image]).status,0);
  writeFileSync(join(bin,'df'),'#!/bin/sh\nprintf "Available\\n100000000000\\n"\n',{mode:0o755});
  writeFileSync(join(bin,'docker'),`#!/bin/sh\nif [ "$1" = info ]; then if [ "$3" = '{{.Driver}}' ]; then echo overlayfs; else printf '%s\\n' "$TEST_DOCKER_ROOT"; fi; exit 0; fi\nif [ "$1 $2" = 'context inspect' ]; then echo unix:///var/run/docker.sock; exit 0; fi\nexec '${docker}' "$@"\n`,{mode:0o755});
  writeFileSync(join(bin,'containerd'),'#!/bin/sh\nprintf \'root = "%s"\\n\' "$TEST_CONTAINERD_ROOT"\n',{mode:0o755});
  const script=readFileSync('scripts/deploy/hk-canvas-staging.sh','utf8').match(/# BEGIN CANVAS ARCHIVE RESTORE\n([\s\S]*?)\n# END CANVAS ARCHIVE RESTORE/)?.[1];assert.ok(script);
  const fn=script.replaceAll('/var/lib/containerd',containerd).replaceAll('/var/lib/docker',store).replaceAll('/opt/zenithjoy-backups/canvas-archives',archives);
  const restored=spawnSync('bash',['-c',`set -euo pipefail\n${fn}\nrestore_canvas_image_if_needed`],{env:{...process.env,DOCKER_HOST:'',DOCKER_CONTEXT:'',PATH:bin+':'+process.env.PATH,RELEASES:releases,SHA:'release',IMAGE:image,TEST_DOCKER_ROOT:store,TEST_CONTAINERD_ROOT:containerd},encoding:'utf8'});
  assert.equal(restored.status,0,restored.stderr);
  assert.equal(execFileSync(docker,['image','inspect',image,'--format','{{.Id}}'],{encoding:'utf8'}).trim(),id);
});
