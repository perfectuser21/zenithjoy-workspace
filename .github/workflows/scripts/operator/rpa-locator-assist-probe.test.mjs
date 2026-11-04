import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./rpa-locator-assist-probe.sh',import.meta.url));
function fixture(options={}){
 const directory=mkdtempSync('/tmp/zj-locator-operator-');const log=directory+'/calls';writeFileSync(log,'');
 writeFileSync(directory+'/psql',`#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');const sql=args[args.indexOf('-c')+1]||'';if(sql.includes('current_database'))console.log(${JSON.stringify(options.database??'zj_locator_probe_fixture')});else if(sql.includes('information_schema.tables'))console.log('1');else if(sql.startsWith('SELECT id '))console.log('11111111-1111-4111-8111-111111111111');\n`,{mode:0o755});
 writeFileSync(directory+'/curl',`#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},'UNEXPECTED_PAID_REQUEST_BOUNDARY\\n');process.exit(7);\n`,{mode:0o755});
 try{const env={PATH:directory+':'+process.env.PATH,NODE_ENV:'test',TOAPIS_API_KEY:'fixture-only',DB_URL:'postgres://fixture.invalid/disposable',API_BASE:options.api??'http://127.0.0.1:1234',...(options.confirm===false?{}:{LOCATOR_ASSIST_PAID_OPERATOR_CONFIRM:'I_ACCEPT_PAID_MODEL_CALLS'})};const result=spawnSync('bash',[script],{env,encoding:'utf8',timeout:5000});return{...result,log:readFileSync(log,'utf8')};}finally{rmSync(directory,{recursive:true,force:true});}
}
test('paid operator probe has no inherited activation and refuses production API or DB targets before request boundary',()=>{
 const unconfirmed=fixture({confirm:false});assert.equal(unconfirmed.status,1);assert.equal(unconfirmed.log,'');
 const remote=fixture({api:'https://production.example.test'});assert.notEqual(remote.status,0);assert.equal(remote.log,'');
 const shared=fixture({database:'zenithjoy'});assert.notEqual(shared.status,0);assert.doesNotMatch(shared.log,/UNEXPECTED_PAID_REQUEST_BOUNDARY|DELETE/);
});
test('mid-request failure cleans only exact owned row IDs and run UUID device marker',()=>{
 const result=fixture();assert.notEqual(result.status,0);const commands=result.log.split('\n').filter(line=>line.startsWith('[')).map(JSON.parse);const statements=commands.map(args=>args[args.indexOf('-c')+1]).filter(Boolean);
 const select=statements.find(sql=>sql.startsWith('SELECT id '));const marker=select?.match(/device_model='(LOCATOR-PROBE-[0-9a-f-]{36})'/)?.[1];assert.ok(marker);const deletion=statements.find(sql=>sql.startsWith('DELETE '));assert.equal(deletion,`DELETE FROM zenithjoy.rpa_locator_assist WHERE id='11111111-1111-4111-8111-111111111111' AND device_model='${marker}'`);assert.ok(!statements.some(sql=>sql.includes(' LIKE ')));
});
