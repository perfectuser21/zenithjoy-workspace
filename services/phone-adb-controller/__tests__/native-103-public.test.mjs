import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowHandlers} from '../leadgen-workflow.mjs';
const nativeWorkflow=await import('../native-scoring-workflow.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
import {digest} from '../runtime-definition.mjs';

// 公开入口的断链哨兵：原默认仅返回preflight issuer的supports=false，103永远不进原语。
// 此fixture的业务依赖只能在可信Code构造接缝提供；普通Agent请求不能提供它们。
test('正常103公开入口提供受控工厂；缺冻结来源时零PG且绝不回退旧RPC',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'native103-public-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const env={HOME:directory,WFR_RUN_DIR:directory,WFR_TAG:'native103_public',WFR_RUN_ID:'douyin_comment_scoring-native103_public',WFR_ATTEMPT:'a1',P:'mmv-scoring',SERIAL:'none',WFR_HOSTKEY:'mmv',LEADGEN_LINE:'yuesheng',LEADGEN_SOURCE_RUN:'source102',LEADGEN_LIMIT:'1',WF_BRAIN_WORKFLOW:'douyin_comment_scoring'};
 const input={workflow_key:'douyin_comment_scoring',run_tag:env.WFR_TAG,profile:env.P,serial:env.SERIAL,line:env.LEADGEN_LINE,source_run:'source102',limit:1};
 const body={execution_mode:'agent',agent_input:input,deployment:{source_commit:'a'.repeat(40)},files:{}};
 const frozen={...body,snapshot_sha256:digest(body)};writeFileSync(join(directory,'run-definition.json'),JSON.stringify(frozen));
 assert.equal(typeof nativeWorkflow.createNativeScoringWorkflow,'function','公开factory缺受控103实现');
 const handlers=createWorkflowHandlers({root:directory,env,frozen,binding:{id:'00000000-0000-4000-8000-000000000001'},taskId:'00000000-0000-4000-8000-000000000002',sourceCommit:body.deployment.source_commit,
  rpc:async()=>{throw Error('LEGACY_RPC_FORBIDDEN');},execute:async()=>{throw Error('OS_EXEC_FORBIDDEN');}});
 assert.equal(typeof handlers.prepareNativeScoring,'function','缺正式103 factory；不能翻supports布尔绕过准备');
 assert.equal(handlers.agentSupportsNativeScope({key:'scoring'}),false,'未准备/source缺失不能支持');
 await assert.rejects(()=>handlers.prepareNativeScoring(),/NATIVE_103_SOURCE|NATIVE_103_DEPENDENCY/);
 assert.equal(handlers.agentSupportsNativeScope({key:'scoring'}),false);
 assert.equal(handlers.agentSupportsNativeScope({key:'mark_leads'}),false);
});
