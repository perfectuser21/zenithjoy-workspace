import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {defaultCollectionPhoneScope} from '../collection-phone-scope.mjs';
import {defaultDiscoveryPhoneScope} from '../discovery-phone-scope.mjs';

// Exercise the deployed source template consumer, not a text/constant assertion.
function fixture(fn){
 const home=mkdtempSync(join(tmpdir(),'e6-source-scope-'));
 try{
  mkdirSync(join(home,'config'));const bytes=readFileSync(new URL('../config/collection-phone-hosts.json',import.meta.url));
  const config=JSON.parse(bytes);for(const h of config.hosts)delete h.evidence_alias;
  // The production alias itself is checked on the actual host. This fixture
  // cannot manufacture that filesystem; all other fixed source bytes are used.
  const raw=Buffer.from(JSON.stringify(config));writeFileSync(join(home,'config/collection-phone-hosts.json'),raw);
  writeFileSync(join(home,'deployment-manifest.json'),JSON.stringify({target:'xian-m4',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/config/collection-phone-hosts.json',deployed_path:'config/collection-phone-hosts.json',content_sha256:createHash('sha256').update(raw).digest('hex')}]}));
  const env={WF_BRAIN_WORKFLOW:'douyin_video_processing',P:'yueshengyun-work',SERIAL:'e6c7ef34',WFR_RUN_DIR:join(home,'absent-run'),WFR_RUN_ID:'scope-test',WF_BRAIN_TASK_ID:'11111111-1111-4111-8111-111111111111'};
  fn(home,env);
 }finally{rmSync(home,{recursive:true,force:true});}
}
test('fixed M4 e6 source can freeze exact 101 and 102 scopes without borrowing 431',()=>fixture((root,env)=>{
 const collect=defaultCollectionPhoneScope({root,env});assert.ok(collect,'e6 requires a fixed 102 template');
 assert.equal(collect.profile,'yueshengyun-work');assert.equal(collect.serial,'e6c7ef34');assert.equal(collect.target,'xian-m4');assert.equal(collect.expected_account,'37358506855');
 assert.equal(collect.policy.host_id,'xian-m4');assert.equal(collect.policy.transport,'usb');assert.equal(collect.policy.endpoint,'tcp:127.0.0.1:5037');
 assert.deepEqual(collect.policy.forbidden_ports,[5041,5042]);
 const discover=defaultDiscoveryPhoneScope({root,env:{...env,WF_BRAIN_WORKFLOW:'douyin_video_discovery'}});assert.ok(discover,'e6 requires a fixed 101 template');assert.equal(discover.serial,'e6c7ef34');
 assert.equal(defaultCollectionPhoneScope({root,env:{...env,SERIAL:'ANGYVB4311010223'}}),undefined);
 assert.equal(defaultCollectionPhoneScope({root,env:{...env,WFR_HOSTKEY:'mmv'},workflowKey:'douyin_lead_outreach'}),undefined);
}));
