import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,realpathSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const helper=new URL('./helpers/native-phone-test-media.mjs',import.meta.url).href;
function invoke(kind,env){return spawnSync(process.execPath,['--input-type=module','-e',`import {nativePhoneTestMediaBinary} from ${JSON.stringify(helper)};console.log(nativePhoneTestMediaBinary(${JSON.stringify(kind)}));`],{encoding:'utf8',timeout:5000,env:{...process.env,...env}});}
function fixture(t){const dir=realpathSync(mkdtempSync(join(tmpdir(),'native-test-media-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));const binary=join(dir,'actual-installed-tool');writeFileSync(binary,'#!/bin/sh\nexit 0\n',{mode:0o700});return {dir,binary};}
test('test-only media selector accepts an explicit regular executable and canonicalizes installed symlinks',t=>{
 const {dir,binary}=fixture(t),alias=join(dir,'ffmpeg');symlinkSync(binary,alias);
 const r=invoke('ffmpeg',{PREFLIGHT_TEST_FFMPEG_BIN:alias});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),binary);
});
test('ffprobe uses its own explicit physical descriptor',t=>{
 const {binary}=fixture(t),r=invoke('ffprobe',{PREFLIGHT_TEST_FFPROBE_BIN:binary,PREFLIGHT_TEST_FFMPEG_BIN:'/missing/ffmpeg'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),binary);
});
test('without an explicit descriptor Code resolves the actual installed executable from PATH',t=>{
 const {dir,binary}=fixture(t);symlinkSync(binary,join(dir,'ffmpeg'));
 const r=invoke('ffmpeg',{PATH:dir,PREFLIGHT_TEST_FFMPEG_BIN:undefined});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),binary);
});
test('without an explicit descriptor a missing installed executable fails closed',t=>{
 const {dir}=fixture(t),r=invoke('ffmpeg',{PATH:dir,PREFLIGHT_TEST_FFMPEG_BIN:undefined});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/fixture-tool/);
});
for(const kind of ['ffmpeg','ffprobe'])test(kind+' missing explicit tool fails instead of skipping or silently falling back',()=>{
 const r=invoke(kind,{['PREFLIGHT_TEST_'+kind.toUpperCase()+'_BIN']:'/missing/fixture-tool'});assert.notEqual(r.status,0);assert.match(r.stderr,/ENOENT|NATIVE_PHONE_TEST_MEDIA/);
});
for(const mode of ['non-executable','writable','directory','relative'])test('test media input rejects '+mode,t=>{
 const {dir,binary}=fixture(t);let path=binary;
 if(mode==='non-executable')chmodSync(binary,0o600);
 if(mode==='writable')chmodSync(binary,0o722);
 if(mode==='directory'){path=join(dir,'directory');mkdirSync(path);}
 if(mode==='relative')path='relative/ffmpeg';
 const r=invoke('ffmpeg',{PREFLIGHT_TEST_FFMPEG_BIN:path});assert.notEqual(r.status,0);assert.match(r.stderr,/NATIVE_PHONE_TEST_MEDIA/);
});
test('only the two named media tools can be selected',()=>{const r=invoke('sh',{});assert.notEqual(r.status,0);assert.match(r.stderr,/NATIVE_PHONE_TEST_MEDIA/);});
