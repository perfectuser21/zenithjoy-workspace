// DoD B-07 / INV-3 oracle：渲染失败 → 作业落 render_failed（可重试非死路）；
// 安全未通过时 contents.export_url 恒为 NULL（fail-closed，沿用 S4 不动）。
// 素材源不可达 → 下载失败 → 渲染失败路径。禁 mock 边：render_jobs 真落库、worker 真跑。
// 从仓库根运行：DATABASE_URL="$DB_URL" node <this>
const pool = require('../../../../apps/api/dist/db/connection.js').default;
const { enqueueRender } = require('../../../../apps/api/dist/services/mashup-render-queue.js');

const storage = {
  getSignedUrl: async () => 'http://127.0.0.1:1/none',
  putObject: async () => {},
  deleteObject: async () => {},
  presignPut: async () => '',
  headObject: async () => null,
};

(async () => {
  const T = 'dod-b07-' + Date.now();
  const tmpl = await pool.query(
    "INSERT INTO zenithjoy.mashup_templates (tenant_id,name,slots) VALUES ($1,'t','[]'::jsonb) RETURNING id", [T]);
  const run = await pool.query(
    "INSERT INTO zenithjoy.mashup_runs (tenant_id,template_id,status) VALUES ($1,$2,'completed') RETURNING id",
    [T, tmpl.rows[0].id]);
  const cand = await pool.query(
    "INSERT INTO zenithjoy.mashup_candidates (run_id,tenant_id,slot_fill,score,signature) VALUES ($1,$2,'{}'::jsonb,1,$3) RETURNING id",
    [run.rows[0].id, T, 'sig-fail-' + Date.now()]);
  const cid = cand.rows[0].id;

  const j = await enqueueRender({ tenantId: T, candidateId: cid }, { storage });
  const jobId = j.jobId;
  if (!jobId) throw new Error('enqueueRender 未返回 jobId');

  const deadline = Date.now() + 60000;
  let st = '';
  while (Date.now() < deadline) {
    const q = await pool.query('SELECT status FROM zenithjoy.mashup_render_jobs WHERE id=$1', [jobId]);
    st = q.rows[0] && q.rows[0].status;
    if (st === 'render_failed' || st === 'rendered') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (st !== 'render_failed') throw new Error('within 60s 期望 render_failed, 实际=' + st);
  const bad = await pool.query(
    "SELECT count(*)::int n FROM zenithjoy.contents WHERE tenant_id=$1 AND safety_check_status<>'passed' AND export_url IS NOT NULL",
    [T]);
  if (bad.rows[0].n !== 0) throw new Error('INV-3 违反：安全未过却给了 export_url');
  console.log('OK B-07 render_failed 可重试 + fail-closed 保持');
  await pool.query('DELETE FROM zenithjoy.mashup_runs WHERE tenant_id=$1', [T]);
  await pool.query('DELETE FROM zenithjoy.mashup_templates WHERE tenant_id=$1', [T]);
  await pool.query('DELETE FROM zenithjoy.contents WHERE tenant_id=$1', [T]);
})()
  .then(() => pool.end())
  .catch((e) => { console.error('FAIL ' + e.message); pool.end(); process.exit(1); });
