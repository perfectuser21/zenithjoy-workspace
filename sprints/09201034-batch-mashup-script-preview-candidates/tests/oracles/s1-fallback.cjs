// DoD B-01 / INV-2 / INV-4 oracle：无 TOAPIS key → 文案分段静默降级固定模板，
// 落库 tenant 归属=凭据租户，且不落 failed_pending_review 阻断态（非阻断）。
// 从仓库根运行：DATABASE_URL="$DB_URL" node <this>
const pool = require('../../../../apps/api/dist/db/connection.js').default;
const { generateTemplateFromScript } = require('../../../../apps/api/dist/services/mashup-script-template.js');

(async () => {
  const T = 'dod-b01-' + Date.now();
  delete process.env.TOAPIS_API_KEY;
  const r = await generateTemplateFromScript({ tenantId: T, script: '开场钩子，产品特写，引导下单' });
  if (!r || !r.templateId) throw new Error('无 templateId');
  if (!Array.isArray(r.segments) || r.segments.length < 1) throw new Error('segments 不合法');
  if (r.fallbackUsed !== true) throw new Error('无 key 时应 fallbackUsed=true, 实际=' + r.fallbackUsed);
  const row = await pool.query('SELECT tenant_id FROM zenithjoy.mashup_templates WHERE id=$1', [r.templateId]);
  if (!row.rows[0] || row.rows[0].tenant_id !== T) throw new Error('模板 tenant_id 非凭据租户 (INV-2)');
  const blk = await pool.query(
    "SELECT count(*)::int n FROM zenithjoy.contents WHERE tenant_id=$1 AND status='failed_pending_review'",
    [T],
  );
  if (blk.rows[0].n !== 0) throw new Error('INV-4 违反：Step1 落了 failed_pending_review 阻断态');
  console.log('OK B-01 templateId=' + r.templateId + ' fallbackUsed=' + r.fallbackUsed);
  await pool.query('DELETE FROM zenithjoy.mashup_templates WHERE tenant_id=$1', [T]);
})()
  .then(() => pool.end())
  .catch((e) => { console.error('FAIL ' + e.message); pool.end(); process.exit(1); });
