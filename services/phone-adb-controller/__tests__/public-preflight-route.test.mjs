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
 for(const args of [{root,files:{},scope},{root,files,scope:{policy:{...policy,endpoint:'tcp:127.0.0.1:5041'}}},{root,files,scope:{policy:{...policy,instance_id:'request-selected'}}}])assert.throws(()=>freezePublicPreflightRoute(args),/PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
 writeFileSync(path,JSON.stringify({...policy,endpoint:'tcp:127.0.0.1:5041'}));assert.throws(()=>freezePublicPreflightRoute({root,files,scope}),/PUBLIC_PREFLIGHT_ROUTE_SOURCE/);
});
