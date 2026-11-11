import test from 'node:test';
import assert from 'node:assert/strict';
let createStandaloneSkillTools;
try { ({createStandaloneSkillTools}=await import('../standalone-skill-tools.mjs')); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const fixture=()=>({execution_mode:'agent',primary_host:'codex-exec-v1',agent_input:{workflow_key:'douyin_video_discovery',task_id:'task',run_tag:'direct101',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',limit:1,discovery_filters:{sort:'latest',time_layer:'one_week',location:'unlimited'}},standalone_skill:{protocol:'codex-exec-v1',run_id:'run',task_id:'task',skill:{name:'douyin-leadgen-direct'},scope:{approved_keywords:['AI办公']}},discovery_phone_scope:{profile:'cloud-phone-test',serial:'47.100.213.173:10001'}});
function make(extra={}){assert.equal(typeof createStandaloneSkillTools,'function','standalone tools boundary must exist');const effects=[];const call=createStandaloneSkillTools({frozen:fixture(),assertAuthority:async()=>effects.push('authority'),phone:async q=>(effects.push(['phone',q]),{ok:true}),rpc:async q=>(effects.push(['rpc',q]),{ok:true}),...extra});return {call,effects};}
test('inspect reads only fixed information and never calls a phone or business provider',async()=>{
 const {call,effects}=make();const out=await call('inspect',{});assert.equal(out.stage,'101');assert.equal(out.scope.run_tag,'direct101');assert.equal(out.scope.profile,'cloud-phone-test');assert.equal(out.skill.name,'douyin-leadgen-direct');assert.deepEqual(effects,['authority','authority']);assert.ok(out.semantic_phone_commands.includes('open-search-card'));
});
test('unsupported actions and caller-selected resources produce zero provider effects',async()=>{
 const {call,effects}=make();for(const [op,input]of [['workflow',{}],['phone',{command:'private-message-send',args:[]}],['phone',{command:'tap-evidence',args:['1','2','direct101-x']}],['phone',{command:'open-app',args:[],profile:'other'}],['phone',{command:'open-app',args:['--outward','send']}],['business',{operation:'commander',input:{}}],['business',{operation:'company_config',input:{line:'other'}}]])await assert.rejects(call(op,input),/STANDALONE_TOOL_/);
 assert.equal(effects.filter(v=>Array.isArray(v)).length,0);
});
test('phone fixes profile and owner and exposes a semantic card selection without coordinates',async()=>{
 const {call,effects}=make();await call('phone',{command:'open-search-card',args:[0,'direct101-card-1']});assert.deepEqual(effects[1],['phone',{command:'open-search-card',args:[0,'direct101-card-1'],profile:'cloud-phone-test',owner:'direct101'}]);assert.deepEqual(effects.filter(x=>x==='authority'),['authority','authority']);
 await assert.rejects(call('phone',{command:'open-search-card',args:[0,'other-run']}),/STANDALONE_TOOL_/);
});
test('phone search and filters stay in approved keyword and filter scope',async()=>{
 const {call,effects}=make();await call('phone',{command:'open-search',args:[encodeURIComponent('AI办公')]});await call('phone',{command:'search-time-layer',args:['one_week','direct101-filter','latest','unlimited','unlimited','unlimited']});const before=effects.filter(Array.isArray).length;
 await assert.rejects(call('phone',{command:'open-search',args:[encodeURIComponent('other')]}),/STANDALONE_TOOL_/);await assert.rejects(call('phone',{command:'search-time-layer',args:['six_months','direct101-filter']}),/STANDALONE_TOOL_/);assert.equal(effects.filter(Array.isArray).length,before);
});
test('business constructs exact current RPC shapes with fixed scope and device binding',async()=>{
 const {call,effects}=make();await call('business',{operation:'company_config',input:{}});await call('business',{operation:'keywords',input:{}});await call('business',{operation:'resolve_share_link',input:{url:'https://v.douyin.com/AbCd/'}});
 assert.deepEqual(effects.filter(Array.isArray),[
 ['rpc',{kind:'queue',request:{op:'company_config',line:'yuesheng',run:'direct101',step:'101',device_binding:{profile:'cloud-phone-test',device_serial:'47.100.213.173:10001'}}}],
 ['rpc',{kind:'keywords',line:'yuesheng',run:'direct101',limit:1,keywords:['AI办公']}],
 ['rpc',{kind:'resolve_share_link',url:'https://v.douyin.com/AbCd/'}]
 ]);
});
test('discover forwards one video but cannot overwrite any RPC or execution scope',async()=>{
 const {call,effects}=make();const video={videoId:'7646309328911907195',videoUrl:'https://www.douyin.com/video/7646309328911907195',title:'sample',keyword:'AI办公',metrics:{fixture:'validated by existing RPC'}};await call('business',{operation:'discover',input:{video}});assert.deepEqual(effects[1],['rpc',{kind:'queue',request:{op:'discover',line:'yuesheng',run:'direct101',video}}]);
 for(const input of [{video,run:'other'},{video,source:{commit:'other'}},{video:{...video,harvestBatch:'other'}},{video:{...video,keyword:'other'}}])await assert.rejects(call('business',{operation:'discover',input}),/STANDALONE_TOOL_/);
 assert.equal(effects.filter(Array.isArray).length,1);
});
test('authority rejection prevents effects and a failed RPC is not retried',async()=>{
 const denied=make({assertAuthority:async()=>{throw Error('AUTHORITY_REVOKED');}});await assert.rejects(denied.call('phone',{command:'open-app',args:[]}),/AUTHORITY_REVOKED/);assert.deepEqual(denied.effects,[]);
 let count=0;const failed=make({rpc:async()=>{count++;throw Error('UNKNOWN_COMMIT');}});await assert.rejects(failed.call('business',{operation:'company_config',input:{}}),/UNKNOWN_COMMIT/);assert.equal(count,1);assert.deepEqual(failed.effects,['authority','authority']);
});
test('one boundary serializes actions and rejects concurrent work while a provider is pending',async()=>{
 let finish;const waiting=new Promise(r=>finish=r);const {call}=make({phone:async()=>waiting});const active=call('phone',{command:'open-app',args:[]});await new Promise(r=>setImmediate(r));await assert.rejects(call('inspect',{}),/STANDALONE_TOOL_BUSY/);finish({ok:true});await active;await call('inspect',{});
});
test('caller mutation while awaiting authority cannot alter the dispatched command',async()=>{
 let release;const gate=new Promise(r=>release=r);let first=true;const effects=[];const {call}=make({assertAuthority:async()=>{if(first){first=false;await gate;}},phone:async q=>effects.push(q)});const input={command:'open-app',args:[]};const active=call('phone',input);input.command='private-message-send';release();await active;assert.equal(effects[0].command,'open-app');
});
test('a confirmed video consumes the task quota while a different video cannot be submitted',async()=>{
 const calls=[];const {call}=make({rpc:async q=>(calls.push(q),{ok:true,result:{metrics_verified:true,status:'pending'}})});
 const video={videoId:'7646309328911907195',videoUrl:'https://www.douyin.com/video/7646309328911907195',title:'sample',keyword:'AI办公',metrics:{}};
 await call('business',{operation:'discover',input:{video}});
 await assert.rejects(call('business',{operation:'discover',input:{video:{...video,videoId:'7646309328911907196',videoUrl:'https://www.douyin.com/video/7646309328911907196'}}}),/STANDALONE_TOOL_QUOTA/);assert.equal(calls.length,1);
 await call('business',{operation:'discover_readback',input:{video}});assert.equal(calls.length,2);
});
test('an uncertain discover freezes new writes and permits only the original readback',async()=>{
 const calls=[];let uncertain=true;const {call}=make({rpc:async q=>{calls.push(q);if(uncertain)throw Error('UNKNOWN_COMMIT');return {ok:true,result:{metrics_verified:true,status:'pending'}};}});
 const video={videoId:'7646309328911907195',videoUrl:'https://www.douyin.com/video/7646309328911907195',title:'sample',keyword:'AI办公',metrics:{}};
 await assert.rejects(call('business',{operation:'discover',input:{video}}),/UNKNOWN_COMMIT/);
 await assert.rejects(call('business',{operation:'discover',input:{video}}),/STANDALONE_TOOL_COMMIT_UNKNOWN/);
 await assert.rejects(call('business',{operation:'discover_readback',input:{video:{...video,title:'changed'}}}),/STANDALONE_TOOL_COMMIT_UNKNOWN/);assert.equal(calls.length,1);
 uncertain=false;await call('business',{operation:'discover_readback',input:{video}});assert.equal(calls.length,2);
 await assert.rejects(call('business',{operation:'discover',input:{video:{...video,videoId:'7646309328911907196',videoUrl:'https://www.douyin.com/video/7646309328911907196'}}}),/STANDALONE_TOOL_QUOTA/);
});
test('a non-Error provider rejection cannot be swallowed as a successful tool result',async()=>{
 const {call}=make({rpc:async()=>Promise.reject(null)});let accepted=false,rejected=false;
 await call('business',{operation:'company_config',input:{}}).then(()=>{accepted=true;},error=>{rejected=true;assert.equal(error,null);});
 assert.equal(accepted,false);assert.equal(rejected,true);
});
test('each evidence-bearing phone command reserves its evidence ID before effects and refuses reuse',async()=>{
 for(const q of [
  {command:'snapshot-evidence',args:['direct101-once']},
  {command:'current-video-link',args:['direct101-once','AI办公']},
  {command:'search-time-layer',args:['one_week','direct101-once','latest','unlimited','unlimited','unlimited']},
  {command:'open-search-card',args:[0,'direct101-once']}
 ]){
  const {call,effects}=make();await call('phone',q);await assert.rejects(call('phone',q),/STANDALONE_TOOL_EVIDENCE_REUSED/);assert.equal(effects.filter(Array.isArray).length,1,q.command);
 }
 const {call,effects}=make();await call('phone',{command:'ui-evidence',args:['direct101-cross-command']});await assert.rejects(call('phone',{command:'snapshot-evidence',args:['direct101-cross-command']}),/STANDALONE_TOOL_EVIDENCE_REUSED/);assert.equal(effects.filter(Array.isArray).length,1);
 await call('phone',{command:'open-app',args:[]});await call('phone',{command:'open-app',args:[]});assert.equal(effects.filter(Array.isArray).length,3,'commands without evidence do not reserve a shared empty ID');
});
test('failed or unknown phone effects retain the evidence reservation while pre-provider failures do not',async()=>{
 let attempts=0;const failed=make({phone:async()=>{attempts++;throw Error('PHONE_RESULT_UNKNOWN');}});const q={command:'snapshot-evidence',args:['direct101-unknown']};await assert.rejects(failed.call('phone',q),/PHONE_RESULT_UNKNOWN/);await assert.rejects(failed.call('phone',q),/STANDALONE_TOOL_EVIDENCE_REUSED/);assert.equal(attempts,1);
 let allowed=false;const fresh=make({assertAuthority:async()=>{if(!allowed)throw Error('AUTHORITY_NOT_READY');}});await assert.rejects(fresh.call('phone',q),/AUTHORITY_NOT_READY/);allowed=true;
 await assert.rejects(fresh.call('phone',{command:'snapshot-evidence',args:['direct101-unknown','extra']}),/STANDALONE_TOOL_/);await fresh.call('phone',q);assert.equal(fresh.effects.filter(Array.isArray).length,1,'invalid parameters and failed admission do not consume an unused ID');
});
