import assert from 'node:assert/strict';import{createRequire}from'node:module';import{mkdtempSync,mkdirSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{randomUUID,createHash}from'node:crypto';import{RPC_FILES}from'../../leadgen-client.mjs';import lineRoutes from'../../line-routes.js';
const require=createRequire(import.meta.url),{Pool}=require('pg'),root=resolve(import.meta.dirname,'../..'),fixturePath=process.env.ZJ_NATIVE_103_PG_FIXTURE;
export async function native103PgFixture(t,{Pool:OwnedPool=Pool}={}){
 const Pool=OwnedPool;
 assert.ok(fixturePath,'需要本人隔离PG fixture metadata');const pg=JSON.parse(readFileSync(fixturePath));assert.equal(pg.database,'cecelia_scratch');assert.equal(pg.host,'127.0.0.1');assert.equal(pg.task_id,'7d85f6ba-873b-40fc-993f-932d24d61e5a');
 const pool=new Pool({host:pg.host,port:pg.port,user:pg.user,database:pg.database,max:2}),admin=await pool.connect();
 assert.equal((await admin.query('SELECT current_database() AS db')).rows[0].db,'cecelia_scratch');
 const systemIdentifier=(await admin.query('SELECT system_identifier::text AS value FROM pg_control_system()')).rows[0].value;
 const schema='native103_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);const sql=text=>text.replaceAll('zenithjoy.',schema+'.');
 const base=readFileSync(resolve(root,'../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql'),'utf8');
 for(const table of ['leadgen_videos','leadgen_comments','leadgen_leads'])await admin.query(sql(base.match(new RegExp(`CREATE TABLE IF NOT EXISTS zenithjoy\\.${table} \\([\\s\\S]+?\\n\\);`))[0]));
 for(const table of ['leadgen_videos','leadgen_comments'])await admin.query(`ALTER TABLE ${schema}.${table} ADD COLUMN judgment_config jsonb`);
 await admin.query(sql(readFileSync(resolve(root,'../../apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql'),'utf8')));
 await admin.query(`CREATE TABLE ${schema}.tenant_company_profiles(company_id uuid PRIMARY KEY,tenant_id uuid,config_version integer,config_status text,runtime_config jsonb);CREATE TABLE ${schema}.company_config_runs(company_id uuid,tenant_id uuid,version integer,run_id text,snapshot jsonb,task_inputs jsonb,source_run text,PRIMARY KEY(company_id,run_id));`);
 const company={company_id:randomUUID(),tenant_id:randomUUID(),version:1,config_status:'enabled',company_key:'yuesheng',wiki:{products:[{id:'product'}],audiences:[{id:'audience'}]},runtime_config:{policy_id:'original-fixture-policy',routing:{line_key:'yuesheng'},comment_scoring:{criteria:{A:'主动报名',B:'咨询',C:'互动','不相关':'跑题'},confidence_threshold:.6,audiences:[{id:'audience',fields:{'意向信号':'报名','排除信号':'同行'}}]}}};
 company.policy_id=company.runtime_config.policy_id;
 await admin.query(`INSERT INTO ${schema}.tenant_company_profiles VALUES($1,$2,1,'enabled',$3)`,[company.company_id,company.tenant_id,company.runtime_config]);
 await admin.query(`INSERT INTO ${schema}.company_config_runs VALUES($1,$2,1,'source102',$3,'{}',null)`,[company.company_id,company.tenant_id,company]);
 await admin.query(`CREATE TABLE ${schema}.company_config_versions(company_id uuid,tenant_id uuid,version integer,snapshot jsonb)`);await admin.query(`INSERT INTO ${schema}.company_config_versions VALUES($1,$2,1,$3)`,[company.company_id,company.tenant_id,company]);
 const id=randomUUID(),url='https://www.douyin.com/video/7617837149999841201';
 await admin.query(`INSERT INTO ${schema}.leadgen_videos(line_key,video_id,video_url,title,harvest_batch,process_status,judgment_status) VALUES('yuesheng','7617837149999841201',$1,'人工智能报名','source102','评论已采','matched')`,[url]);
 await admin.query(`INSERT INTO ${schema}.leadgen_comments(id,line_key,dedup_key,harvest_batch,source_video,source_video_url,comment_body) VALUES($1,'yuesheng','one','source102','人工智能报名',$2,'在哪里报名')`,[id,url]);
 const directory=mkdtempSync(join(tmpdir(),'native103-txn-'));mkdirSync(join(directory,'ledger'),{mode:0o700});
 t.after(async()=>{await admin.query('DROP SCHEMA '+schema+' CASCADE');admin.release();await pool.end();rmSync(directory,{recursive:true,force:true});});
 const calls=[],control={loseCommit:false};let allocated=0;
 const createPool=async()=>{
  allocated++;const actual=new Pool({host:pg.host,port:pg.port,user:pg.user,database:pg.database,max:1});
  let closing;const close=()=>closing??=actual.end();
  const owned={async connect(){const c=await actual.connect();let scoreWrite=false,markWrite=false;return {connection:c.connection,release:(...args)=>c.release(...args),async query(text,args){calls.push(text);const r=await c.query(sql(text),args);if(/UPDATE\s+zenithjoy\.leadgen_comments\b[\s\S]*judgment_config\s*=/i.test(text))scoreWrite=true;if(/INSERT INTO\s+zenithjoy\.leadgen_leads\b/i.test(text))markWrite=true;if(text==='COMMIT'&&markWrite&&control.loseMarkResultCommit){control.loseMarkResultCommit=false;throw Error('FIXTURE_MARK_RESULT_ACK_LOST');}if(text==='COMMIT'&&scoreWrite&&control.loseScoreResultCommit){control.loseScoreResultCommit=false;throw Error('FIXTURE_SCORE_RESULT_ACK_LOST');}if(text==='COMMIT'&&control.loseCommit){control.loseCommit=false;throw Error('FIXTURE_ACK_LOST');}return r;}};},async query(text,args){calls.push(text);return actual.query(sql(text),args);},end:close};
  return {pool:owned,transport:{async close(){await close();return {execution_stopped:actual.ended};},async seal(){await close();return {execution_stopped:actual.ended};}},expectedIdentity:{database:'cecelia_scratch',role:'postgres',system_identifier:systemIdentifier}};
 };
 const source={repo:'perfectuser21/zenithjoy-workspace',commit:'a'.repeat(40),files:[...new Set([...RPC_FILES,'native-scoring-runtime.mjs','native-scoring-producers.mjs'])].map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
 const scope={workflow:'douyin_comment_scoring',run:'native103_real',run_id:'douyin_comment_scoring-native103_real__a1',task_id:randomUUID(),binding_id:randomUUID(),source_commit:source.commit,profile:'mmv-scoring',serial:'none',line:'yuesheng',source_run:'source102',limit:1,deadline_ms:Date.now()+20000,receipt_deadline_ms:Date.now()+25000};
 const claim={claimed_by:'isolated-103-fixture',claimed_at:new Date().toISOString()};
 const task={id:scope.task_id,status:'in_progress',...claim,lease_until:new Date(scope.receipt_deadline_ms+60000).toISOString(),payload:{workflow_key:scope.workflow,source_commit:source.commit,run_tag:scope.run,profile:scope.profile,company_line:scope.line,scope:{source_run:scope.source_run,limit:scope.limit}}};
 const readSource=(path,...args)=>path===join(root,'deployment-manifest.json')?JSON.stringify({source_commit:source.commit}):readFileSync(path,...args);
 return {root,source,scope,readSource,directory:join(directory,'ledger'),createPool,assertAuthority:async()=>structuredClone(task),task,company,id,calls,control,allocated:()=>allocated,
  async seedNative(){
   const sha=text=>createHash('sha256').update(text).digest('hex'),vid='7617837149999841201',prefix=`source102-v${vid}-collection`,profile='xiaolongxia';
   const raw={profile:readFileSync(new URL('./honor-e1b-recipient/profile.xml',import.meta.url),'utf8'),returned:readFileSync(new URL('./honor-e1b-recipient/returned.xml',import.meta.url),'utf8').replaceAll('测试完整评论 首评','在哪里报名')};
   const binding={company_id:company.company_id,tenant_id:company.tenant_id,version:company.version,line_key:'yuesheng',run_id:'source102',source_run:'source101',profile,device_serial:'4311010223',douyin_id:'fixture-sender',verification_status:'verified',enabled:true};
   company.runtime_config.routing.profiles=[profile];company.runtime_config.platform_accounts=[{...binding,platform:'douyin'}];
   const evidence={version:1,status:'verified',scope:{line_key:'yuesheng',run:'source102',source_run:'source101',video_id:vid,video_url:url,profile,douyin_id:'fixture-account-102',nickname:'测试评论人',comment_body_sha256:sha('在哪里报名'),comment_encoding:'canonical',profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'},raw,sha256:{profile:sha(raw.profile),returned:sha(raw.returned)},company_binding:binding,video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:prefix+'-after-card1'}};
   await admin.query(`UPDATE ${schema}.leadgen_comments SET nickname='测试评论人',douyin_id='fixture-account-102',profile_url='https://www.douyin.com/user/fixture-account-102',recipient_evidence=$2 WHERE id=$1`,[id,evidence]);
   await admin.query(`UPDATE ${schema}.tenant_company_profiles SET runtime_config=$1`,[company.runtime_config]);
   await admin.query(`UPDATE ${schema}.company_config_runs SET snapshot=$1,source_run='source101',task_inputs=$2 WHERE run_id='source102'`,[company,{device_binding:{profile,device_serial:'4311010223'}}]);
   return evidence;
  },async readRows(){return {comments:(await admin.query(`SELECT * FROM ${schema}.leadgen_comments`)).rows,leads:(await admin.query(`SELECT * FROM ${schema}.leadgen_leads`)).rows,outbox:(await admin.query(`SELECT * FROM ${schema}.leadgen_bridge_outbox`)).rows};}};
}
