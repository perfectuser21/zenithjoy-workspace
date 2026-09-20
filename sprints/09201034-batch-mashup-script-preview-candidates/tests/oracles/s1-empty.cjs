// DoD B-02 oracle：空 script 被拒绝（INVALID_BODY 语义），拒绝先于触碰 DB。
// 从仓库根运行：node <this>
const { generateTemplateFromScript } = require('../../../../apps/api/dist/services/mashup-script-template.js');
let pool = null;
try { pool = require('../../../../apps/api/dist/db/connection.js').default; } catch (_) { /* ignore */ }

(async () => {
  let rejected = false;
  try {
    await generateTemplateFromScript({ tenantId: 'dod-b02', script: '' });
  } catch (e) {
    rejected = /INVALID_BODY|script/i.test(e.message);
  }
  if (!rejected) throw new Error('空 script 未被拒绝');
  console.log('OK B-02 空 script 被拒绝');
})()
  .then(() => { if (pool) pool.end(); process.exit(0); })
  .catch((e) => { console.error('FAIL ' + e.message); if (pool) pool.end(); process.exit(1); });
