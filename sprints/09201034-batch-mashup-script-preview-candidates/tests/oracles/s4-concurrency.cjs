// DoD B-06 oracle：渲染并发上限=1，两个并发 enqueueRender 至少 1 个进 queued(position≥1)。
// 禁 mock 边：queue/worker 真调度、mashup_render_jobs 真落库；仅 mock 更外层 COS storage。
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
  const T = 'dod-b06-' + Date.now();
  const tmpl = await pool.query(
    "INSERT INTO zenithjoy.mashup_templates (tenant_id,name,slots) VALUES ($1,'t','[]'::jsonb) RETURNING id", [T]);
  const run = await pool.query(
    "INSERT INTO zenithjoy.mashup_runs (tenant_id,template_id,status) VALUES ($1,$2,'completed') RETURNING id",
    [T, tmpl.rows[0].id]);
  const rid = run.rows[0].id;
  const mkCand = async (n) => (await pool.query(
    "INSERT INTO zenithjoy.mashup_candidates (run_id,tenant_id,slot_fill,score,signature) VALUES ($1,$2,'{}'::jsonb,1,$3) RETURNING id",
    [rid, T, 'sig-' + n + '-' + Date.now()])).rows[0].id;
  const c1 = await mkCand(1);
  const c2 = await mkCand(2);

  const rs = await Promise.all([
    enqueueRender({ tenantId: T, candidateId: c1 }, { storage }),
    enqueueRender({ tenantId: T, candidateId: c2 }, { storage }),
  ]);
  const view = rs.map((r) => ({ s: r.renderStatus, p: r.queuePosition }));
  const queued = view.filter((x) => x.s === 'queued' && x.p >= 1);
  if (queued.length < 1) throw new Error('并发=1 未生效，无一进 queued≥1: ' + JSON.stringify(view));
  console.log('OK B-06 states=' + JSON.stringify(view));
  await pool.query('DELETE FROM zenithjoy.mashup_runs WHERE tenant_id=$1', [T]);
  await pool.query('DELETE FROM zenithjoy.mashup_templates WHERE tenant_id=$1', [T]);
})()
  .then(() => pool.end())
  .catch((e) => { console.error('FAIL ' + e.message); pool.end(); process.exit(1); });
