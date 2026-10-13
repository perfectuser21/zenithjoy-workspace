import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import lineRoutes from '../../../services/phone-adb-controller/line-routes.js';
const identities = [
  { key:'jinoshengyuan', evidence:'jinuo', line:'AI人工智能训练师', label:'金诺盛源', profile:'tblAO4XKqzphBt8f', products:'tblvMcnwXhGoT4Ub', audiences:'tblQ0kWrURJNGhre', keywords:'tbleP4LgzkcwAhiZ', accounts:'tblzgMSK4KfgdE0r', scripts:'tblZZWdv0YUNojqI' },
  { key:'yueshengyun', evidence:'yuesheng', line:'悦升云端', label:'悦升云端', profile:'tblzWqEF6EJ5TKwh', products:'tbls6zMgujU2sY3Y', audiences:'tbl7qoxG4m8Z30zw', keywords:'tblyKCp5vc7y2S40', accounts:'tblg8QCFIIGkCVen', scripts:'tblvf3t8ZWkOCpe1' },
];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function buildSeeds(evidence, docs, mapping) {
  const seenTenants=new Set(),seenCompanies=new Set();
  return identities.map(identity=>{
    if(lineRoutes.routeOf(identity.evidence).line!==identity.line)throw Error('business line route mismatch');
    const binding=mapping[identity.key];
    if(!binding || !uuid.test(binding.tenant_id) || !uuid.test(binding.company_id) || !binding.verification_source || !binding.owner) throw Error(`verified mapping missing: ${identity.key}`);
    const targets={production:'zenithjoy',staging:'zenithjoy_staging',scratch:'cecelia_scratch'};
    if((binding.environment!==undefined||binding.database!==undefined)&&(!Object.prototype.hasOwnProperty.call(targets,binding.environment)||binding.database!==targets[binding.environment]))throw Error('mapping environment target database missing/mismatch');
    if(binding.company_id===binding.tenant_id) throw Error('company_id must be independently assigned');
    if(seenTenants.has(binding.tenant_id)||seenCompanies.has(binding.company_id))throw Error('duplicate company/tenant mapping');
    seenTenants.add(binding.tenant_id);seenCompanies.add(binding.company_id);
    const company=evidence.companies[identity.evidence];if(!company)throw Error(`evidence missing: ${identity.key}`);
    const rows=(id)=>{
      const table=company.tables.find(t=>t.table_id===id);
      if(!table)return [];
      if(!table.config || !table.all_config_rows_read)throw Error(`incomplete configuration evidence: ${id}`);
      return (table.rows||[]).map(row=>({id:row.record_id||row.id,source:{platform:'feishu',base:company.base,table:id,record:row.record_id||row.id,read_at:evidence.read_at},fields:row.fields}));
    };
    const basic=rows(identity.profile);if(basic.length!==1 || basic[0].fields.tenant_id!==identity.key)throw Error(`source tenant mismatch: ${identity.key}`);
    const products=rows(identity.products).map(r=>({...r,name:r.fields['产品名称']})),audiences=rows(identity.audiences).map(r=>({...r,name:r.fields['画像名称']}));
    const raw=identity.key==='yueshengyun'?rows('tbld5yyRTXPU8L5m'):[];
    const markdown=identity.key==='yueshengyun'?(docs[0]?.content||''):Object.entries(basic[0].fields).map(([k,v])=>`**${k}**：${typeof v==='string'?v:JSON.stringify(v)}`).join('\n\n');
    const goals=(evidence.companies.jinuo?.tables.find(t=>t.table_id==='tblpwc9GF9mIhdAG')?.rows||[]).filter(r=>r.fields.业务线===identity.line).map(r=>({id:r.record_id||r.id,fields:r.fields,source:{platform:'feishu',base:evidence.companies.jinuo.base,table:'tblpwc9GF9mIhdAG',record:r.record_id||r.id,read_at:evidence.read_at}}));
    const keywords=rows(identity.keywords).map(r=>({...r,word:r.fields['抖音获客-关键词配置']||'',source_record_id:r.id,source_status:r.fields['是否启用'],enabled:['是','启用'].includes(r.fields['是否启用'])}));
    const conflicts=raw.length?[{type:'business_positioning_and_unverified_claims',status:'pending_owner_review',reason:'原始后台与负责人主档案口径不同；100+、10倍等声明未独立核实',sources:[...raw.map(r=>r.source),{platform:'feishu_docx',doc:docs[0]?.doc,read_at:evidence.read_at}]}]:[];
    return {
      company_id:binding.company_id,tenant_id:binding.tenant_id,company_key:identity.key,company_name:basic[0].fields['企业名称']||identity.label,version:1,product_ids:products.map(p=>p.id),policy_id:`${identity.key}-draft-v1`,
      config_version:1,config_status:'draft',config_owner:binding.owner,
      city:String(basic[0].fields['经营地区']||'').includes('西安')?'西安':'',industry:basic[0].fields['所属行业']||'',description:basic[0].fields['主营业务']||'',products:products.map(p=>p.name).filter(Boolean),key_advantages:basic[0].fields['能带来的价值']?[basic[0].fields['能带来的价值']]:[],customer_problem:audiences.map(a=>a.fields['核心痛点']).filter(Boolean).join('\n'),customer_portrait:audiences.map(a=>Object.entries(a.fields).map(([key,value])=>`${key}：${typeof value==='string'?value:JSON.stringify(value)}`).join('；')).join('\n\n'),qa_list:[],
      wiki:{markdown,basic:basic[0],products,audiences,brand_expression:basic[0].fields['品牌语气'],business_boundaries:basic[0].fields['交付边界']||basic[0].fields['排除词'],source_documents:identity.key==='yueshengyun'?docs:[],raw_intake:raw,conflicts,verification_status:'source_preserved_pending_owner_review',disclaimer:'初稿和未核实声明保留原文；不代表独立核验事实'},
      runtime_config:{routing:{line_key:identity.evidence,profiles:rows(identity.accounts).map(r=>r.fields['手机Profile']).filter(Boolean),feishu_base:company.base,status:'unverified'},language:'zh-CN',timezone:'Asia/Shanghai',search_strategy:{keywords},product_ids:products.map(p=>p.id),video_judgment:{status:'draft',audiences,products,instructions:'这段内容是否匹配目标客户画像,评论区/内容本身是否可能吸引到潜在客户',source:'现已运行judge-jev规则'},comment_scoring:{status:'draft',audiences,confidence_threshold:0.6,criteria:{A:'主动问价/问报名/求资料/明确求助(高意向)',B:'表达兴趣/相关讨论但没有明确行动意图(中意向)',C:'纯寒暄/表情互动,但确实是画像内人群(低意向,不是垃圾,不要丢)',不相关:'同行企业号/广告引流号/完全跑题'},source:'现已运行judge-comment规则'},platform_accounts:rows(identity.accounts).map(r=>({...r,verification_status:'unverified',enabled:false})),contact_rules:{status:'unverified',ssot:'feishu',approved_scripts_table:identity.scripts},crm:{status:'unmapped',ssot:'feishu'},business_goals:goals,policy_id:`${identity.key}-draft-v1`,sync_mappings:{feishu:{status:'source_retained',base:company.base,source_tables:company.tables.filter(t=>t.config).map(t=>t.table_id)},notion:{status:'unmapped'}},legacy_moments:{enabled:false,records:identity.key==='yueshengyun'?rows('tblblCysRwrB9BHF'):[]},ssot_boundary:{company_profile:'postgresql',keywords:'postgresql_after_enabled',orders:'feishu',approved_scripts:'feishu',sent_facts:'feishu'}},
      source_evidence:{deployment_environment:binding.environment||'unspecified',target_database:binding.database||null,read_at:evidence.read_at,base:company.base,identity_verification:binding.verification_source,source_company_key:identity.key,configuration_tables:company.tables.filter(t=>t.config).map(t=>({table_id:t.table_id,name:t.name,total:t.total})),migration_status:'seed_draft_not_enabled'},
    };
  });
}
export async function persistSeeds(db,seeds) {
  const results=[];
  await db.query('BEGIN');
  try{
    const databases=[...new Set(seeds.map(seed=>seed.source_evidence?.target_database).filter(Boolean))];
    if(databases.length){const actual=(await db.query('SELECT current_database() AS name')).rows[0]?.name;if(databases.length!==1||actual!==databases[0])throw Error('company mapping environment target database mismatch');}
    for(const seed of seeds){
      const existing=await db.query('SELECT company_id,company_key,tenant_id FROM zenithjoy.tenant_company_profiles WHERE tenant_id=$1 OR company_id=$2 OR company_key=$3 FOR UPDATE',[seed.tenant_id,seed.company_id,seed.company_key]);
      if(existing.rows.length){
        const row=existing.rows[0];
        if(row.tenant_id && (row.tenant_id!==seed.tenant_id || row.company_id && row.company_id!==seed.company_id || row.company_key && row.company_key!==seed.company_key))throw Error('existing company identity conflict');
        if(!row.company_id || !row.company_key)throw Error('existing legacy profile requires reviewed migration; refusing overwrite');
        results.push({company_key:seed.company_key,status:'existing'});continue;
      }
      const fields=['tenant_id','company_id','company_key','company_name','city','industry','description','products','key_advantages','customer_problem','customer_portrait','qa_list','wiki','runtime_config','config_version','config_status','config_owner','source_evidence'];
      const jsonFields=new Set(['products','key_advantages','qa_list','wiki','runtime_config','source_evidence']);
      await db.query(`INSERT INTO zenithjoy.tenant_company_profiles (${fields.join(',')}) VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')})`,fields.map(field=>jsonFields.has(field)?JSON.stringify(seed[field]):seed[field]));
      await db.query('INSERT INTO zenithjoy.company_config_versions (company_id,version,tenant_id,snapshot,actor) VALUES ($1,1,$2,$3,$4)',[seed.company_id,seed.tenant_id,JSON.stringify(seed),seed.config_owner]);
      await db.query('INSERT INTO zenithjoy.company_config_changes (company_id,version,actor,source,old_snapshot,new_snapshot) VALUES ($1,1,$2,$3,$4,$5)',[seed.company_id,seed.config_owner,'feishu-evidence-seed',JSON.stringify({}),JSON.stringify(seed)]);
      results.push({company_key:seed.company_key,status:'inserted'});
    }
    await db.query('COMMIT');return results;
  }catch(error){await db.query('ROLLBACK');throw error;}
}
async function main(){
  const args=process.argv.slice(2),value=flag=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
  if(!args.includes('--mapping'))throw Error('--mapping verified mapping JSON required');
  const files=[value('--evidence')||'/tmp/codex-company-feishu-evidence-20261013.json',value('--docs')||'/tmp/codex-yuesheng-company-docs-20261013.json',value('--mapping')];
  const [evidence,docs,mapping]=await Promise.all(files.map(async p=>JSON.parse(await readFile(p,'utf8'))));
  if(Object.values(mapping).some(binding=>!binding.environment||!binding.database))throw Error('formal import mapping environment/database required');
  const seeds=buildSeeds(evidence,docs,mapping);
  console.log(JSON.stringify({mode:'dry-run',companies:seeds.map(s=>({company_id:s.company_id,company_key:s.company_key,status:s.config_status,products:s.wiki.products.length,audiences:s.wiki.audiences.length,keywords:s.runtime_config.search_strategy.keywords.length,enabled_keywords:s.runtime_config.search_strategy.keywords.filter(k=>k.enabled).length,conflicts:s.wiki.conflicts.length,notion:'unmapped',feishu:'unmapped'}))},null,2));
  if(!args.includes('--execute'))return;
  if(!process.env.COMPANY_IMPORT_DATABASE_URL)throw Error('COMPANY_IMPORT_DATABASE_URL required');
  const {default:pg}=await import('pg');const client=new pg.Client({connectionString:process.env.COMPANY_IMPORT_DATABASE_URL});
  await client.connect();try{console.log(JSON.stringify(await persistSeeds(client,seeds)));}finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
