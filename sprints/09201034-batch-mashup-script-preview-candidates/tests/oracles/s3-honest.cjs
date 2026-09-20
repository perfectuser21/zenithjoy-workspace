// DoD B-04 / INV-1 oracle：候选诚实计数——generatedCount == candidates.length == DB落库数
// 且 ≤ targetCount（不凑数、不承诺死数字）。用无 assigned 槽位的 run 做快速恒等校验
// （不触发 embedding 模型），核心是 generatedCount 字段与三方一致，不放大。
// 从仓库根运行：DATABASE_URL="$DB_URL" node <this>
const pool = require('../../../../apps/api/dist/db/connection.js').default;
const { generateCandidates } = require('../../../../apps/api/dist/services/mashup-candidate-generation.js');

(async () => {
  const T = 'dod-b04-' + Date.now();
  const tmpl = await pool.query(
    "INSERT INTO zenithjoy.mashup_templates (tenant_id,name,slots) VALUES ($1,'dod-tmpl',$2::jsonb) RETURNING id",
    [T, JSON.stringify([{ key: 'hook', required: true, match_tags: ['开场'] }])],
  );
  const run = await pool.query(
    "INSERT INTO zenithjoy.mashup_runs (tenant_id,template_id,status) VALUES ($1,$2,'completed') RETURNING id",
    [T, tmpl.rows[0].id],
  );
  const rid = run.rows[0].id;
  // 无 assigned 槽位（reshoot_skipped）→ 无 embedding 调用，快速
  await pool.query(
    "INSERT INTO zenithjoy.mashup_slot_assignments (run_id,slot_key,status,reason) VALUES ($1,'hook','reshoot_skipped','x')",
    [rid],
  );
  const r = await generateCandidates({ tenantId: T, runId: rid, targetCount: 200 });
  if (typeof r.generatedCount !== 'number') throw new Error('缺 generatedCount 字段 (INV-1 诚实展示)');
  if (r.generatedCount !== r.candidates.length) throw new Error('generatedCount != candidates.length');
  if (r.candidates.length > 200) throw new Error('候选数 > targetCount');
  const db = await pool.query('SELECT count(*)::int n FROM zenithjoy.mashup_candidates WHERE run_id=$1', [rid]);
  if (db.rows[0].n !== r.candidates.length) throw new Error('DB 落库数 != 返回数');
  console.log('OK B-04 generatedCount=' + r.generatedCount + ' == length == db (诚实)');
  await pool.query('DELETE FROM zenithjoy.mashup_runs WHERE tenant_id=$1', [T]);
  await pool.query('DELETE FROM zenithjoy.mashup_templates WHERE tenant_id=$1', [T]);
})()
  .then(() => pool.end())
  .catch((e) => { console.error('FAIL ' + e.message); pool.end(); process.exit(1); });
