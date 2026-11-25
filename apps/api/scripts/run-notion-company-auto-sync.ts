import type { CompanyJsonRecord } from '../src/routes/company-profile-validation';

const [mode, companyId] = process.argv.slice(2);
if (!['--inspect', '--once', '--watch'].includes(mode) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(companyId ?? '')) {
  throw Error('用法: run-notion-company-auto-sync --inspect|--once|--watch <company UUID>');
}

// 运行机以现有业务库的固定凭据注入连接串；仅本进程把它转换为共用连接模块的参数。
const db = new URL(process.env.DATABASE_URL ?? '');
if (!['postgresql:', 'postgres:'].includes(db.protocol) || !db.hostname || !db.username ||
    !db.pathname.slice(1) || db.search || db.hash) throw Error('需要明确且不带连接选项的 PostgreSQL 目标');
Object.assign(process.env, {
  DATABASE_HOST: db.hostname,
  DATABASE_PORT: db.port || '5432',
  DATABASE_NAME: decodeURIComponent(db.pathname.slice(1)),
  DATABASE_USER: decodeURIComponent(db.username),
  DATABASE_PASSWORD: decodeURIComponent(db.password),
});

async function main() {
  const { default: pool } = await import('../src/db/connection');

  async function cycle() {
    const identity = (await pool.query('SELECT current_database() AS database')).rows[0];
    const result = await pool.query<CompanyJsonRecord>(`SELECT p.company_id,p.tenant_id,p.config_version,w.state
      FROM zenithjoy.tenant_company_profiles p LEFT JOIN zenithjoy.customer_workspaces w
        ON p.company_id=w.company_id AND p.tenant_id=w.tenant_id AND w.platform='notion' AND w.status='structure_ready'
      WHERE p.company_id=$1 AND p.config_status='enabled'`, [companyId]);
    const workspace = result.rows[0];
    const registered = Boolean(workspace?.state);
    const state = workspace?.state as { notion_auto_sync?: { enabled?: boolean } } | undefined;
    const enabled = state?.notion_auto_sync?.enabled === true;
    if (mode === '--inspect') {
      console.log(JSON.stringify({ database: identity.database, companyId, registered, enabled, configVersion: workspace?.config_version ?? null }));
      return;
    }
    if (!registered || !enabled) throw Error('公司 Notion 自动同步未登记或未启用');
    const { syncNotionCompanyChanges } = await import('../src/services/notion-company-source-worker');
    const { companySnapshot } = await import('../src/routes/company-profile');
    await syncNotionCompanyChanges(workspace, companySnapshot);
  }

  try {
    if (mode !== '--watch') {
      await cycle();
      return;
    }
    for (;;) {
      try { await cycle(); }
      catch { console.error('[notion-company-source] 本轮同步失败，继续保留已启用资料'); }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  } finally { await pool.end(); }
}

void main().catch(() => {
  console.error('[notion-company-source] 无法核验或执行指定公司的同步');
  process.exitCode = 1;
});
