// Preflight must return an intent before its native account read. Keep the
// broker's maximum question-observer wait and a separate native-tool window.
const PREFLIGHT_OBSERVER_MS=20000;
const PREFLIGHT_TOOL_MS=20000;
// One minute is a responsiveness ceiling, not an enlarged Activity budget.
const PREFLIGHT_MODEL_MS=60000;
export function rawModelTurnDeadline(request,now=Date.now()){
 const worker=request.worker_deadline_ms;
 if(!Number.isSafeInteger(worker)||!Number.isSafeInteger(now))return null;
 if(request.activity_key!=='preflight')return worker-now>=1000?worker:null;
 const deadline=Math.min(now+PREFLIGHT_MODEL_MS,worker-PREFLIGHT_OBSERVER_MS-PREFLIGHT_TOOL_MS);
 return deadline-now>=1000?deadline:null;
}
