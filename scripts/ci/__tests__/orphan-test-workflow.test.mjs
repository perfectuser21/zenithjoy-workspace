import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const workflow=YAML.parse(readFileSync(new URL('../../../.github/workflows/ci-l2-consistency.yml',import.meta.url),'utf8'));
const script=workflow.jobs['orphan-test-check'].steps.find(s=>s.name==='Check all test files are registered in test-registry.yaml').run;
function run(files, registered){
 const root=mkdtempSync(join(tmpdir(),'orphan-check-'));
 try{
  symlinkSync(fileURLToPath(new URL('../../',import.meta.url)),join(root,'scripts'),'dir');
  for(const file of new Set([...files,...registered])){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'');}
  writeFileSync(join(root,'test-registry.yaml'),YAML.stringify({tests:registered.map((path,i)=>({id:`fixture-${i}`,path,type:'unit',ci:'L3',status:'active',product:'fixture'}))}));
  return spawnSync('bash',['-e','-o','pipefail','-c',script],{cwd:root,encoding:'utf8'});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('dependency source cache is excluded, registered workspace tests still pass',()=>{
 const result=run(['.skills-source/sprints/source.test.ts','apps/real.test.ts'],['apps/real.test.ts']);
 assert.equal(result.status,0,result.stdout+result.stderr);
});
test('a genuine unregistered workspace test remains blocked',()=>{
 const result=run(['apps/orphan.test.ts'],['apps/registered.test.ts']);
 assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/apps\/orphan.test.ts/);
});
test('registry paths must match exactly and a large registry does not trigger pipefail',()=>{
 const registered=['apps/real.test.ts',...Array.from({length:10000},(_,i)=>`apps/unused-${i}.test.ts`)];
 const result=run(['apps/real.test.ts'],registered);
 assert.equal(result.status,0,result.stdout+result.stderr);
 const mismatch=run(['apps/real.test.ts'],['prefix/apps/real.test.ts']);
 assert.equal(mismatch.status,1,mismatch.stdout+mismatch.stderr);
});

test('Windows orphan E2E starts runner PostgreSQL before API and stops on native DB failures',()=>{
 const orphan=YAML.parse(readFileSync(new URL('../../../.github/workflows/e2e-orphan-consolidation-windows.yml',import.meta.url),'utf8'));
 const job=orphan.jobs['playwright-orphan-consolidation'];
 const dbIndex=job.steps.findIndex(s=>s.name==='Start runner PostgreSQL service');
 const apiIndex=job.steps.findIndex(s=>s.name==='Start apps/api with real Postgres');
 assert.ok(dbIndex>=0 && dbIndex<apiIndex,'独立数据库步骤必须先于 API');
 const db=job.steps[dbIndex];
 assert.equal(db.shell,'pwsh');
 assert.equal(db['continue-on-error'],undefined);
 assert.match(db.run,/\$ErrorActionPreference\s*=\s*'Stop'/);
 assert.match(db.run,/Get-Service postgresql\*/);
 assert.match(db.run,/if \(\$services\.Count -ne 1\) \{ throw/);
 assert.match(db.run,/Set-Service -Name \$svc\.Name -StartupType Manual/);
 assert.match(db.run,/Start-Service \$svc\.Name/);
 assert.match(db.run,/\$env:PGPASSWORD = 'root'[\s\S]*& "\$env:PGBIN\\psql\.exe" -X -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"\s*if \(\$LASTEXITCODE -ne 0\) \{ throw/);
 assert.match(db.run,/\$env:PGPASSWORD = 'postgres'[\s\S]*& "\$env:PGBIN\\createdb\.exe" -U postgres -h localhost zenithjoy_test\s*if \(\$LASTEXITCODE -ne 0\) \{ throw/);
 const api=job.steps[apiIndex];
 assert.equal(job.defaults.run.shell,'bash');
 assert.doesNotMatch(api.run,/choco|PG_HOME|PGPASSWORD|createdb|powershell/i);
 assert.match(api.run,/npm run migrate --workspace apps\/api/);
 assert.match(api.run,/npm run build --workspace apps\/api/);
 assert.match(api.run,/npm run dev --workspace apps\/api &/);
 assert.match(api.run,/for i in \$\(seq 1 60\)/);
 assert.match(api.run,/curl -fs http:\/\/localhost:3000\/health\s*$/);
});
