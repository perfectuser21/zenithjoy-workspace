import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixtureAdb} from './adb-existing-route.test.mjs';
import {phoneLockFixtureEnv} from './helpers/phone-lock-fixture.mjs';
const script=new URL('../douyin-phone-adb',import.meta.url).pathname;
test('standalone search navigation verifies its exact owner before any phone action',()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'direct-nav-owner-'));
 try{
  const registry=join(dir,'profiles.tsv'),adb=join(dir,'adb');writeFileSync(registry,'test\tTESTDEV\tFixture\t720\t1280\n');writeFileSync(adb,'#!/bin/sh\necho UNEXPECTED_PHONE_ACTION >&2\nexit 19\n',{mode:0o755});
  const env={...process.env,...phoneLockFixtureEnv(registry,join(dir,'phone')),DOUYIN_ADB_BIN:fixtureAdb(adb),DOUYIN_PYTHON_BIN:spawnSync('/bin/sh',['-c','command -v python3'],{encoding:'utf8'}).stdout.trim()};
  const acquire=spawnSync('/bin/zsh',[script,'--profile','test','lock-acquire','owner-a'],{env,encoding:'utf8'});assert.equal(acquire.status,0,acquire.stderr);
  for(const command of ['open-search','search-video-tab','search-time-layer','search-video-cards','open-video','back-to-results','evidence-bundle']){
   const r=spawnSync('/bin/zsh',[script,'--profile','test','--lock-owner','owner-b',command],{env,encoding:'utf8'});
   assert.notEqual(r.status,0);assert.match(r.stderr,/required lock owner does not match current lock/,command);assert.doesNotMatch(r.stderr,/UNEXPECTED_PHONE_ACTION/);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
