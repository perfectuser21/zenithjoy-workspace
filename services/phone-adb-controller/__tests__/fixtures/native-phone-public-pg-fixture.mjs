import {nativePhoneTestPgMetadata} from '../helpers/native-phone-test-python.mjs';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Only this fixture's new schema is written. Never connect to production 15532.
export async function nativePhonePublicPgFixture(t,{Pool,profile,serial,run}){
 const path=nativePhoneTestPgMetadata();
 const metadata=JSON.parse(readFileSync(path));assert.equal(metadata.host,'127.0.0.1');assert.equal(metadata.database,'cecelia_scratch');assert.equal(metadata.task_id,'7d85f6ba-873b-40fc-993f-932d24d61e5a');assert.notEqual(metadata.port,15532);assert.ok(Number.isInteger(metadata.port));
 const options={host:metadata.host,port:metadata.port,user:metadata.user,database:metadata.database,max:2},admin=new Pool(options);
 const identity=(await admin.query("SELECT current_database() AS database,current_user AS role,current_setting('data_directory') AS directory,system_identifier::text FROM pg_control_system()")).rows[0];
 assert.equal(identity.database,'cecelia_scratch');assert.equal(identity.role,'postgres');assert.equal(realpathSync(identity.directory),realpathSync(metadata.data));
 const schema='phone101_public_'+randomUUID().replaceAll('-',''),sql=text=>text.replaceAll('zenithjoy.',schema+'.');await admin.query('CREATE SCHEMA '+schema);
 t.after(async()=>{await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();});
 const migration=readFileSync(new URL('../../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
 await admin.query(sql(migration.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0]));
 await admin.query(sql(readFileSync(new URL('../../../../apps/api/db/migrations/20261022_120000_discovery_metrics.sql',import.meta.url),'utf8')));
 await admin.query(`ALTER TABLE ${schema}.leadgen_videos ADD COLUMN judgment_config jsonb`);
 await admin.query(`CREATE TABLE ${schema}.tenant_company_profiles(company_id uuid PRIMARY KEY,tenant_id uuid,config_version integer,config_status text,runtime_config jsonb);
 CREATE TABLE ${schema}.company_config_versions(company_id uuid,tenant_id uuid,version integer,snapshot jsonb);
 CREATE TABLE ${schema}.company_config_runs(company_id uuid,tenant_id uuid,version integer,run_id text,snapshot jsonb,task_inputs jsonb,source_run text,PRIMARY KEY(company_id,run_id));`);
 const company={company_id:randomUUID(),tenant_id:randomUUID(),version:1,config_status:'enabled',company_key:'yuesheng',company_name:'悦升隔离fixture',wiki:{products:[{id:'fixture-product'}],audiences:[{id:'fixture-audience'}]},runtime_config:{policy_id:'original-101-fixture-policy',routing:{line_key:'yuesheng',profiles:[profile]},search_strategy:{keywords:['人工智能']},platform_accounts:[]}};
 company.runtime_config.platform_accounts.push({company_id:company.company_id,tenant_id:company.tenant_id,platform:'douyin',profile,device_serial:serial,douyin_id:'actual',verification_status:'verified',enabled:true});
 await admin.query(`INSERT INTO ${schema}.tenant_company_profiles VALUES($1,$2,1,'enabled',$3)`,[company.company_id,company.tenant_id,company.runtime_config]);
 await admin.query(`INSERT INTO ${schema}.company_config_versions VALUES($1,$2,1,$3)`,[company.company_id,company.tenant_id,company]);
 const calls=[],allocations=new Set();let commitCount=0;
 const createPool=async()=>{
  const actual=new Pool({...options,max:1});allocations.add(actual);let closing;
  const close=()=>closing??=(async()=>{await actual.end();allocations.delete(actual);return {execution_stopped:actual.ended};})();
  const query=async(client,text,args)=>{calls.push(text);const value=await client.query(sql(text),args);if(text==='COMMIT')commitCount++;return value;};
  return {expectedIdentity:{database:identity.database,role:identity.role,system_identifier:identity.system_identifier},pool:{on:(...args)=>actual.on(...args),query:(text,args)=>query(actual,text,args),async connect(){const client=await actual.connect();return {connection:client.connection,release:(...args)=>client.release(...args),query:(text,args)=>query(client,text,args)};},end:close},transport:{close,seal:close}};
 };
 t.after(()=>Promise.allSettled([...allocations].map(pool=>pool.end())));
 return {company,createPool,calls,expectedIdentity:{database:identity.database,role:identity.role,system_identifier:identity.system_identifier},readRows:async()=>({videos:(await admin.query(`SELECT * FROM ${schema}.leadgen_videos`)).rows,configs:(await admin.query(`SELECT * FROM ${schema}.company_config_runs WHERE run_id=$1`,[run])).rows}),mutateMetrics:async()=>admin.query(`UPDATE ${schema}.leadgen_videos SET discovery_metrics='{}'`),commitCount:()=>commitCount,livePools:()=>allocations.size};
}
