import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';
import {installPreflightPg,preflightPgDeployment,preflightPgLockIdentity} from '../../preflight-pg-dependencies.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export async function foundationFixture(workflow='101'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'foundation-host-'))),runtime=path.join(root,'runtime'),cwd=path.join(root,'bundle');
 for(const p of [runtime,cwd])fs.mkdirSync(p,{mode:0o700});
 for(const n of ['preflight-pg-dependencies.mjs','preflight-pg-lock.json'])fs.copyFileSync(new URL('../../'+n,import.meta.url),path.join(runtime,n));
 const source='a'.repeat(40);await installPreflightPg({runtimeRoot:runtime,sourceCommit:source});
 const pins=Object.fromEntries(['preflight-pg-dependencies.mjs','preflight-pg-lock.json'].map(n=>[n,hash(fs.readFileSync(path.join(runtime,n)))]));
 // Real executable wrappers have private regular files even on shared CI tool caches.
 const python=path.join(root,'python'),node=path.join(root,'node');
 fs.writeFileSync(python,'#!/bin/sh\nexec python3 "$@"\n',{mode:0o700});
 fs.writeFileSync(node,'#!/bin/sh\nexec '+"'"+process.execPath.replaceAll("'","'\\''")+"'"+' "$@"\n',{mode:0o700});
 const c={transport:'local',host:'fixture-machine',profile:'fixture-phone',serial:'hardware',adb_serial:'localhost:15555',company_id:'company',tenant_id:'tenant',line:'fixture',account:'sender',
  source_commit:source,runtime_root:runtime,node,python,native_root:path.join(root,'native'),
  credentials:{database:path.join(root,'db'),brain:path.join(root,'brain'),feishu:path.join(root,'feishu'),cos:path.join(root,'cos'),provider_env_files:[]},
  max_candidates:1,comment_limit:1,verification:{policy_version:1,policy_id:'fixture-policy',native:{home_package:'fixture.home'},runtime_sha256:pins,
   pg:{deployment:{source_commit:source},preflight_pg:preflightPgLockIdentity({runtimeRoot:runtime})},pg_deployment:preflightPgDeployment({runtimeRoot:runtime,sourceCommit:source})}};
 for(const name of ['phone_controller','phone_registry','adb_host_config']){c[name]=path.join(runtime,name);fs.writeFileSync(c[name],'fixture',{mode:0o600});}
 for(const name of ['node','python','phone_controller','phone_registry','adb_host_config'])c[name+'_sha256']=hash(fs.readFileSync(c[name]));
 const task='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 let business={keyword:'工作流',search_filters:{time_layer:'one_week',sort:'most_liked'},max_candidates:1};
 if(workflow==='102')business={comment_limit:1,scope:{video_ids:['7711111111111111111'],upstream:{'7711111111111111111':{run:'upstream'}},qualification_input:{video_id:'7711111111111111111',coverage:{kind:'full_video',source_duration_display_seconds:35,capture_max_seconds:120,max_capture_sessions:1,max_asr_calls:1,max_judge_primary_calls:1}}}};
 if(workflow==='103')business={scope:{input_mode:'committed_partial_ids',comment_ids:['33333333-3333-4333-8333-333333333333'],sources:{'33333333-3333-4333-8333-333333333333':'upstream'}}};
 if(workflow==='104'){
  business={scope:{record_id:'record',comment_id:'comment',lead_id:'lead',target_douyin_id:'target',profile_url:'https://v.douyin.com/fixture/',source_102_run:'source102',source_103_run:'source103'}};
  const auth={schema:'run-send-authorization/v1',root_task_id:task,decision_id:'decision',message:'测试正文',message_sha256:hash('测试正文'),max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
  const file=path.join(root,'authorization.json');fs.writeFileSync(file,JSON.stringify(auth),{mode:0o600});c.authorization_asset={path:file,sha256:hash(fs.readFileSync(file))};
  c.outreach_runtime={state_directory:path.join(root,'state'),evidence_base:path.join(root,'evidence'),lock_root:path.join(root,'locks'),account_bindings:[{host:c.host,profile:c.profile,serial:c.adb_serial}],history_assets:[]};
 }
 const config={schema:'leadgen-host-config/v1',machine_id:'fixture-machine',bindings:{customer:{allowed_workflows:[workflow],context:c}}},file=path.join(root,'config.json');fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});
 const profile={cwd,runtimeRoot:path.join(root,'kernel'),leadgen:{workflow},files:{},skill_runtime:{control_dir:'control',tools:'TOOLS.txt',host_tools:{kinds:['business']},activities:{}}};
 fs.writeFileSync(path.join(cwd,'sentinel'),'published');profile.files.sentinel=hash('published');
 return {root,profile,run:{task_id:task,run_id:id,deadline_ms:Date.now()+1000000,cleanup_deadline_ms:Date.now()+1200000,input:{run_tag:id,binding_key:'customer',business}},
  environment:{LEADGEN_HOST_CONFIG:file,LEADGEN_HOST_CONFIG_SHA256:hash(fs.readFileSync(file)),LEADGEN_MACHINE_ID:config.machine_id},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
