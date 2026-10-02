
'use strict';
function validateExecution(execution) {
  if (execution === undefined) return;
  if (!execution || typeof execution !== 'object' || Array.isArray(execution)) throw Error('执行上下文非法');
  if (!Object.hasOwn(execution, 'gateway')) return;
  const g = execution.gateway;
  const absolute = v => typeof v === 'string' && v.startsWith('/') && !/[\x00-\x1f\x7f]/.test(v) && !v.split('/').includes('..');
  if (!g || typeof g !== 'object' || Array.isArray(g)
      || typeof g.host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$/.test(g.host)
      || !absolute(g.cwd) || (g.node !== undefined && (!absolute(g.node) || !/^\/[A-Za-z0-9_./-]+$/.test(g.node)))
      || (g.env_file !== undefined && (!absolute(g.env_file) || !/^\/[A-Za-z0-9_./-]+\/\.credentials\/[A-Za-z0-9_.-]+\.env$/.test(g.env_file)))) throw Error('网关上下文非法');
}
module.exports = { validateExecution };
