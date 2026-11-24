import {execFile} from 'node:child_process';
import {readFileSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {runLightweightDiscovery101} from './lightweight-101-discovery.mjs';

const exec=promisify(execFile);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const activity='collect_videos';

// The supervisor supplies hostRoot from the verified profile, outside business input.
export async function runLightweight101Worker(input,hostRoot) {
  if(!isAbsolute(hostRoot)||realpathSync(hostRoot)!==hostRoot)throw Error('LIGHT101_HOST_ROOT');
  const context=read(join(hostRoot,'context.json'));
  const identity=context.tasks?.['101'];
  if(!identity||input.run_tag!==identity.run_id||input.task_id!==identity.task_id||context.max_candidates!==1
    ||!/^([a-f0-9]{64})$/.test(input.action_id??''))throw Error('LIGHT101_WORKER_IDENTITY');

  const actionRoot=join(dirname(hostRoot),'lightweight-101');
  mkdirSync(actionRoot,{mode:0o700,recursive:true});
  const workDir=join(actionRoot,input.action_id);
  mkdirSync(workDir,{mode:0o700});
  const inputFile=join(workDir,'activity-input.json');
  writeFileSync(inputFile,JSON.stringify({identity:{...identity,action_id:input.action_id},activity_key:activity}),{mode:0o600,flag:'wx'});

  const invoke=async(kind,name,args)=>{
    const timeout=Math.min(420000,context.business_deadline_ms-Date.now());
    if(timeout<=0)throw Error('LIGHT101_DEADLINE');
    const {stdout}=await exec(process.execPath,[join(hostRoot,'invoke.mjs'),kind,name,...args],{
      cwd:hostRoot,timeout,maxBuffer:4*1024*1024,
      env:{...process.env,COMMANDER_ACTIVITY_KEY:activity,COMMANDER_ACTIVITY_INPUT_FILE:inputFile,LEADGEN_LIGHT101_HOST_CALL:'1'},
    }).catch(error=>{
      if(typeof error.code==='number'&&error.stdout?.trim())return error;
      throw error;
    });
    const result=JSON.parse(stdout);
    if(result.large_result_saved!==true)return result;
    const receipt=join(hostRoot,'receipts',name+'.json');
    if(result.receipt!==receipt||realpathSync(receipt)!==receipt)throw Error('LIGHT101_RECEIPT_PATH');
    return read(receipt);
  };
  const result=await runLightweightDiscovery101({context,workDir,invoke,hostRoot});
  // Unknown host state is propagated by the discovery executor and never reports completion.
  const status=result.failures.length&&!result.videos.length?'failed':result.evidence_error?'needs_review':result.status;
  return {schema_version:1,run_tag:input.run_tag,...(input.line_key===undefined?{}:{line_key:input.line_key}),
    status,...(['completed','empty','done'].includes(status)?{}:{failure_class:'needs_human'}),
    outputs:{Video:result.handoffs??[],Run:{status,stop_reason:result.stop_reason,all_results_scanned:result.all_results_scanned}},
    metrics:result.counts,evidence:[],execution_stopped:true,
    ...(result.delivery_evidence?{handoff:result.delivery_evidence}:{reason_code:result.evidence_error??'LIGHT101_EVIDENCE_MISSING'})};
}

export async function runLightweight101HostTool(hostRoot,args,env=process.env){
  if(args.length!==1||args[0]!=='light101'||env.COMMANDER_ACTIVITY_KEY!==activity)throw Error('LIGHT101_TOOL_SCOPE');
  const {identity,activity_key:activityKey}=read(env.COMMANDER_ACTIVITY_INPUT_FILE);
  if(activityKey!==activity||identity?.activity_key!==activity)
    throw Error('LIGHT101_TOOL_SCOPE');
  const data=await runLightweight101Worker({run_tag:identity.run_id,task_id:identity.task_id,action_id:identity.action_id},hostRoot);
  return {state:'terminal',result:{exit_code:['completed','done','empty'].includes(data.status)?0:2,data}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runLightweight101Worker(read(0),process.argv[2]??'');
  process.stdout.write(JSON.stringify(result)+'\n');
}
