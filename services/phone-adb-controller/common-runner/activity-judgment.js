const STATUSES = new Set(['done', 'retry', 'failed', 'empty', 'partial', 'needs_review']);
const ACTIONS = new Set(['next', 'retry', 'stop', 'pause']);

/** checkpoint始终只记录；hard缺证据与unknown均不能通过。 */
export function judgeActivityCheck(value) {
  const checks = value?.checks ?? value?.steps;
  if (Array.isArray(checks)) {
    const hard = checks.filter(check => check.mode !== 'checkpoint');
    const aggregate = hard.some(check => check.pass === false) ? 'fail'
      : hard.some(check => check.pass !== true) ? 'unknown' : 'pass';
    // checks只补充独立质量判词，不能把质量否决或未知升级为通过。
    const independent = Object.hasOwn(value ?? {}, 'verdict')
      ? ['pass', 'fail', 'unknown'].includes(value.verdict) ? value.verdict : 'unknown' : 'pass';
    const verdict = [independent, aggregate].includes('fail') ? 'fail'
      : [independent, aggregate].includes('unknown') ? 'unknown' : 'pass';
    return { ...value, checks, verdict };
  }
  return { ...value, verdict: ['pass', 'fail', 'unknown'].includes(value?.verdict) ? value.verdict : 'unknown' };
}

export function activityStatus(result) {
  if (result.status === 'completed') return 'done';
  return STATUSES.has(result.status) ? result.status : 'needs_review';
}

export function activityRoute(contract, activity, status, result, strict) {
  const routes = activity.runtime.on_status ?? activity.on_status ?? contract.on_status;
  if (routes) return ACTIONS.has(routes[status]) ? routes[status] : 'pause';
  if (status === 'done' || status === 'empty') return 'next';
  if (status === 'needs_review') return 'pause';
  if (status === 'retry') return 'retry';
  // 旧合同只把已登记的retryable类别交给原有限次重试；新合同由on_status接管。
  if (result.failure_class === 'retryable' && !strict) return 'retry';
  return activity.runtime.on_failure === 'continue' && !['fatal', 'needs_human'].includes(result.failure_class) ? 'next' : 'stop';
}

export function assertStatusRoutes(routes) {
  if (!routes || typeof routes !== 'object' || Array.isArray(routes)
    || Object.entries(routes).some(([status, route]) => !STATUSES.has(status) || !ACTIONS.has(route))
    || routes.needs_review !== 'pause') throw new Error('activity_status_routes_invalid');
}
