import { isDeepStrictEqual } from 'node:util';
const encode=encodeURIComponent;
const rich=value=>{if(value.length>190000)throw Error('projection content exceeds rich_text capacity');return Array.from({length:Math.ceil(value.length/1900)},(_,i)=>({type:'text',text:{content:value.slice(i*1900,(i+1)*1900)}}));};
const text=value=>typeof value==='string'?value:(value||[]).map(t=>t.plain_text??t.text?.content??t.text??'').join('');
export function projectionMappingGaps(platform,mapping){
  const required=platform==='feishu'?['company_id','tenant_id','base','table','record','field']:(mapping?.storage==='blocks'?['company_id','tenant_id','page']:['company_id','tenant_id','page','metadata_property','content_property']);
  return [...required.filter(key=>!mapping?.[key]),...(mapping?.purpose==='company_config_projection'?[]:['purpose:company_config_projection'])];
}
export function createProjectionAdapter({platform,env=process.env,fetcher=fetch,db,snapshot,mapping:registeredMapping}){
  if(!['feishu','notion'].includes(platform))throw Error('unsupported projection platform');
  const token=platform==='feishu'?env.FEISHU_TENANT_ACCESS_TOKEN:env.NOTION_INTEGRATION_TOKEN;
  const base=platform==='feishu'?'https://open.feishu.cn/open-apis':'https://api.notion.com/v1';
  async function request(method,path,body){
    if(!token)throw Error(`${platform} token missing`);
    let response;try{response=await fetcher(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(platform==='notion'?{'Notion-Version':'2022-06-28'}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{throw Error(`${platform} ${method} request failed`);}
    if(!response.ok)throw Error(`${platform} ${method} HTTP ${response.status}`);
    const result=await response.json();if(platform==='feishu'&&result.code!==0)throw Error(`feishu business code ${result.code}`);return result;
  }
  function path(mapping){
    if(projectionMappingGaps(platform,mapping).length)throw Error('dedicated projection mapping incomplete');
    if(mapping.company_id!==snapshot.company_id||mapping.tenant_id!==snapshot.tenant_id)throw Error('projection identity mismatch');
    const companyBase=snapshot.runtime_config?.routing?.feishu_base||snapshot.source_evidence?.base;
    if(platform==='feishu'&&(!companyBase||mapping.base!==companyBase))throw Error('projection feishu base identity mismatch');
    if(registeredMapping && ['purpose','company_id','tenant_id','base','table','record','field','page','storage','metadata_property','content_property'].some(key=>mapping[key]!==registeredMapping[key]))throw Error('projection target differs from registered mapping');
    return platform==='feishu'?`/bitable/v1/apps/${encode(mapping.base)}/tables/${encode(mapping.table)}/records/${encode(mapping.record)}`:`/pages/${encode(mapping.page)}`;
  }
  let lastReadback=null;
  const marker=`company-config:v1:${snapshot.company_id}:`;
  const marked=block=>block.type==='code'&&text(block.code?.caption).startsWith(marker);
  async function children(mapping){
    path(mapping);const results=[];let cursor;let pages=0;const seenCursors=new Set();
    do{if(++pages>100)throw Error('Notion pagination limit exceeded');const page=await request('GET',`/blocks/${encode(mapping.page)}/children?page_size=100${cursor?'&start_cursor='+encode(cursor):''}`);results.push(...(page.results||[]));cursor=page.has_more?page.next_cursor:null;if(results.length>10000||cursor&&seenCursors.has(cursor))throw Error('Notion pagination cursor cycle/limit');if(cursor)seenCursors.add(cursor);if(page.has_more&&!cursor)throw Error('Notion pagination cursor missing');}while(cursor);
    return results;
  }
  async function readBlocks(mapping){
    const blocks=(await children(mapping)).filter(marked);
    if(!blocks.length)return null;
    const slices=blocks.map(b=>{const suffix=text(b.code.caption).slice(marker.length).split(':');return {index:Number(suffix[0]),total:Number(suffix[1]),value:text(b.code.rich_text)};}).sort((a,b)=>a.index-b.index);
    if(slices.length>100||slices.some((s,i)=>!Number.isInteger(s.index)||!Number.isInteger(s.total)||s.index!==i||s.total!==slices.length))throw Error('Notion projection chunks incomplete');
    const raw=slices.map(s=>s.value).join('');let value;try{value=JSON.parse(raw);}catch{throw Error('Notion projection JSON invalid');}
    if(value.company_id!==snapshot.company_id||value.tenant_id!==snapshot.tenant_id)throw Error('projection content identity mismatch');return value;
  }
  async function read(mapping){
    if(platform==='notion'&&mapping.storage==='blocks')return readBlocks(mapping);
    const response=await request('GET',path(mapping));
    const raw=platform==='feishu'?text(response.data?.record?.fields?.[mapping.field]):text(response.properties?.[mapping.content_property]?.rich_text);
    if(!raw)return null;
    let value;try{value=JSON.parse(raw);}catch{throw Error('projection JSON invalid');}
    if(platform==='notion'){
      let metadata;try{metadata=JSON.parse(text(response.properties?.[mapping.metadata_property]?.rich_text));}catch{throw Error('projection metadata invalid');}
      if(metadata.company_id!==value.company_id||metadata.tenant_id!==value.tenant_id||metadata.config_version!==value.config_version)throw Error('projection metadata/content mismatch');
    }
    if(value.company_id!==snapshot.company_id||value.tenant_id!==snapshot.tenant_id)throw Error('projection content identity mismatch');return value;
  }
  return {
    read,readback:async mapping=>{lastReadback=await read(mapping);return lastReadback;},
    async readBase(version){
      if(!db?.query)throw Error('PG history connection required');
      return (await db.query('SELECT snapshot FROM zenithjoy.company_config_versions WHERE company_id=$1 AND tenant_id=$2 AND version=$3',[snapshot.company_id,snapshot.tenant_id,version])).rows[0]?.snapshot??null;
    },
    async write(mapping,value,{expected_version,expected_snapshot}){
      // Platforms have no transactional revision CAS. Recheck immediately before
      // write and read independently afterward; PG history retains races.
      if(expected_snapshot!==undefined || expected_version!==null&&expected_version!==undefined){
        const current=await read(mapping);
        if(expected_snapshot!==undefined&&!isDeepStrictEqual(current,expected_snapshot) || expected_version!==null&&expected_version!==undefined&&current?.config_version!==expected_version){const error=Error('projection changed before write');error.latest_snapshot=current;error.projection_conflict=true;throw error;}
      }
      const raw=JSON.stringify(value);if(raw.length>190000)throw Error('projection content capacity exceeded');
      if(platform==='notion'&&mapping.storage==='blocks'){
        const old=(await children(mapping)).filter(marked);
        const chunks=rich(raw);
        if(chunks.length>100)throw Error('Notion projection block limit exceeded');
        for(const block of old)await request('PATCH',`/blocks/${encode(block.id)}`,{archived:true});
        return request('PATCH',`/blocks/${encode(mapping.page)}/children`,{children:chunks.map((chunk,index)=>({object:'block',type:'code',code:{language:'json',caption:[{type:'text',text:{content:`${marker}${index}:${chunks.length}`}}],rich_text:[chunk]}}))});
      }
      return request(platform==='feishu'?'PUT':'PATCH',path(mapping),platform==='feishu'?{fields:{[mapping.field]:raw}}:{properties:{[mapping.metadata_property]:{rich_text:rich(JSON.stringify({company_id:value.company_id,tenant_id:value.tenant_id,config_version:value.config_version}))},[mapping.content_property]:{rich_text:rich(raw)}}});
    },
    async record(evidence){
      if(!db?.query)throw Error('PG history connection required');
      path(registeredMapping);
      await db.query('BEGIN');
      try{
        const live=(await db.query('SELECT p.config_version,v.snapshot FROM zenithjoy.tenant_company_profiles p JOIN zenithjoy.company_config_versions v ON v.company_id=p.company_id AND v.version=p.config_version AND v.tenant_id=p.tenant_id WHERE p.company_id=$1 AND p.tenant_id=$2 FOR SHARE OF p',[snapshot.company_id,snapshot.tenant_id])).rows[0];
        if(!live||live.config_version!==snapshot.config_version||!isDeepStrictEqual(live.snapshot,snapshot))throw Error('PG snapshot authentication failed');
        const verified=evidence.status==='consistent'&&lastReadback!==null&&isDeepStrictEqual(lastReadback,snapshot)&&isDeepStrictEqual(evidence.readback,lastReadback);
        const status=verified?'verified':evidence.status==='consistent'?'mismatch':evidence.status;
        await db.query('INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot,conflict) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)',[snapshot.company_id,snapshot.config_version,env.COMPANY_SYNC_ACTOR||'company-projection-sync',`${platform}-projection`,JSON.stringify(evidence.old_snapshot??null),JSON.stringify(evidence.new_snapshot??snapshot),JSON.stringify({...evidence,status})]);
        await db.query('INSERT INTO zenithjoy.company_config_projections(company_id,platform,tenant_id,mapping,status,verified_version,readback_evidence,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,NOW()) ON CONFLICT(company_id,platform) DO UPDATE SET mapping=EXCLUDED.mapping,status=EXCLUDED.status,verified_version=EXCLUDED.verified_version,readback_evidence=EXCLUDED.readback_evidence,updated_at=NOW() WHERE company_config_projections.tenant_id=EXCLUDED.tenant_id',[snapshot.company_id,platform,snapshot.tenant_id,JSON.stringify(registeredMapping),status,verified?snapshot.config_version:null,JSON.stringify({request_id:evidence.request_id,readback:lastReadback,checked_at:new Date().toISOString(),independent_readback:verified})]);
        await db.query('COMMIT');
      }catch(error){await db.query('ROLLBACK');throw error;}

    },
  };
}
export async function pullProjection({adapter,mapping,api,expectedVersion,humanWins=false}){
  const incoming=await adapter.readback(mapping),current=await api.get();
  if(!incoming||incoming.company_id!==current.company_id||incoming.tenant_id!==current.tenant_id)throw Error('projection pull identity missing/mismatch');
  if(!Number.isInteger(expectedVersion))throw Error('expected_version required');
  if(!incoming.config_owner)throw Error('projection edit owner required');
  const editable=['company_name','city','industry','description','customer_problem','customer_portrait','products','key_advantages','qa_list','wiki','runtime_config','config_owner','source_evidence'];
  const body={expected_version:expectedVersion,config_status:'draft'};
  for(const key of editable)body[key]=Object.prototype.hasOwnProperty.call(incoming,key)?incoming[key]:current[key];
  body.runtime_config={...body.runtime_config,sync_mappings:current.runtime_config.sync_mappings};
  if(editable.every(key=>isDeepStrictEqual(body[key],current[key])))return {status:'consistent',config_version:current.config_version};
  try{return {status:'updated',result:await api.put(body)};}catch(error){
    if(error.status!==409||!humanWins)throw error;
    // First failed CAS is recorded by the same API in PG, including displaced
    // current/incoming values. An explicit owner choice may then win a fresh CAS.
    const latest=await api.get();if(latest.company_id!==incoming.company_id||latest.tenant_id!==incoming.tenant_id)throw Error('projection pull identity changed');
    return {status:'human_wins',result:await api.put({...body,expected_version:latest.config_version,runtime_config:{...incoming.runtime_config,sync_mappings:latest.runtime_config.sync_mappings}})};
  }
}
