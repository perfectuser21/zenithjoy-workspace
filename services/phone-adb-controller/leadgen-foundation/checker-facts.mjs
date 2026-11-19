// Read-only evidence transport. Business interpretation belongs exclusively to the Checker Agent.
import{createHash}from'node:crypto';
const requireCondition=x=>{if(!x)throw Error('FACT_SCOPE');};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(value,keys)=>requireCondition(object(value)&&Object.keys(value).every(k=>keys.includes(k)));
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const AUTHORITY_KEYS=['assigned_workflow','tasks','line','company_id','tenant_id','credentials','runtime_root','verification','input_provenance','serial','adb_serial','native_root','profile','source_commit','phone_controller','python','authorization_asset'];
const unique=x=>[...new Set(x.filter(v=>typeof v==='string'&&v.length>0))];
function scope(request,c){
 requireCondition(object(c));
 for(const key of new Set([...Object.keys(c),...AUTHORITY_KEYS]))if(Object.hasOwn(request.context??{},key))requireCondition(canonical(request.context[key])===canonical(c[key]));
 const t=c?.tasks?.[c.assigned_workflow],s=c?.verification?.[c.assigned_workflow]??{};
 requireCondition(t&&request.identity?.task_id===t.task_id&&request.identity?.run_id===t.run_id&&typeof request.nonce==='string'&&request.nonce.length>0&&typeof c.line==='string'&&c.line.length>0);
 return{c,t,s,run:t.run_tag??t.run_id,videoIds:unique(s.video_ids??[]),commentIds:unique([...(s.comment_ids??[]),s.comment_id]),recordIds:unique([s.record_id]),taskIds:unique([t.task_id,c.input_provenance?.producer?.task_id])};
}
function queryFor(bound,args){
 exact(args,['relation']);const{c,run,videoIds,commentIds}=bound;
 // All identifiers are literals. Caller-provided scope and SQL are not accepted.
 const queries={
  videos:{sql:'SELECT * FROM zenithjoy.leadgen_videos WHERE line_key=$1 AND (video_id=ANY($2::text[]) OR discovery_metrics->>\'run\'=$3 OR harvest_batch=$3 OR EXISTS (SELECT 1 FROM zenithjoy.leadgen_comments cm WHERE cm.line_key=leadgen_videos.line_key AND cm.id=ANY($4::uuid[]) AND cm.source_video_url=leadgen_videos.video_url)) ORDER BY video_id LIMIT 501',values:[c.line,videoIds,run,commentIds]},
  comments:{sql:'SELECT * FROM zenithjoy.leadgen_comments WHERE line_key=$1 AND (id=ANY($2::uuid[]) OR harvest_batch=$3) ORDER BY id LIMIT 501',values:[c.line,commentIds,run]},
  outbox:{sql:'SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND (comment_id=ANY($2::uuid[]) OR run_tag=$3) ORDER BY id LIMIT 501',values:[c.line,commentIds,run]},
  leads:{sql:'SELECT l.* FROM zenithjoy.leadgen_leads l WHERE l.line_key=$1 AND EXISTS (SELECT 1 FROM zenithjoy.leadgen_bridge_outbox o WHERE o.line_key=l.line_key AND o.lead_id=l.id AND (o.comment_id=ANY($2::uuid[]) OR o.run_tag=$3)) ORDER BY l.id LIMIT 501',values:[c.line,commentIds,run]},
  company:{sql:'SELECT p.*,v.snapshot AS version_snapshot FROM zenithjoy.tenant_company_profiles p LEFT JOIN zenithjoy.company_config_versions v ON v.company_id=p.company_id AND v.tenant_id=p.tenant_id AND v.version=p.config_version WHERE p.company_id=$1 AND p.tenant_id=$2 LIMIT 501',values:[c.company_id,c.tenant_id]},
  policy:{sql:'SELECT company_id,tenant_id,version,run_id,source_run,snapshot FROM zenithjoy.company_config_runs WHERE company_id=$1 AND tenant_id=$2 AND (run_id=ANY($3::text[]) OR run_id IN (SELECT v.judgment_config->>\'run_id\' FROM zenithjoy.leadgen_videos v WHERE v.line_key=$4 AND (v.video_id=ANY($5::text[]) OR EXISTS (SELECT 1 FROM zenithjoy.leadgen_comments cm WHERE cm.line_key=v.line_key AND cm.id=ANY($6::uuid[]) AND cm.source_video_url=v.video_url))) OR run_id IN (SELECT cm.judgment_config->>\'run_id\' FROM zenithjoy.leadgen_comments cm WHERE cm.line_key=$4 AND cm.id=ANY($6::uuid[]))) ORDER BY run_id LIMIT 501',values:[c.company_id,c.tenant_id,unique([run,c.input_provenance?.producer?.run_tag,...Object.values(bound.s.sources??{})]),c.line,videoIds,commentIds]},
 };
 requireCondition(Object.hasOwn(queries,args.relation));return queries[args.relation];
}
const captureLine=bound=>bound.c.line;
async function pgRead(bound,args,deps){
 const query=queryFor(bound,args),pool=await deps.loadPool(bound.c);let client;
 try{client=await pool.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='10000ms'");
  const connection=(await client.query("SELECT current_database() AS database,current_schema() AS schema,current_user AS role,current_setting('transaction_read_only') AS transaction_read_only,transaction_timestamp() AS snapshot_at")).rows;
  requireCondition(connection.length===1&&connection[0].transaction_read_only==='on');
  const rows=(await client.query(query.sql,query.values)).rows;requireCondition(Array.isArray(rows));
  return{connection:connection[0],rows:rows.slice(0,500),truncated:rows.length>500,observed_at:new Date().toISOString(),query_sha256:createHash('sha256').update(query.sql).digest('hex'),scope:{line:captureLine(bound),run:bound.run}};
 }finally{if(client){try{await client.query('ROLLBACK');}finally{client.release();}}await pool.end();}
}
export async function readFacts(request,deps){
 let source='facts:unavailable';
 try{
  const b=scope(request,await deps.readAuthority()),args=request.args??{};let facts;
  if(request.operation==='pg.rows'){source='postgres:zenithjoy.'+String(args.relation??'');facts=await pgRead(b,args,deps);}
  else if(request.operation==='brain.get'){
   exact(args,['resource','task_id']);let endpoint;
   if(args.resource==='task'){const id=args.task_id??b.t.task_id;requireCondition(b.taskIds.includes(id));endpoint='/tasks/'+encodeURIComponent(id);}
   else {requireCondition(args.resource==='device_lock'&&args.task_id===undefined);endpoint='/device-locks';}
   source='brain:'+endpoint;facts=await deps.brainGet(endpoint,b.c);
   if(args.resource==='device_lock')facts={locks:(facts.locks??[]).filter(x=>x.device_name===b.c.serial)};
  }else if(request.operation==='qualification.origin'){
   exact(args,['video_id']);requireCondition(typeof args.video_id==='string');const rows=(await pgRead(b,{relation:'videos'},deps)).rows.filter(r=>r.video_id===args.video_id);requireCondition(rows.length===1);
   source='qualification-origin:'+args.video_id;facts=await deps.originRead(b.c,rows[0].judgment_config?.run_id,args.video_id);
  }else if(request.operation==='media.inspect'){
   exact(args,['name']);requireCondition(typeof args.name==='string'&&args.name.startsWith(b.run+'-')&&/^[A-Za-z0-9_.-]+$/.test(args.name));source='media:'+args.name;facts=await deps.mediaRead(b.c,args.name);
  }else if(request.operation==='native.read'){exact(args,[]);source='native:'+b.c.serial;facts=await deps.nativeRead(b.c,b.run);}
  else if(request.operation==='feishu.get'){
   exact(args,['record_id']);requireCondition(typeof args.record_id==='string');
   const rows=(await pgRead(b,{relation:'outbox'},deps)).rows;
   requireCondition(b.recordIds.includes(args.record_id)||rows.some(r=>r.feishu_record_id===args.record_id));
   source='feishu:record:'+args.record_id;facts=await deps.feishuGet(args.record_id,b.c);
  }else throw Error('FACT_SCOPE');
  requireCondition(facts!==undefined);return{status:'available',source,facts};
 }catch(error){return{status:'unavailable',source:'facts:unavailable',facts:null,reason:error.message==='FACT_SCOPE'?'FACT_SCOPE_REJECTED':'FACT_READ_UNAVAILABLE'};}
}
export const FACT_TOOL_DESCRIPTION='只读取原始事实，不返回业务判定。operation=pg.rows,args={relation:"videos"|"comments"|"outbox"|"leads"|"policy"|"company"}；brain.get,args={resource:"task",task_id?:本次或受信producer任务ID}或{resource:"device_lock"}；qualification.origin,args={video_id:已绑定视频ID}返回原judgment run的journal/转写原文（不等于视觉验收）；media.inspect,args={name:本run前缀的native目录媒体basename}返回真实ffprobe元数据（不等于完整覆盖）；native.read,args={}；feishu.get,args={record_id:本次原单或已绑定outbox的真实记录ID}。所有范围由宿主冻结context限制；不得传SQL、URL、命令或执行动作。';
export async function serveFacts({contextFile,contextSha256}){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2*1024*1024)throw Error('FACT_INPUT_LIMIT');}
 const {factDependencies,readFrozenContext}=await import('./checker-facts-runtime.mjs');
 const deps={...factDependencies,readAuthority:async()=>readFrozenContext(contextFile,contextSha256)};
 process.stdout.write(JSON.stringify(await readFacts(JSON.parse(input),deps))+'\n');
}
