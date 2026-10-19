/** 只在cecelia_scratch私有schema验证真实固定定义，禁止任何生产连接兜底。 */
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
export async function scratchRegistration({definition,owner,snapshot,skills},{brainRoot,repoRoot,output,evidenceRef}){
 if(process.env.DB_NAME!=='cecelia_scratch')throw Error('AUTHORING_SCRATCH_DATABASE_REQUIRED');
 const load=async path=>import(pathToFileURL(resolve(brainRoot,path)));
 const pg=createRequire(resolve(brainRoot,'packages/brain/package.json'))('pg');
 const {prepareDefinitionFreeze}=await load('packages/brain/src/workflow-authoring/freeze.js');
 const {registerWorkflow,registrationDigest}=await load('packages/brain/src/workflow-authoring/registration.js');
 const {fixedLocalSourceOptions}=await load('scripts/ci/fixed-local-git.mjs');
 const proof=await prepareDefinitionFreeze(definition,fixedLocalSourceOptions(repoRoot,'perfectuser21/zenithjoy-workspace'));
 const config={database:'cecelia_scratch',host:process.env.DB_HOST||'/tmp',port:Number(process.env.DB_PORT||5432),user:process.env.DB_USER||process.env.USER,password:process.env.DB_PASSWORD||'',max:2};
 const db=new pg.Pool(config),client=await db.connect(),schema=`source_${randomUUID().replaceAll('-','')}`;
 const tables=['areas','value_streams','capabilities','workflows','activities','steps','workflow_activity_refs','skill_registry','activity_definition_versions','workflow_definition_versions','warehouse_items','activity_uses','tasks','activity_versions','activity_version_builds','activity_release_state','activity_release_events','workflow_production_recipes'];
 try{
  if((await client.query('SELECT current_database() AS name')).rows[0].name!=='cecelia_scratch')throw Error('AUTHORING_SCRATCH_DATABASE_MISMATCH');
  await client.query('BEGIN');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET LOCAL search_path=${schema},public`);
  for(const table of tables)await client.query(`CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  const seed={areas:snapshot.canonical.areas,value_streams:snapshot.canonical.journeys.filter(x=>!x.parent_journey_id),capabilities:snapshot.canonical.journeys.filter(x=>x.parent_journey_id),
   workflows:snapshot.canonical.workflows,activities:snapshot.canonical.activities,steps:snapshot.canonical.steps,workflow_activity_refs:snapshot.canonical.references,
   skill_registry:skills,workflow_definition_versions:snapshot.definitions.workflows,activity_definition_versions:snapshot.definitions.activities};
  for(const [table,rows] of Object.entries(seed)){
   const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND is_generated='NEVER' AND is_identity='NO' ORDER BY ordinal_position",[schema,table])).rows.map(x=>x.column_name).filter(name=>rows.every(row=>Object.hasOwn(row,name)));
   // 列名只来自受信scratch PostgreSQL schema，表名为上面的固定集合。
   const fields=columns.map(x=>'"'+x.replaceAll('"','""')+'"').join(',');
   if(rows.length)await client.query(`INSERT INTO ${schema}.${table}(${fields}) SELECT ${fields} FROM jsonb_populate_recordset(NULL::${schema}.${table},$1::jsonb)`,[JSON.stringify(rows)]);
  }
  const receipt=await registerWorkflow(client,definition,{operation:'update',workflowId:owner.id,expectedVersion:owner.version,definitionSha256:registrationDigest(definition),registrationProtocol:'definition-freeze-v1',freezeProof:proof,taskId:randomUUID()});
  const actual=(await client.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[receipt.current_definition_version_id])).rows[0];
  if(!receipt.readback_verified||actual?.source_commit!==definition.source.revision||actual.payload.contract.key!==definition.key
   ||actual.payload.activities.length!==definition.activities.length)throw Error('AUTHORING_SCRATCH_READBACK_FAILED');
  const {writeFileSync}=await import('node:fs');
  const result={schema_version:1,validation_scope:'fixed_git_freeze_scratch_registration',business_runtime_status:'not_evaluated',definition_sha256:registrationDigest(definition),source:definition.source,receipt,registered_definition:actual};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  return {definition_sha256:result.definition_sha256,evidence_refs:[evidenceRef]};
 }finally{await client.query('ROLLBACK');client.release();await db.end();}
}
