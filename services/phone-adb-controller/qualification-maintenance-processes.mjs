import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {digest} from './runtime-definition.mjs';
const observer=fileURLToPath(new URL('./qualification-maintenance-processes.py',import.meta.url));
export const processObserverDigest=digest(readFileSync(observer));

// 纯判定不是写入能力；生产service只能消费本人实际采集的受信观察器结果。
export function evaluateProcessCensus(census,scope) {
  const blocked_pids=[];
  const blocked=reason=>({status:'blocked',reason,blocked_pids:[...new Set(blocked_pids)],os_full_stop:false});
  if(!census||census.protocol!=='qualification-process-census-v1'||census.observer_sha256!==processObserverDigest
    ||census.host!==scope.host||census.uid!==scope.uid||!Number.isFinite(census.finished_at_ms)
    ||census.finished_at_ms<Date.now()-10000||census.finished_at_ms>Date.now()+2000
    ||!Array.isArray(census.unknown)||census.unknown.length)return blocked('PROCESS_OBSERVATION_UNKNOWN');
  const arrays=['enumerated','final_enumerated','observations','absent','tracked'];
  if(arrays.some(k=>!Array.isArray(census[k])))return blocked('PROCESS_OBSERVATION_INCOMPLETE');
  const covered=new Set(census.observations.map(x=>x.pid));
  if(census.absent.some(x=>x.reason!=='ESRCH'))return blocked('PROCESS_ABSENCE_UNPROVEN');
  for(const x of census.absent)covered.add(x.pid);
  if([...census.enumerated,...census.final_enumerated].some(x=>x.uid===scope.uid&&x.pid>1&&!covered.has(x.pid)))return blocked('PROCESS_ENUMERATION_INCOMPLETE');
  const accepted=new Set(['observer','terminal','read_only_native_observer','read_only_screenshot','maintenance_epoch_actor',
    'preexisting_outside_original_run','outside_supported_program','independent_explicit_program']);
  for(const row of census.observations)if(!accepted.has(row.classification))blocked_pids.push(row.pid);
  for(const expected of scope.tracked||[]) {
    const found=census.tracked.filter(x=>x.pid===expected.pid&&x.expected_start_identity===expected.start_identity);
    if(found.length!==1||!['absent','terminal','reused'].includes(found[0].state)
      ||found[0].state==='absent'&&found[0].reason!=='ESRCH')blocked_pids.push(expected.pid);
  }
  if(blocked_pids.length)return blocked('PROCESS_EFFECTOR_ACTIVE_OR_UNCLASSIFIED');
  return {status:'verified',domain:'fixed_353_qualification_effects',os_full_stop:false,
    observation_sha256:digest(census),observed_at_ms:census.finished_at_ms,blocked_pids:[]};
}
export async function collectProcessCensus(scope) {
  const result=spawnSync('python3',['-I',observer],{input:JSON.stringify(scope),encoding:'utf8',timeout:30000,maxBuffer:6*1024*1024});
  let census;try{census=JSON.parse(result.stdout);}catch{throw Error('MAINTENANCE_PROCESS_OBSERVER_UNKNOWN');}
  if(result.status!==0||result.error||result.signal||census.observer_pid!==result.pid||census.observer_sha256!==processObserverDigest)throw Error('MAINTENANCE_PROCESS_OBSERVER_UNKNOWN');
  return census;
}
