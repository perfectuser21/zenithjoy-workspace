import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const smoke=fileURLToPath(new URL('../ai-video-pipeline-local-smoke.sh',import.meta.url));
for(const [name,extra] of [
 ['missing disposable authorization',{BASE_URL:'http://127.0.0.1:1'}],
 ['no explicit URL',{SMOKE_SCRATCH_API:'1'}],
 ['production URL',{SMOKE_SCRATCH_API:'1',BASE_URL:'https://autopilot.zenjoymedia.media'}],
 ['loopback credentials',{SMOKE_SCRATCH_API:'1',BASE_URL:'http://user:password@127.0.0.1:1'}],
 ['redirect-looking hostname',{SMOKE_SCRATCH_API:'1',BASE_URL:'http://127.0.0.1.example.com:1'}],
 ['embedded path',{SMOKE_SCRATCH_API:'1',BASE_URL:'http://127.0.0.1:1/not-api'}],
])test('local video smoke rejects '+name+' before any transport',t=>{
 const root=mkdtempSync(join(tmpdir(),'pipeline-smoke-guard-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'bin'));
 const marker=join(root,'transport-called');writeFileSync(join(root,'bin/curl'),'#!/bin/sh\nprintf attempted > "$FIXTURE_MARKER"\nexit 99\n',{mode:0o755});
 const env={...process.env,PATH:join(root,'bin')+':'+process.env.PATH,FIXTURE_MARKER:marker};for(const key of ['SMOKE_SCRATCH_API','BASE_URL','API_BASE','LICENSE'])delete env[key];Object.assign(env,extra);
 const r=spawnSync('bash',[smoke],{env,encoding:'utf8',timeout:5000});assert.notEqual(r.status,0);assert.equal(existsSync(marker),false,'transport must not run');assert.match(r.stderr+r.stdout,/scratch|loopback|explicit/i);
});
