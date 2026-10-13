// 部署端只读检查；不会迁移数据库、修改配置或安装控制器。
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import config from './company-config-lib.js';
const required={
 tenant_company_profiles:{company_id:'uuid',tenant_id:'uuid',company_key:'text',wiki:'jsonb',runtime_config:'jsonb',config_status:'text',config_version:'integer',source_evidence:'jsonb'},
 company_config_versions:{company_id:'uuid',tenant_id:'uuid',version:'integer',snapshot:'jsonb'},
 company_config_runs:{company_id:'uuid',tenant_id:'uuid',run_id:'text',version:'integer',snapshot:'jsonb',task_inputs:'jsonb',source_run:'text'},
 leadgen_videos:{judgment_config:'jsonb'},leadgen_comments:{judgment_config:'jsonb'},
};
export function evaluateCompanyReadiness(inventory,{requireEnabled=[]}={}) {
 const schemaGaps=[];
 for(const [table,columns] of Object.entries(required))for(const [column,type]of Object.entries(columns)) {
  if(!inventory.columns?.some(r=>r.table_name===table&&r.column_name===column&&r.data_type===type))schemaGaps.push(`${table}.${column}:${type}`);
 }
 if(!inventory.indexes?.some(r=>r.tablename==='company_config_runs'&&/UNIQUE/.test(r.indexdef)&&/\(company_id, run_id\)/.test(r.indexdef)))schemaGaps.push('company_config_runs.unique(company_id,run_id)');
 for(const name of ['immutable_company_run','immutable_company_version'])if(!inventory.triggers?.some(r=>r.tgname===name&&r.tgenabled==='O'))schemaGaps.push(name);
 if(schemaGaps.length)throw Error('COMPANY_SCHEMA_NOT_READY: '+schemaGaps.join(', '));
 const gaps=[],workflows=[];
 for(const line of ['jinuo','yuesheng'])for(const step of ['101','102','103','104']) {
  const rows=(inventory.profiles||[]).filter(r=>r.line_key===line);
  let reason=null;
  if(rows.length!==1)reason='COMPANY_MAPPING_MISSING';
  else if(rows[0].config_status!=='enabled'||rows[0].snapshot?.config_status!=='enabled')reason='COMPANY_CONFIG_NOT_ENABLED';
  else if(rows[0].snapshot?.company_id!==rows[0].company_id||rows[0].snapshot?.tenant_id!==rows[0].tenant_id||rows[0].snapshot?.version!==rows[0].config_version)reason='COMPANY_VERSION_MISMATCH';
  else try{config.runtimeSnapshot(rows[0].snapshot,step);}catch(error){reason=error.message;}
  workflows.push({line,step,enabled:!reason});
  if(reason)gaps.push({line,step,code:reason});
 }
 for(const line of requireEnabled)if(!['jinuo','yuesheng'].includes(line))throw Error('COMPANY_REQUIRED_LINE_INVALID');
 if(gaps.some(g=>requireEnabled.includes(g.line)))throw Error('COMPANY_BUSINESS_NOT_READY: '+JSON.stringify(gaps.filter(g=>requireEnabled.includes(g.line))));
 return {schema_verified:true,business_runtime_status:gaps.length?'disabled':'ready',workflows,gaps};
}
export async function inspectCompanyReadiness(pool,options={}) {
 const columns=(await pool.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name=ANY($1::text[])",[Object.keys(required)])).rows;
 const indexes=(await pool.query("SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='zenithjoy' AND tablename='company_config_runs'")).rows;
 const triggers=(await pool.query("SELECT tgname,tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='zenithjoy' AND tgname IN ('immutable_company_run','immutable_company_version')")).rows;
 // 缺列时不继续运行依赖新列的SQL；错误在本地明确列出迁移缺口。
 evaluateCompanyReadiness({columns,indexes,triggers,profiles:[]});
 const profiles=(await pool.query(`SELECT p.company_id,p.tenant_id,p.config_status,p.config_version,p.runtime_config->'routing'->>'line_key' AS line_key,v.snapshot
 FROM zenithjoy.tenant_company_profiles p LEFT JOIN zenithjoy.company_config_versions v ON v.company_id=p.company_id AND v.tenant_id=p.tenant_id AND v.version=p.config_version
 WHERE p.runtime_config->'routing'->>'line_key' IN ('jinuo','yuesheng')`)).rows;
 return evaluateCompanyReadiness({columns,indexes,triggers,profiles},options);
}
export function remoteCompanyInventory({execute}={}) {
 const script=`const pool=require('./leadgen-db-connect.js').getPool();(async()=>{try{const columns=(await pool.query(${JSON.stringify("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='zenithjoy'")})).rows;const indexes=(await pool.query(${JSON.stringify("SELECT tablename,indexdef FROM pg_indexes WHERE schemaname='zenithjoy' AND tablename='company_config_runs'")})).rows;const triggers=(await pool.query(${JSON.stringify("SELECT tgname,tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='zenithjoy' AND tgname IN ('immutable_company_run','immutable_company_version')")})).rows;let profiles=[];if(columns.some(r=>r.table_name==='tenant_company_profiles'&&r.column_name==='runtime_config')&&columns.some(r=>r.table_name==='company_config_versions'&&r.column_name==='snapshot'))profiles=(await pool.query(${JSON.stringify("SELECT p.company_id,p.tenant_id,p.config_status,p.config_version,p.runtime_config->'routing'->>'line_key' AS line_key,v.snapshot FROM zenithjoy.tenant_company_profiles p LEFT JOIN zenithjoy.company_config_versions v ON v.company_id=p.company_id AND v.tenant_id=p.tenant_id AND v.version=p.config_version WHERE p.runtime_config->'routing'->>'line_key' IN ('jinuo','yuesheng')")})).rows;process.stdout.write(JSON.stringify({columns,indexes,triggers,profiles}));}catch{process.stderr.write('COMPANY_READINESS_DATABASE_UNAVAILABLE');process.exitCode=1;}finally{await pool.end();}})();`;
 if(execute)return execute(script);
 return new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','mmv','set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node -'],{stdio:['pipe','pipe','pipe']});
  let output='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('COMPANY_READINESS_TIMEOUT'));},30000);
  child.stdout.on('data',data=>{output+=data;if(output.length>2*1024*1024){child.kill('SIGTERM');reject(Error('COMPANY_READINESS_RESPONSE_LIMIT'));}});
  child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('COMPANY_READINESS_DATABASE_UNAVAILABLE'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('COMPANY_READINESS_DATABASE_UNAVAILABLE'));try{resolve(JSON.parse(output));}catch{reject(Error('COMPANY_READINESS_RESPONSE_INVALID'));}});
  child.stdin.end(script);
 });
}
export async function checkDeploymentCompanyReadiness(options={}) {
 return evaluateCompanyReadiness(await remoteCompanyInventory(options),options);
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
 try {
  const result=await checkDeploymentCompanyReadiness({requireEnabled:(process.env.WF_COMPANY_REQUIRE_ENABLED||'').split(',').filter(Boolean)});
  process.stderr.write(JSON.stringify({company_readiness:result})+'\n');
 } catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
