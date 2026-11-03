import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Execute the actual shell single-quoted node -e body. A JS reimplementation of
// the verifier would miss escaping errors at the shell/JavaScript/SQL boundary.
const shell=readFileSync(resolve('scripts/deploy/hk-canvas-production.sh'),'utf8');
const match=shell.match(/docker exec -i "\$SERVICE" node -e '([\s\S]*?)' "\$ENVIRONMENT"/);
assert.ok(match,'actual deployment employee verifier not found');
const handler=match[1];
const expectedSql='SELECT id,email FROM "user" WHERE id=$1 AND lower(email)=$2';
const authPoolSource=readFileSync(resolve('apps/api/src/db/connection.ts'),'utf8');
const authSearchPath=authPoolSource.match(/options:\s*'([^']+)'/)?.[1];
assert.equal(authSearchPath,'-c search_path=zenithjoy,public','auth pool search path changed; update the deployment boundary contract');
function runVerifier(t,{environment='staging',database='zenithjoy_staging',staff='',plan,raw,missingUser=false,registry}={}){
  const root=mkdtempSync(join(tmpdir(),'canvas-identity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const pg=join(root,'node_modules','pg');mkdirSync(pg,{recursive:true});
  writeFileSync(join(pg,'index.js'),String.raw`
const fs=require('node:fs');let trace=[];
const save=()=>fs.writeFileSync(process.env.TRACE,JSON.stringify(trace));
exports.Client=class {
 constructor(options){this.options=options;trace.push({action:'client',options});save();}
 async connect(){trace.push({action:'connect'});save();}
 async query(sql,params){trace.push({sql,params});save();
   if(sql==='BEGIN READ ONLY'||sql==='ROLLBACK')return {rows:[],rowCount:0};
   // This fixture has the auth registry only in public, matching the observed
   // staging boundary. A hard-coded zenithjoy.user must fail rather than pass
   // merely because its identifier happens to be quoted correctly.
   if(sql.includes('zenithjoy.'))throw Object.assign(Error('relation zenithjoy.user does not exist'),{code:'42P01'});
   if(sql!==process.env.EXPECTED_SQL||this.options.options!=='-c search_path=zenithjoy,public')throw Error('verifier does not follow auth pool table resolution');
   const tables=JSON.parse(process.env.AUTH_REGISTRY);
   const schema=['zenithjoy','public'].find(s=>Object.hasOwn(tables,s));
   if(!schema)throw Object.assign(Error('auth registry missing'),{code:'42P01'});
   const rows=tables[schema].filter(row=>row.id===params[0]&&row.email.toLowerCase()===params[1]);
   return {rows,rowCount:rows.length};
 }
 async end(){trace.push({action:'end'});save();}
};
`);
  const value=plan??{environment,users:[{id:'employee-exact',email:'employee@example.com'}]};
  const result=spawnSync(process.execPath,['-e',handler,environment],{cwd:root,
    input:raw??JSON.stringify(value),encoding:'utf8',
    env:{...process.env,NODE_PATH:join(root,'node_modules'),TRACE:join(root,'trace.json'),EXPECTED_SQL:expectedSql,
      DATABASE_NAME:database,DATABASE_HOST:'fixture',DATABASE_USER:'fixture',DATABASE_PASSWORD:'fixture',
      STAFF_EMAILS:staff,AUTH_REGISTRY:JSON.stringify(registry??{public:missingUser?[]:[{id:'employee-exact',email:'employee@example.com'}]})}});
  return {...result,trace:existsSync(join(root,'trace.json'))?JSON.parse(readFileSync(join(root,'trace.json'),'utf8')):[]};
}
test('actual staging handler resolves public-only auth registry like the auth pool, with exact identity and read-only transaction',t=>{
  const r=runVerifier(t);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{registered_employees_verified:1});
  assert.deepEqual(r.trace.filter(x=>x.sql).map(x=>x.sql),['BEGIN READ ONLY',expectedSql,'ROLLBACK']);
  assert.deepEqual(r.trace.find(x=>x.sql===expectedSql).params,['employee-exact','employee@example.com']);
  assert.equal(r.trace.find(x=>x.action==='client').options.options,authSearchPath);
  assert.equal(r.trace.at(-1).action,'end');
});
test('actual production handler requires exact employee staff membership',t=>{
  const allowed=runVerifier(t,{environment:'production',database:'zenithjoy',staff:'employee@example.com'});
  assert.equal(allowed.status,0,allowed.stderr);
  const denied=runVerifier(t,{environment:'production',database:'zenithjoy',staff:'other@example.com'});
  assert.notEqual(denied.status,0);assert.ok(!denied.trace.some(x=>x.sql===expectedSql));
});
test('zenithjoy registry takes priority when its user table exists; no fallback on a different identity',t=>{
  const exact={id:'employee-exact',email:'employee@example.com'},other={id:'other-id',email:'employee@example.com'};
  const preferred=runVerifier(t,{registry:{zenithjoy:[exact],public:[other]}});
  assert.equal(preferred.status,0,preferred.stderr);
  const noCrossSchemaFallback=runVerifier(t,{registry:{zenithjoy:[other],public:[exact]}});
  assert.notEqual(noCrossSchemaFallback.status,0);
  assert.ok(!noCrossSchemaFallback.stdout.includes('registered_employees_verified'));
});
test('wrong registry id or email is refused without substituting one identity for the other',t=>{
  for(const row of [{id:'other-id',email:'employee@example.com'},{id:'employee-exact',email:'other@example.com'}]){
    const r=runVerifier(t,{registry:{public:[row]}});assert.notEqual(r.status,0);
    assert.deepEqual(r.trace.find(x=>x.sql===expectedSql)?.params,['employee-exact','employee@example.com']);
    assert.ok(!r.stdout.includes('registered_employees_verified'));
  }
});
test('target environment argv and database must both match before registry access',t=>{
  for(const overrides of [{plan:{environment:'production',users:[]}},{database:'zenithjoy'}]){
    const r=runVerifier(t,overrides);assert.notEqual(r.status,0);
    assert.ok(!r.trace.some(x=>x.sql));assert.equal(r.trace.at(-1).action,'end');
  }
});
test('stdin is consumed as JSON and missing registry identity fails without an approval receipt',t=>{
  for(const overrides of [{raw:'not json'},{missingUser:true}]){
    const r=runVerifier(t,overrides);assert.notEqual(r.status,0);
    assert.ok(!r.stdout.includes('registered_employees_verified'));assert.equal(r.trace.at(-1).action,'end');
  }
});
