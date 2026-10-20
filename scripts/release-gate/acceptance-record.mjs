import { pathToFileURL } from 'node:url';
import {createHash} from 'node:crypto';
export const REPO = 'perfectuser21/zenithjoy-workspace';
const releaseChecks = {
  api: [
    ['S1-c1', '预发API真实登录成功，未授权请求被拒绝'],
    ['S2-c1', '本次受影响业务真实执行，产出持久化后独立读回'],
    ['S3-c1', '同业务失败与重试可恢复，无重复产出或跨租户写入'],
  ],
  dashboard: [
    ['S4-c1', '预发Dashboard真实登录、页面导航与权限正常'],
    ['S5-c1', '通过界面提交本次受影响业务，列表和详情独立显示真实结果'],
  ],
  'staff-hub': [
    ['S6-c1', '预发Staff Hub员工真实登录与权限正常'],
    ['S7-c1', '本次受影响知识或工作台操作真实写入并刷新后独立读回'],
  ],
};
export function releaseContract(targets) {
  targets=parseTargets(targets).slice().sort();
  const checks=targets.flatMap(t=>releaseChecks[t].map(([check_key,name])=>({check_key,name,kind:'FR'})));
  return {checks, spec_sha:'sha256:'+createHash('sha256').update(JSON.stringify({version:1,targets,checks})).digest('hex')};
}
const knownTargets = new Set(['api', 'dashboard', 'staff-hub']);
function need(ok, message) { if (!ok) throw new Error(message); }
export function parseTargets(value) {
  const targets = Array.isArray(value) ? value : String(value).split(',');
  need(targets.length > 0 && targets.every(x => knownTargets.has(x)) && new Set(targets).size === targets.length, '发布目标无效');
  return targets;
}
// 消费现有 Brain acceptance/runs/:run_key 原件，不接受调用方传 PASS。
// release_targets/source_repo/environment 是建单时冻结在 detail 的发布范围；
// 旧单缺范围只可查阅，不可替其它组件提供生产验收。
export function validateAcceptance(record, {sha, targets, runKey}) {
  need(/^[a-f0-9]{40}$/.test(sha), '候选必须是完整SHA');
  targets = parseTargets(targets);
  const {run, checks} = record || {}, d = run?.detail || {};
  need(run?.run_key === runKey && run.id && run.gp_id && run.status === 'adjudicated', '验收单身份或完成状态不符');
  need(d.source_repo === REPO && d.environment === 'staging', '验收仓库/环境不符');
  need(Array.isArray(d.release_targets) && targets.every(t => d.release_targets.includes(t)), '验收不覆盖本次发布目标');
  const contract=releaseContract(d.release_targets);
  need(d.spec_sha===contract.spec_sha, '验收规程版本不符');
  need(JSON.stringify(checks?.map(c=>c.check_key).sort())===JSON.stringify(contract.checks.map(c=>c.check_key).sort()), '验收格不覆盖冻结规程');
  need(d.gate_verdict === '绿' && d.ai_status !== 'dumb' && !d.blocked_reason && d.spec_sha, '验收未定案通过');
  const fields = new Set(targets.map(t => t === 'api' ? 'backend_sha' : 'frontend_sha'));
  for (const field of fields) need(d[field] === sha && d[field + '_src2'] === sha, `${field}验收版本与候选不符`);
  need(Array.isArray(checks) && checks.length > 0 && new Set(checks.map(c => c.check_key)).size === checks.length, '验收格为空或重复');
  for (const c of checks) {
    need(c.run_id === run.id && /^S\d+-c[1-4]$/.test(c.check_key), '验收格身份不符');
    need(c.result === '通过' && typeof c.note === 'string' && c.note.trim(), '验收未通过或缺实际产出证据');
    const expected=contract.checks.find(x=>x.check_key===c.check_key);
    need(c.name===expected.name && c.kind===expected.kind, '验收格内容被替换');
  }
  return {sha, targets, run_key: runKey, check_count: checks.length};
}
export async function readAcceptance({sha, targets, runKey, baseUrl = 'http://localhost:5221', fetchImpl = fetch}) {
  need(/^[a-zA-Z0-9_.:-]{1,180}$/.test(runKey || ''), '验收run_key无效');
  const url = new URL('/api/brain/acceptance/runs/' + encodeURIComponent(runKey), baseUrl);
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(20000), redirect: 'error'});
  need(response.ok, `读取Brain验收单失败: HTTP ${response.status}`);
  return validateAcceptance(await response.json(), {sha, targets, runKey});
}
if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  try { console.log(JSON.stringify(await readAcceptance({sha:process.argv[2], targets:process.argv[3], runKey:process.argv[4]}))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
