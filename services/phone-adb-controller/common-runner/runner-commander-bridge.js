const NONE=Object.freeze({action:'none'});
const keyOf=value=>typeof value==='string'?value:value?.key;

/** Commander 只提供建议；本模块从不接收或返回业务判定。 */
export function createCommanderBridge({transport,onEvent=async()=>{},run_id,brief={},rules=[],budget={},skill}={}){
 const limits={max_steers:3,max_recovery_turns:1,max_calls:100,timeout_ms:60000,...budget};
 if(!Number.isSafeInteger(limits.max_steers)||limits.max_steers<0||!Number.isSafeInteger(limits.max_recovery_turns)||limits.max_recovery_turns<0||limits.max_recovery_turns>1
  ||!Number.isSafeInteger(limits.max_calls)||limits.max_calls<1||!Number.isSafeInteger(limits.timeout_ms)||limits.timeout_ms<1
  ||(limits.max_cost!==undefined&&(!Number.isFinite(limits.max_cost)||limits.max_cost<0||!Number.isFinite(limits.max_call_cost)||limits.max_call_cost<=0)))throw Error('commander_budget_invalid');
 const guidance=new Map(),aborted=new Set(),counts=new Map(),recovered=new Set();
 let status='unavailable',calls=0,steers=0,reserved=0,asleep=false,unreachable=false,queue=Promise.resolve();
 const emit=async(event_type,fields)=>onEvent({event_type,run_id,...fields});
 const turn=async(phase,activity,event,executor_kind)=>{
  const key=keyOf(activity)??null;
  if(asleep&&phase!=='sleep')return NONE;
  if(unreachable){await emit('COMMANDER_UNAVAILABLE',{activity:key,phase,error:'commander_unavailable_for_run'});return NONE;}
  if(calls>=limits.max_calls||(limits.max_cost!==undefined&&reserved+limits.max_call_cost>limits.max_cost+Number.EPSILON)){
   await emit('COMMANDER_BUDGET_EXHAUSTED',{activity:key,phase});return NONE;
  }
  const request={protocol:'runner-commander/v1',phase,run_id,activity:key,executor_kind,event,brief,rules,budget:limits,...(skill?{skill}:{})};
  await emit('COMMANDER_REQUEST',{activity:key,phase,request});
  calls++;reserved+=limits.max_call_cost??0;
  let reply,timer;
  try{
   if(typeof transport!=='function')throw Error('commander_transport_unavailable');
   reply=await Promise.race([transport(request),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('commander_timeout')),limits.timeout_ms);})]);
   status='available';
  }catch(error){
   status='unavailable';unreachable=true;
   const diagnostic=error?.commanderDiagnostic;
   const commander_diagnostic=diagnostic&&typeof diagnostic==='object'?Object.fromEntries(
    ['activity','phase','run_id','gateway_run_id','status','elapsed_ms','timeout_ms']
     .filter(field=>['string','number','boolean'].includes(typeof diagnostic[field]))
     .map(field=>[field,typeof diagnostic[field]==='string'?diagnostic[field].slice(0,300):diagnostic[field]])):undefined;
   await emit('COMMANDER_UNAVAILABLE',{activity:key,phase,error:String(error?.message??error).slice(0,300),...(commander_diagnostic?{commander_diagnostic}:{})});return NONE;
  }
  finally{clearTimeout(timer);}
  let action=NONE;
  if(executor_kind==='agent'&&key&&!aborted.has(key)){
   if(['steer','answer'].includes(reply?.action)&&typeof reply.text==='string'&&reply.text.trim()&&reply.text.length<=16000){
    if(reply.action==='answer'||steers<limits.max_steers){
     action={action:reply.action,text:reply.text.trim()};
     guidance.set(key,[...(guidance.get(key)??[]),action.text]);
     if(reply.action==='steer'){steers++;counts.set(key,(counts.get(key)??0)+1);}
    }
   }else if(reply?.action==='abort'&&typeof reply.reason==='string'&&reply.reason.trim()&&reply.reason.length<=16000){
    action={action:'abort',reason:reply.reason.trim()};aborted.add(key);counts.set(key,(counts.get(key)??0)+1);
   }
  }
  await emit('COMMANDER_EXCHANGE',{activity:key,phase,action,accepted:action!==NONE,reply});
  return action;
 };
 const enqueue=(...args)=>{const next=queue.then(()=>turn(...args));queue=next.catch(()=>{});return next;};
 return {
  get status(){return status;},
  wake:()=>enqueue('wake',null,null,'code'),
  sleep:async()=>{if(asleep)return;try{await enqueue('sleep',null,null,'code');}finally{asleep=true;await emit('COMMANDER_SLEEP',{phase:'sleep'});}},
  notify:(activity,event,{executor_kind='code'}={})=>enqueue('event',activity,event,executor_kind),
  recovery:async(activity,event,{executor_kind='agent'}={})=>{
   const key=keyOf(activity);
   if(limits.max_recovery_turns===0||recovered.has(key)||executor_kind!=='agent'||steers>=limits.max_steers)return NONE;
   recovered.add(key);return enqueue('recovery',key,event,executor_kind);
  },
  takeGuidance:activity=>{const key=keyOf(activity),value=guidance.get(key)??[];guidance.delete(key);return value;},
  isAborted:activity=>aborted.has(keyOf(activity)),
  interventions:activity=>counts.get(keyOf(activity))??0,
 };
}
