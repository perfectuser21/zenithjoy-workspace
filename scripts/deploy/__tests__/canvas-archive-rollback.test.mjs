import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';

const source=readFileSync('scripts/deploy/hk-canvas-staging.sh','utf8');
const begin='# BEGIN CANVAS ARCHIVE RESTORE',end='# END CANVAS ARCHIVE RESTORE';
const match=source.match(/# BEGIN CANVAS ARCHIVE RESTORE\n([\s\S]*?)\n# END CANVAS ARCHIVE RESTORE/);
function fixture(t,{exists=false,corrupt=false,wrongId=false,extraTag=false,badBlob=false,extraBlob=false,nested=false,free=8_000_000_000}={}) {
  const root=mkdtempSync(join(realpathSync(tmpdir()),'canvas-restore-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const release=join(root,'release'),bin=join(root,'bin'),archives=join(root,'archives');mkdirSync(release,{mode:0o700});mkdirSync(archives,{mode:0o700});mkdirSync(join(archives,'release'),{mode:0o700});mkdirSync(bin);mkdirSync(join(root,'dockerstore/tmp'),{recursive:true});mkdirSync(join(root,'containerd/io.containerd.content.v1.content'),{recursive:true});mkdirSync(join(root,'containerd/io.containerd.snapshotter.v1.overlayfs'),{recursive:true});
  const archive=join(archives,'release','image.archive.tar'),manifest=join(archives,'release','image.archive.json');
  const parts=join(root,'parts'),blobs=join(parts,'blobs/sha256');mkdirSync(blobs,{recursive:true});
  const blob=(bytes)=>{const hash=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(blobs,hash),bytes);return {digest:'sha256:'+hash,size:bytes.length}};
  const layerDir=join(root,'layer');mkdirSync(layerDir);writeFileSync(join(layerDir,'fixture'),'isolated layer data');
  const layerTar=join(root,'layer.tar');assert.equal(spawnSync('tar',['-cf',layerTar,'-C',layerDir,'fixture']).status,0);
  const config=blob(Buffer.from('{}')),layer=blob(gzipSync(readFileSync(layerTar)));
  const manifestBlob=blob(Buffer.from(JSON.stringify({schemaVersion:2,config,layers:[{...layer,mediaType:'application/vnd.oci.image.layer.v1.tar+gzip'}]})));
  let imageRoot={...manifestBlob,mediaType:'application/vnd.oci.image.manifest.v1+json'};
  if(nested){
    const attestation=blob(Buffer.from('{"attestation":"synthetic"}'));
    const attestationManifest=blob(Buffer.from(JSON.stringify({schemaVersion:2,config,layers:[{...attestation,mediaType:'application/vnd.in-toto+json'}]})));
    const nestedIndex=blob(Buffer.from(JSON.stringify({schemaVersion:2,manifests:[imageRoot,{...attestationManifest,mediaType:'application/vnd.oci.image.manifest.v1+json'}]})));
    imageRoot={...nestedIndex,mediaType:'application/vnd.oci.image.index.v1+json'};
  }
  if(extraBlob)blob(Buffer.from('unreferenced payload'));
  const imageId=imageRoot.digest;
  if(badBlob)writeFileSync(join(blobs,layer.digest.slice(7)),Buffer.from('untrusted'));
  writeFileSync(join(parts,'index.json'),JSON.stringify({schemaVersion:2,manifests:[{...imageRoot,annotations:{'io.containerd.image.name':'docker.io/library/test-canvas:old'}}]}));
  writeFileSync(join(parts,'manifest.json'),JSON.stringify([{Config:'blobs/sha256/'+config.digest.slice(7),RepoTags:extraTag?['test-canvas:old','other:latest']:['test-canvas:old'],Layers:['blobs/sha256/'+layer.digest.slice(7)]}]));
  const tar=spawnSync('tar',['-cf',archive,'-C',parts,'index.json','manifest.json','blobs']);assert.equal(tar.status,0);
  const data=readFileSync(archive);chmodSync(archive,0o600);
  if(corrupt)writeFileSync(archive,Buffer.from('damaged archive'));
  writeFileSync(manifest,JSON.stringify({version:1,sha256:createHash('sha256').update(data).digest('hex'),image_id:imageId,required_free_bytes:2_000_000_000}),{mode:0o600});
  writeFileSync(join(release,'receipt.json'),JSON.stringify({image_id:imageId}),{mode:0o600});
  writeFileSync(join(bin,'docker'),`#!/bin/sh\nif [ "$1 $2" = 'image inspect' ]; then [ -f "$TEST_MARKER" ] || exit 1; printf '%s\\n' "${wrongId?'sha256:'+'b'.repeat(64):imageId}"; exit 0; fi\nif [ "$1" = info ]; then if [ "$3" = '{{.Driver}}' ]; then echo overlayfs; else echo "$TEST_DOCKER_ROOT"; fi; exit 0; fi\nif [ "$1 $2" = 'context inspect' ]; then echo unix:///var/run/docker.sock; exit 0; fi\nif [ "$1" = load ]; then echo called >> "$TEST_LOG"; touch "$TEST_MARKER"; exit 0; fi\nexit 91\n`,{mode:0o755});
  writeFileSync(join(bin,'df'),`#!/bin/sh\nprintf 'Available\\n${free}\\n'\n`,{mode:0o755});
  writeFileSync(join(bin,'containerd'),`#!/bin/sh\nprintf 'root = "%s"\\n' "$TEST_CONTAINERD_ROOT"\n`,{mode:0o755});
  if(exists)writeFileSync(join(root,'marker'),'existing');
  return {root,release,bin,manifest,archive,run(extra={}){assert.ok(match,'archive restore function exists in deployment entrypoint');const fn=match[1].replaceAll('/var/lib/containerd',join(root,'containerd')).replaceAll('/var/lib/docker',join(root,'dockerstore')).replaceAll('/opt/zenithjoy-backups/canvas-archives',archives);return spawnSync('bash',['-c',`set -euo pipefail\n${fn}\nrestore_canvas_image_if_needed`],{env:{...process.env,PATH:bin+':'+process.env.PATH,RELEASES:root,SHA:'release',IMAGE:'test-canvas:old',TEST_DOCKER_ROOT:join(root,'dockerstore'),TEST_CONTAINERD_ROOT:join(root,'containerd'),TEST_MARKER:join(root,'marker'),TEST_LOG:join(root,'docker.log'),...extra},encoding:'utf8'});},calls(){return existsSync(join(root,'docker.log'))?readFileSync(join(root,'docker.log'),'utf8').trim().split('\n').length:0}};
}
test('rollback integrates optional archive restore before image inspection',()=>{assert.ok(match);assert.ok(source.indexOf('restore_canvas_image_if_needed',source.indexOf(end))<source.indexOf('IMAGE_ID=$(docker image inspect'));});
test('existing image does not read or load an archive',t=>{const f=fixture(t,{exists:true});rmSync(f.archive);let r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.calls(),0)});
test('valid checksummed archive restores exact receipt image',t=>{const f=fixture(t);let r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.calls(),1)});
test('corrupt archive fails before docker load',t=>{const f=fixture(t,{corrupt:true});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('restored wrong image ID aborts rollback',t=>{const f=fixture(t,{wrongId:true});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),1)});
test('insufficient disk aborts before docker load',t=>{const f=fixture(t,{free:100});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('world-readable manifest aborts before docker load',t=>{const f=fixture(t);chmodSync(f.manifest,0o644);let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('archive containing an unrelated tag is rejected before docker load',t=>{const f=fixture(t,{extraTag:true});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('archive with an inconsistent OCI blob is rejected before docker load',t=>{const f=fixture(t,{badBlob:true});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('remote Docker daemon is rejected before docker load',t=>{const f=fixture(t);let r=f.run({DOCKER_HOST:'tcp://remote:2375'});assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
test('nested OCI index and attestation restore the same image',t=>{const f=fixture(t,{nested:true});let r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(f.calls(),1)});
test('unreferenced blob is rejected before docker load',t=>{const f=fixture(t,{extraBlob:true});let r=f.run();assert.notEqual(r.status,0);assert.equal(f.calls(),0)});
