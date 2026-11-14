import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
const wf=name=>parse(readFileSync(new URL(`../../${name}.yml`,import.meta.url),'utf8'));
const backup=new URL('../backup/select-pg-dump.sh',import.meta.url);
test('trusted APT and Chromium consumers use a supported reviewed Ubuntu release',()=>{
 for(const [name,ids] of [
  ['ci-l3-code',['openclaw-scripts-test']],
  ['ci-l4-runtime',['api-test','agent-test']],
  ['ci-smoke-glob-runner',['smoke-glob-shards']],
  ['e2e-staff-skill-eval',['skill-eval-ui']],
  ['e2e-knowledge-hub-path2',['linux-guards-and-db']],
  ['db-backup',['backup-and-drill']],
 ]) for(const id of ids) assert.equal(wf(name).jobs[id]['runs-on'],'ubuntu-24.04',`${name}/${id}`);
});
test('both current document restore consumers invoke the maintained drill',()=>{
 for(const [name,id] of [['db-backup','backup-and-drill'],['e2e-knowledge-hub-path2','linux-guards-and-db']]){
  const runs=wf(name).jobs[id].steps.map(s=>s.run||'').join('\n');
  assert.match(runs,/bash \.github\/workflows\/scripts\/backup\/documents-restore-drill\.sh/);
  assert.doesNotMatch(runs,/bash sprints\/.*backup-restore-drill/);
 }
 const source=readFileSync(new URL('../backup/documents-restore-drill.sh',import.meta.url),'utf8');
 assert.match(source,/select_pg_dump "\$PG"/);
 assert.match(source,/"\$PG_DUMP" -t zenithjoy\.documents/);
});
function selection(t,{server='160010',defaultMajor='18',versioned='16',official=false,restoreMajor='16',checkRestore=false}={}) {
 const dir=mkdtempSync(join(tmpdir(),'pg-client-selection-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bin=join(dir,'bin');mkdirSync(bin);
 const executable=(name,body)=>writeFileSync(join(bin,name),'#!/bin/bash\n'+body+'\n',{mode:0o755});
 executable('psql',`printf '%s\\n' '${server}'`);
 executable('pg_restore',`echo 'pg_restore (PostgreSQL) 18.1'`);
 executable('pg_restore-16',`echo 'pg_restore (PostgreSQL) ${restoreMajor}.1'`);
 executable('pg_dump',`echo 'pg_dump (PostgreSQL) ${defaultMajor}.1'`);
 if(official){const target=join(dir,'clients/16/bin');mkdirSync(target,{recursive:true});writeFileSync(join(target,'pg_dump'),`#!/bin/bash\necho 'pg_dump (PostgreSQL) 16.2'\n`,{mode:0o755});}
 if(versioned)executable('pg_dump-16',`echo 'pg_dump (PostgreSQL) ${versioned}.1'`);
 return spawnSync('/bin/bash',['-euo','pipefail','-c','source "$1"; select_pg_dump postgresql://fixture.invalid/db "$2"; "$PG_DUMP" --version; if [ "$3" = yes ]; then select_pg_restore "$2"; "$PG_RESTORE" --version; fi','fixture',backup.pathname,join(dir,'clients'),checkRestore?'yes':'no'],{encoding:'utf8',env:{...process.env,PATH:bin+':/usr/bin:/bin'}});
}
test('selects matching dump major instead of newer default wrapper',t=>{
 const r=selection(t);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PostgreSQL\) 16\.1/);
});
test('rejects mismatched dump and invalid server major before dumping',t=>{
 for(const options of [{versioned:'18'},{server:'invalid'}]){
  const r=selection(t,options);assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/PG_DUMP_MAJOR_UNAVAILABLE|PG_SERVER_VERSION_INVALID/);
 }
});

test('prefers official version-specific package binary over default and named wrappers',t=>{
 const r=selection(t,{official:true,versioned:'18'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PostgreSQL\) 16\.2/);
});

test('custom archive restore explicitly validates and selects the same major as dump',t=>{
 const good=selection(t,{checkRestore:true});assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/pg_restore \(PostgreSQL\) 16/);
 const bad=selection(t,{checkRestore:true,restoreMajor:'18'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/PG_RESTORE_MAJOR_UNAVAILABLE/);
 const source=readFileSync(new URL('../backup/restore-drill.sh',import.meta.url),'utf8');
 assert.match(source,/select_pg_restore/);assert.match(source,/"\$PG_DUMP" "\$SRC_URL"/);assert.match(source,/"\$PG_RESTORE" --dbname=/);
});

test('maintained document drill and selector changes trigger the real PostgreSQL consumer',()=>{
 const paths=wf('e2e-knowledge-hub-path2').on.pull_request.paths;
 for(const path of [
  '.github/workflows/scripts/backup/documents-restore-drill.sh',
  '.github/workflows/scripts/backup/select-pg-dump.sh',
 ]) assert.ok(paths.includes(path),`pull_request misses ${path}`);
});
