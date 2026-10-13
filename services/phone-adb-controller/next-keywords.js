// 101关键词来自已启用公司配置；冻结后本次运行不会随配置修改而漂移。
'use strict';
const { freezeCompanyConfig } = require('./company-config-lib.js');
const { isKeywordEnabled } = require('./keyword-enabled-lib.js');
const { configEvidence } = require('./judge-video.js');
function selectCompanyKeywords(snapshot, limit) {
  const strategy = snapshot.runtime_config?.search_strategy;
  if (!Array.isArray(strategy?.keywords)) throw Error('COMPANY_SEARCH_KEYWORDS_REQUIRED');
  const words = strategy.keywords.filter(k => typeof k === 'string' || k.enabled === true || isKeywordEnabled(k.enabled))
    .map(k => typeof k === 'string' ? k : k.word).filter(w => typeof w === 'string' && w.trim());
  if (!words.length) throw Error('COMPANY_SEARCH_KEYWORDS_REQUIRED');
  return [...new Set(words)].slice(0, Math.max(1, Math.min(12, Number(limit) || 2)));
}
async function companyKeywords(pool, { lineHint, runId, limit, keywords }, deps = {}) {
  const requestedLimit = limit === undefined ? 2 : Number(limit);
  if (!Number.isSafeInteger(requestedLimit)) throw Error('COMPANY_SEARCH_LIMIT_INVALID');
  const normalizedLimit = Math.max(1,Math.min(12,requestedLimit));
  if (keywords !== undefined && (!Array.isArray(keywords) || !keywords.length || keywords.length > 100 || keywords.some(w => typeof w !== 'string' || !w.trim() || w.length > 200))) throw Error('COMPANY_TASK_KEYWORDS_INVALID');
  const taskKeywords = keywords === undefined ? null : [...new Set(keywords.map(w=>w.trim()))];
  const snapshot = await (deps.freezeCompanyConfig || freezeCompanyConfig)(pool, { lineHint, runId, taskInputs: {keywords:taskKeywords,limit:normalizedLimit}, step: '101' });
  const selected = taskKeywords || selectCompanyKeywords(snapshot, normalizedLimit);
  return { keywords: selected, config: {...configEvidence(snapshot, runId), keyword_source: keywords === undefined ? 'company_config' : 'task', keywords: selected} };
}
async function main() {
  const pool = require('./leadgen-db-connect.js').getPool();
  try {
    const result = await companyKeywords(pool, { lineHint: process.argv[2], limit: process.argv[3], runId: process.argv[4] });
    for (const word of result.keywords) console.log(word);
    console.error(JSON.stringify({ config: result.config }));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { companyKeywords, selectCompanyKeywords };
