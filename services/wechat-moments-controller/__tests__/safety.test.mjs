// Executes the actual CLI with injected local adapters. No physical ADB, network,
// credential file, screenshot, real message, publish or like operation is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

test('actual controller enforces lock ownership, repeat-publish refusal and failed visual judgment without a tap',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'moments-cli-contract-'));
 const serial=`ci-fixture-${randomUUID()}`,profile=`ci-profile-${randomUUID()}`,evidence=`ci-${randomUUID()}`;
 const lock=join('/private/tmp/openclaw-phone/locks',`${serial}.lock`);
 const once=join('/private/tmp/openclaw-phone/publish-once',`${serial}-${evidence}.lock`);
 const evidenceRoot=join('/private/tmp/openclaw-phone/evidence-moments',profile);
 const controller=join(scratch,'wechat-moments-adb'),adapter=join(scratch,'adb-managed-client.py'),model=join(scratch,'model-fixture'),registry=join(scratch,'registry.tsv'),calls=join(scratch,'adapter.log'),key=join(scratch,'synthetic-key');
 try{
  await writeFile(controller,await readFile(new URL('../wechat-moments-adb',import.meta.url)));
  await writeFile(adapter,'#!/bin/sh\nprintf "%s\\n" "$*" >> "$FIXTURE_ADAPTER_LOG"\ncase "$*" in\n *get-state) echo device;;\n *ro.product.model) echo fixture-model;;\n *screencap*) printf fixture-image;;\n *) echo "unsupported local fixture command" >&2; exit 97;;\nesac\n');
  await writeFile(model,'#!/bin/sh\necho "injected visual provider unavailable" >&2\nexit 91\n');
  await chmod(adapter,0o755);await chmod(model,0o755);
  await writeFile(key,'synthetic fixture, never an account credential');
  await writeFile(registry,`#schema=v2\nprofile\tserial\tmodel\twidth\theight\tenabled\n${profile}\t${serial}\tfixture-model\t1080\t1920\ttrue\n`);
  const env={...process.env,WECHAT_PHONE_REGISTRY:registry,WECHAT_ADB_BIN:adapter,ZJ_ADB_HOST_CONFIG:join(scratch,'unused-config'),WECHAT_PYTHON_BIN:model,WECHAT_LOCATE_KEY_FILE:key,FIXTURE_ADAPTER_LOG:calls};
  const run=(...args)=>spawnSync('/bin/zsh',[controller,'--profile',profile,...args],{env,encoding:'utf8',timeout:5000});
  assert.equal(run('lock-acquire','owner-one').status,0);
  assert.equal(run('lock-acquire','owner-one').status,0);
  const denied=run('lock-acquire','owner-two');assert.notEqual(denied.status,0);assert.match(denied.stderr,/held by another run/);
  assert.notEqual(run('lock-release','owner-two').status,0);
  assert.equal(run('lock-release','owner-one').status,0);
  await mkdir(join('/private/tmp/openclaw-phone/publish-once'),{recursive:true});await writeFile(once,'already attempted');
  const repeated=run('publish',evidence);assert.notEqual(repeated.status,0);assert.match(repeated.stderr,/publish already attempted/);
  const visualFailure=run('like-current-card',evidence);assert.notEqual(visualFailure.status,0);assert.match(visualFailure.stderr,/visual|vision|bar visibility/);
  const log=await readFile(calls,'utf8');assert.doesNotMatch(log,/input tap|am broadcast|ime set/);
 }finally{
  await rm(lock,{recursive:true,force:true});await rm(once,{force:true});await rm(evidenceRoot,{recursive:true,force:true});await rm(scratch,{recursive:true,force:true});
 }
});
