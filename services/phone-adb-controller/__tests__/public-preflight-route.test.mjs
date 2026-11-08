import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest} from '../runtime-definition.mjs';
import {freezePublicPreflightRoute} from '../public-preflight-route.mjs';
test('default schema1 route keeps the original global policy without an instance capability',()=>{
 assert.equal(freezePublicPreflightRoute({scope:{policy:{schema_version:1,endpoint:'tcp:127.0.0.1:5041'}}}),null);
});
test('schema2 profile route requires released managed row and exact private source bytes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'public-route-')));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'config'));
 const path=join(root,'epoch2.json'),policy={schema_version:2,instance_id:'mmv-cloud-epoch2',host_id:'mmv',transport:'tcp',endpoint:'tcp:127.0.0.1:5042',forbidden_ports:[],adb_bin:'/fixed/adb',adb_realpath:'/fixed/adb',adb_sha256:'a'.repeat(64)};
 writeFileSync(path,JSON.stringify(policy),{mode:0o600});const registryPath='config/adb-host-instances.json',registry={schema_version:1,instances:[{instance_id:policy.instance_id,kind:'managed',policy_path:path,policy,coexists_with:['legacy']}]};
 writeFileSync(join(root,registryPath),JSON.stringify(registry));const files={[registryPath]:digest(readFileSync(join(root,registryPath)))},scope={policy};
 const frozen=freezePublicPreflightRoute({root,files,scope});assert.equal(frozen.policy_path,path);assert.equal(frozen.policy_sha256,digest(readFileSync(path)));assert.equal(frozen.registry_sha256,files[registryPath]);
 const oldPolicy={...policy,schema_version:1,endpoint:'tcp:127.0.0.1:5041'};delete oldPolicy.instance_id;
 const original={version:1,target:'mmv',profile:'cloud-phone-test',serial:'47.100.213.173:10001',expected_account:'77980009922',policy:oldPolicy};
 const manifest={target:'mmv',files:[{path:'services/phone-adb-controller/'+registryPath,deployed_path:registryPath,content_sha256:files[registryPath]}]};
 // Offline assembly selects only released registry authority, never a Task field.
 return import('../public-preflight-route.mjs').then(async({selectPublicPreflightScope})=>{
 assert.equal(typeof selectPublicPreflightScope,'function');
 const selected=selectPublicPreflightScope({root,manifest,scope:original,instanceId:policy.instance_id});
 assert.deepEqual(selected.policy,policy);assert.deepEqual(selected.policy_binding,frozen);assert.deepEqual(original.policy,oldPolicy);
 assert.equal(selected.expected_account,original.expected_account);assert.equal(selected.serial,original.serial);
 const hosts={version:1,hosts:[original]},hostsPath='config/collection-phone-hosts.json';writeFileSync(join(root,hostsPath),JSON.stringify(hosts));
 manifest.source_commit='a'.repeat(40);manifest.files.push({path:'services/phone-adb-controller/'+hostsPath,deployed_path:hostsPath,content_sha256:digest(readFileSync(join(root,hostsPath)))});writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify(manifest));
 const env={P:original.profile,SERIAL:original.serial,WFR_RUN_DIR:join(root,'new-run'),WFR_RUN_ID:'new-batch',WF_BRAIN_WORKFLOW:'douyin_video_processing'};
 const {defaultCollectionPhoneScope}=await import('../collection-phone-scope.mjs'),{defaultDiscoveryPhoneScope}=await import('../discovery-phone-scope.mjs');
 const collection=defaultCollectionPhoneScope({root,env,instanceId:policy.instance_id}),discovery=defaultDiscoveryPhoneScope({root,env:{...env,WF_BRAIN_WORKFLOW:'douyin_video_discovery'},instanceId:policy.instance_id});
 for(const current of [collection,discovery]){assert.deepEqual(current.policy,policy);assert.deepEqual(current.policy_binding,frozen);}
 assert.equal(defaultCollectionPhoneScope({root,env}).policy.endpoint,'tcp:127.0.0.1:5041','omitting the Code-only instance selector preserves global policy');
 assert.throws(()=>selectPublicPreflightScope({root,manifest,scope:original,instanceId:'undeclared-task-input'}),/PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
 for(const args of [{root,files:{},scope},{root,files,scope:{policy:{...policy,endpoint:'tcp:127.0.0.1:5041'}}},{root,files,scope:{policy:{...policy,instance_id:'request-selected'}}}])assert.throws(()=>freezePublicPreflightRoute(args),/PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
 writeFileSync(path,JSON.stringify({...policy,endpoint:'tcp:127.0.0.1:5041'}));assert.throws(()=>freezePublicPreflightRoute({root,files,scope}),/PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
 });
});
