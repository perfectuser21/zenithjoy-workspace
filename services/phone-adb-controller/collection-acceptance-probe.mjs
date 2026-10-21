// 显式冻结的候选验收动作；默认模板不启用，不产生执行停止证明。
import {readFileSync,writeFileSync,openSync,closeSync,fstatSync,constants,realpathSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFrozen} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifiedCollectionPanelFailure(result,{evidenceRoot,videoId,owner,attempt,startedAt}){
 try{
  const matches=[...(result.stderr||'').matchAll(/^COLLECTION_COMMENT_PANEL_READBACK_FAILED xml_path_b64=([A-Za-z0-9+/=]+) xml_sha256=([a-f0-9]{64})$/gm)];
  if(result.code===0||matches.length!==1||!/^comment panel is not open; run open-comments first$/m.test(result.stderr||'')||!Number.isSafeInteger(startedAt)||!Number.isFinite(startedAt)||!/^a[1-9][0-9]*$/.test(attempt||'')||!/^[A-Za-z0-9_-]+$/.test(owner||''))return false;
  const [,encoded,digest]=matches[0],path=Buffer.from(encoded,'base64').toString('utf8'),root=realpathSync(evidenceRoot);
  const prefix=owner+'-v'+videoId+'-collection-screen',name=basename(path);
  if(realpathSync(path)!==path||dirname(path)!==root||!name.startsWith(prefix)||!new RegExp('^[1-9][0-9]*-comments-closed-'+digest+'\\.xml$').test(name.slice(prefix.length)))return false;
  let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(!stat.isFile()||stat.mtimeMs<startedAt)return false;return hash(readFileSync(fd))===digest;}finally{if(fd!==undefined)closeSync(fd);}
 }catch{return false;}
}
export function validateCollectionAcceptanceProbe(probe){
 if(!probe||Object.keys(probe).sort().join(',')!=='kind,video_id'||probe.kind!=='close_comment_panel_once'||!/^\d{16,24}$/.test(probe.video_id||''))throw Error('COLLECTION_ACCEPTANCE_PROBE_INVALID');
 return probe;
}
function identity(frozen,binding,env){
 const scope=frozen.collection_phone_scope,probe=validateCollectionAcceptanceProbe(scope?.acceptance_probe);
 if(binding.task_id!==scope.task_id||binding.run_id!==scope.run_id||scope.run_id!==env.WFR_RUN_ID+'__'+env.WFR_ATTEMPT||scope.attempt!==env.WFR_ATTEMPT||scope.profile!==env.P||scope.serial!==env.SERIAL||scope.source_commit!==frozen.deployment.source_commit||scope.target!==frozen.deployment.target||!env.WFR_TAG)throw Error('COLLECTION_ACCEPTANCE_PROBE_BINDING_INVALID');
 return {version:1,kind:probe.kind,video_id:probe.video_id,task_id:binding.task_id,run_id:binding.run_id,attempt:scope.attempt,source_commit:scope.source_commit,profile:scope.profile,serial:scope.serial,target:scope.target,owner:env.WFR_TAG,snapshot_sha256:frozen.snapshot_sha256,binding_id:binding.id};
}
function verifiedArtifact(path,digest,root){
 const actual=realpathSync(path);if(actual!==path||dirname(actual)!==realpathSync(root))throw Error('COLLECTION_ACCEPTANCE_PROBE_EVIDENCE_INVALID');
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);if(!fstatSync(fd).isFile())throw Error('COLLECTION_ACCEPTANCE_PROBE_EVIDENCE_INVALID');const bytes=readFileSync(fd);if(digest&&hash(bytes)!==digest)throw Error('COLLECTION_ACCEPTANCE_PROBE_EVIDENCE_INVALID');return bytes;}finally{if(fd!==undefined)closeSync(fd);}
}
function privateJson(path){
 let fd;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);if(!st.isFile()||(st.mode&0o777)!==0o600||st.uid!==process.getuid()||st.size>65536)throw Error('COLLECTION_ACCEPTANCE_PROBE_FILE_INVALID');return JSON.parse(readFileSync(fd,'utf8'));}finally{if(fd!==undefined)closeSync(fd);}
}
export function verifyCollectionAcceptanceConsumption({frozen,binding,env}){
 if(!frozen.collection_phone_scope?.acceptance_probe)return true;
 try{const expected=identity(frozen,binding,env),consumed=privateJson(join(env.WFR_RUN_DIR,'collection-acceptance-probe.consumed.json')),back=privateJson(join(env.WFR_RUN_DIR,'collection-acceptance-probe.back-returned.json'));if(!equal(consumed.projection,expected)||!equal(back.projection,expected)||!equal(consumed.opened_evidence,back.opened_evidence)||typeof back.back_controller_stdout!=='string'||!back.back_controller_stdout.trim())return false;verifiedArtifact(consumed.opened_evidence.path,consumed.opened_evidence.sha256,frozen.collection_phone_scope.evidence_root);return true;}catch{return false;}
}
export function prepareCollectionAcceptanceProbe({frozen,binding,env,qualifiedVideoIds,directory,producer}){
 if(!frozen.collection_phone_scope?.acceptance_probe)return {};
 const projection=identity(frozen,binding,env);
 if(!Array.isArray(qualifiedVideoIds)||!qualifiedVideoIds.includes(projection.video_id))throw Error('COLLECTION_ACCEPTANCE_PROBE_VIDEO_NOT_QUALIFIED');
 const input=join(directory,'acceptance-probe.json');
 writeFileSync(input,JSON.stringify({projection,qualified_video_ids:qualifiedVideoIds,leaf_socket:producer.env.WFR_COLLECTION_LEAF_SOCKET,leaf_nonce_sha256:hash(producer.env.WFR_COLLECTION_LEAF_NONCE)}),{flag:'wx',mode:0o600});
 return {WFR_COLLECTION_ACCEPTANCE_INPUT:input};
}
export function consumeCollectionAcceptanceProbe({action,videoId,input,controllerOutput,env=process.env}){
 if(!['consume','back-returned'].includes(action))throw Error('COLLECTION_ACCEPTANCE_PROBE_ACTION_INVALID');
 const runDir=realpathSync(env.WFR_RUN_DIR),frozen=readFrozen(runDir),binding=readBinding(runDir,env.WFR_ATTEMPT,frozen),expected=identity(frozen,binding,env);
 const path=realpathSync(input),scopeRoot=join(runDir,'collection-phone-scopes')+'/';
 if(resolve(input)!==path||!path.startsWith(scopeRoot)||dirname(path)===scopeRoot.slice(0,-1)||!env.WFR_COLLECTION_LEAF_SOCKET||!env.WFR_COLLECTION_LEAF_NONCE)throw Error('COLLECTION_ACCEPTANCE_PROBE_PARENT_INPUT_INVALID');
 const value=privateJson(path);
 if(!equal(value.projection,expected)||value.leaf_socket!==env.WFR_COLLECTION_LEAF_SOCKET||value.leaf_nonce_sha256!==hash(env.WFR_COLLECTION_LEAF_NONCE)||!value.qualified_video_ids?.includes(videoId))throw Error('COLLECTION_ACCEPTANCE_PROBE_PARENT_INPUT_INVALID');
 if(videoId!==expected.video_id)return 'not_selected';
 const consumed=join(runDir,'collection-acceptance-probe.consumed.json'),returned=join(runDir,'collection-acceptance-probe.back-returned.json');
 const root=frozen.collection_phone_scope.evidence_root;
 const checkedRecord=()=>{const record=privateJson(consumed);if(!equal(record.projection,expected)||!record.opened_evidence)throw Error('COLLECTION_ACCEPTANCE_PROBE_CONSUMPTION_INVALID');verifiedArtifact(record.opened_evidence.path,record.opened_evidence.sha256,root);return record;};
 if(action==='back-returned'){
  const record=checkedRecord();writeFileSync(returned,JSON.stringify({...record,back_controller_stdout:controllerOutput}),{flag:'wx',mode:0o600});return 'back_returned';
 }
 // 已消费时先核原件，再跳过注入；绝不因EEXIST重新执行或重置次数。
 try{privateJson(consumed);const record=checkedRecord(),back=privateJson(returned);if(!equal(back.projection,expected)||!equal(back.opened_evidence,record.opened_evidence))throw Error('COLLECTION_ACCEPTANCE_PROBE_CONSUMPTION_INVALID');return 'already_consumed';}
 catch(error){if(error.code!=='ENOENT')throw error;try{privateJson(consumed);throw Error('COLLECTION_ACCEPTANCE_PROBE_CONSUMPTION_INVALID');}catch(second){if(second.code!=='ENOENT')throw second;}}
 try{privateJson(returned);throw Error('COLLECTION_ACCEPTANCE_PROBE_CONSUMPTION_INVALID');}catch(error){if(error.code!=='ENOENT')throw error;}
 const fields=Object.fromEntries(String(controllerOutput||'').split('\n').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
 if(fields.comments_opened!=='1'||!fields.evidence)throw Error('COLLECTION_ACCEPTANCE_PROBE_OPEN_UNVERIFIED');
 const bytes=verifiedArtifact(fields.evidence,null,root);if(!/发条评论|放大评论区|回复 按钮|展开[0-9]+条回复|text="评论 ?[0-9]+"|[0-9]+ ?条评论|暂无评论/.test(bytes.toString()))throw Error('COLLECTION_ACCEPTANCE_PROBE_OPEN_UNVERIFIED');
 const digest=hash(bytes),archive=fields.evidence.replace(/\.xml$/,'-opened-'+digest+'.xml');if(archive===fields.evidence)throw Error('COLLECTION_ACCEPTANCE_PROBE_EVIDENCE_INVALID');
 try{writeFileSync(archive,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;verifiedArtifact(archive,digest,root);}
 const record={projection:expected,opened_evidence:{path:archive,sha256:digest}};
 try{writeFileSync(consumed,JSON.stringify(record),{flag:'wx',mode:0o600});return 'trigger';}
 catch(error){if(error.code!=='EEXIST')throw error;throw Error('COLLECTION_ACCEPTANCE_PROBE_CONSUMPTION_INVALID');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==6)throw Error('COLLECTION_ACCEPTANCE_PROBE_ARGUMENT_INVALID');process.stdout.write(consumeCollectionAcceptanceProbe({action:process.argv[2],videoId:process.argv[3],input:process.argv[4],controllerOutput:process.argv[5]})+'\n');}
 catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
}
