import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sync from '../../../services/phone-adb-controller/company-config-sync-lib.js';
import { createProjectionAdapter, projectionMappingGaps, pullProjection } from './company-projection-adapters.mjs';
export async function createCompanyApi({env=process.env,fetcher=fetch}={}){
  const base=env.COMPANY_PROFILE_API_URL;
  if(!base||!env.COMPANY_SYNC_COOKIE)throw Error('authenticated COMPANY_PROFILE_API_URL and COMPANY_SYNC_COOKIE required');
  async function request(method,body){
    const r=await fetcher(base,{method,headers:{Cookie:env.COMPANY_SYNC_COOKIE,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const value=await r.json();if(!r.ok){const error=Error(`company-profile API ${r.status} ${value.error?.code||''}`);error.status=r.status;throw error;}return value.data;
  }
  return {get:()=>request('GET'),put:body=>request('PUT',body)};
}
async function main(){
  const args=process.argv.slice(2),arg=key=>args.includes(key)?args[args.indexOf(key)+1]:undefined;
  const platform=arg('--platform');if(!['feishu','notion'].includes(platform))throw Error('--platform feishu|notion required');
  if(!arg('--mapping')||!arg('--snapshot'))throw Error('--mapping and --snapshot required');
  const [mapping,snapshot]=await Promise.all([arg('--mapping'),arg('--snapshot')].map(async path=>JSON.parse(await readFile(path,'utf8'))));
  const gaps=projectionMappingGaps(platform,mapping);
  console.log(JSON.stringify({mode:'dry-run',platform,company_id:snapshot.company_id,config_version:snapshot.config_version,gaps,status:gaps.length?'unmapped':'ready_for_readback',direction:arg('--direction')||'push'}));
  if(!args.includes('--execute'))return;
  if(gaps.length)throw Error('projection mapping incomplete');
  if(!process.env.COMPANY_SYNC_DATABASE_URL)throw Error('COMPANY_SYNC_DATABASE_URL required for PG history');
  const {default:pg}=await import('pg');const db=new pg.Client({connectionString:process.env.COMPANY_SYNC_DATABASE_URL});await db.connect();
  try{
    const live=(await db.query('SELECT tenant_id,config_version FROM zenithjoy.tenant_company_profiles WHERE company_id=$1',[snapshot.company_id])).rows[0];
    if(!live||live.tenant_id!==snapshot.tenant_id)throw Error('PG company identity mismatch');
    if((arg('--direction')||'push')==='push'){
      if(live.config_version!==snapshot.config_version)throw Error('PG snapshot stale');
      const stored=(await db.query('SELECT snapshot FROM zenithjoy.company_config_versions WHERE company_id=$1 AND version=$2 AND tenant_id=$3',[snapshot.company_id,snapshot.config_version,snapshot.tenant_id])).rows[0];
      if(!stored||!isDeepStrictEqual(stored.snapshot,snapshot))throw Error('snapshot must match immutable PG version');
    }
    const adapter=createProjectionAdapter({platform,db,snapshot,mapping});
    if(arg('--direction')==='pull'){
      const api=await createCompanyApi();
      console.log(JSON.stringify(await pullProjection({adapter,mapping,api,expectedVersion:Number(arg('--expected-version')),humanWins:args.includes('--human-wins')})));
    }else{
      const result=await sync.synchronizeProjection({snapshot,platform,mapping:{...mapping,target:platform==='feishu'?`${mapping.base}/${mapping.table}/${mapping.record}`:mapping.page},adapter});
      console.log(JSON.stringify({status:result.status,request_id:result.request_id}));
      if(result.status!=='consistent')process.exitCode=2;
    }
  }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
