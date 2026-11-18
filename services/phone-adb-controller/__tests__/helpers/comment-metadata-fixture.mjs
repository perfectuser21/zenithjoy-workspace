import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {companyFixture} from '../company-config-fixture.mjs';import {policy} from '../fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url),native=require('../../queued-recipient-evidence.js');
export function metadataFixture(){
 const evidence=JSON.parse(readFileSync(new URL('../fixtures/comment-metadata-p8.json',import.meta.url))),s=evidence.scope,b=evidence.company_binding;
 const matched=native.parseNativeCommentXml(evidence.raw.returned).rows.filter(r=>r.nickname===s.nickname&&native.hash(r.body)===s.comment_body_sha256);if(matched.length!==1)throw Error('REAL_P8_COMMENT_NOT_UNIQUE');
 const snapshot=companyFixture(s.line_key);Object.assign(snapshot,{company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,config_status:'enabled'});snapshot.runtime_config.routing={line_key:s.line_key,profiles:[b.profile]};snapshot.runtime_config.comment_scoring=structuredClone(policy.runtime_config.comment_scoring);snapshot.runtime_config.platform_accounts=[{...b,platform:'douyin'}];
 const source={company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,run_id:s.run,source_run:null,snapshot,task_inputs:{device_binding:{profile:b.profile,device_serial:b.device_serial}}};
 const video={line_key:s.line_key,video_id:s.video_id,video_url:s.video_url,title:'fixture owned PG video title',harvest_batch:s.run,judgment_status:'matched',process_status:'处理中:'+s.run,url_bindings:1,judgment_config:{company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,policy_id:snapshot.policy_id,run_id:s.run}};
 const row={id:'6ced59bd-fc9f-4311-b042-f00dbb5396bc',line_key:s.line_key,harvest_batch:s.run,source_video:null,source_video_url:s.video_url,comment_body:matched[0].body,nickname:s.nickname,douyin_id:s.douyin_id,profile_url:null,account_type:null,profile_ip:null,region:null,recipient_evidence:evidence,process_status:'待分拣',relevance:null,intent_grade:null,judgment_reason:null,judgment_config:null,dedup_key:'fixture-dedup',collected_at:'2026-11-18T03:00:00.000Z'};
 const f={row,video,source,inserts:[],updates:[],transactions:[],leads:[],outbox:[],casLost:false,modelCalls:0};let prior;
 const client={release(){},async query(sql,args=[]){
  if(sql==='BEGIN'){prior=structuredClone(f.row);f.transactions.push(sql);return {rows:[]};}if(sql==='ROLLBACK'){f.row=prior;f.transactions.push(sql);return {rows:[]};}if(sql==='COMMIT'){f.transactions.push(sql);return {rows:[]};}
  if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:[f.source]};
  if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[f.video]};
  if(sql.includes('FROM zenithjoy.leadgen_bridge_outbox'))return {rows:f.outbox};
  if(sql.includes('FROM zenithjoy.leadgen_leads'))return {rows:f.leads};
  if(sql.includes('FROM zenithjoy.leadgen_comments'))return {rows:[structuredClone(f.row)]};
  if(sql.includes('INSERT INTO zenithjoy.leadgen_comments')){f.inserts.push({sql,args});return {rowCount:1,rows:[{id:f.row.id}]};}
  if(sql.includes('UPDATE zenithjoy.leadgen_comments')){f.updates.push({sql,args});if(f.casLost)return {rowCount:0,rows:[]};Object.assign(f.row,{source_video:args[1],profile_url:args[2],account_type:args[3],profile_ip:args[4],region:args[5]});return {rowCount:1,rows:[structuredClone(f.row)]};}
  throw Error('UNEXPECTED_METADATA_SQL');
 }};f.pool={connect:async()=>client,query:client.query.bind(client)};
 f.comment={nickname:row.nickname,douyinId:row.douyin_id,commentBody:row.comment_body,sourceVideoUrl:row.source_video_url,recipientEvidence:evidence,commentLocation:'江苏'};
 f.collect={op:'collect_partial',line:s.line_key,run:s.run,source_run:null,video_id:s.video_id,video_url:s.video_url,comments:[f.comment],history:[]};return f;
}
