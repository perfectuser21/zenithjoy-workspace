import pool from '../db/connection';
import { provisionWorkspace, type WorkspaceState } from './customer-workspace';
import { createWorkspaceAdapter } from './customer-workspace-adapters';

export async function provisionRegisteredWorkspace(companyId: string, platform: string): Promise<void> {
  const client = await pool.connect(), lock = `customer-workspace:${companyId}:${platform}`;
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lock])).rows[0]?.locked === true;
    if (!locked) return;
    const result = await client.query('SELECT w.state,p.company_name FROM zenithjoy.customer_workspaces w JOIN zenithjoy.tenant_company_profiles p ON p.company_id=w.company_id AND p.tenant_id=w.tenant_id WHERE w.company_id=$1 AND w.platform=$2', [companyId, platform]);
    if (!result.rows[0]) throw Error('workspace binding missing');
    const state = result.rows[0].state as WorkspaceState;
    const token = state.credential_ref ? process.env[state.credential_ref] : state.platform === 'notion' ? process.env.NOTION_INTEGRATION_TOKEN : process.env.FEISHU_TENANT_ACCESS_TOKEN;
    if (!token) throw Error('workspace platform credential missing');
    const adapter = createWorkspaceAdapter(state.platform, token);
    const save = async (next: WorkspaceState) => {
      await client.query('BEGIN');
      try {
        const update = await client.query('UPDATE zenithjoy.customer_workspaces SET status=$1,state=$2::jsonb,updated_at=now() WHERE company_id=$3 AND tenant_id=$4 AND platform=$5 AND parent_id=$6 RETURNING company_id', [next.status, JSON.stringify(next), state.company_id, state.tenant_id, state.platform, state.parent_id]);
        if (update.rowCount !== 1) throw Error('workspace binding changed');
        await client.query('INSERT INTO zenithjoy.customer_workspace_events(company_id,tenant_id,platform,actor,state) VALUES($1,$2,$3,$4,$5::jsonb)', [state.company_id, state.tenant_id, state.platform, 'customer-workspace-provisioner', JSON.stringify(next)]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    };
    await provisionWorkspace({ ...state, company_name: result.rows[0].company_name }, state, adapter, save);
  } catch (error) {
    if (locked) await client.query("UPDATE zenithjoy.customer_workspaces SET status='needs_reconciliation',state=state || $3::jsonb,updated_at=now() WHERE company_id=$1 AND platform=$2 AND status IN ('pending','provisioning','needs_reconciliation')", [companyId, platform, JSON.stringify({ status: 'needs_reconciliation', failure: { message: error instanceof Error ? error.message : 'workspace provisioning failed', checked_at: new Date().toISOString() } })]);
    throw error;
  } finally {
    let destroy = false;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]); }
    catch { destroy = true; }
    finally { client.release(destroy); }
  }
}

let running = false;
export async function tickCustomerWorkspaces(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // 未决任务必须由操作员显式重试；不自动重发未知创建。
    const result = await pool.query("SELECT company_id,platform FROM zenithjoy.customer_workspaces WHERE status IN ('pending','provisioning') ORDER BY updated_at LIMIT 2");
    for (const row of result.rows) {
      try { await provisionRegisteredWorkspace(row.company_id, row.platform); }
      catch { console.warn('[customer-workspace] provision failed; inspect binding checkpoint'); }
    }
  } finally { running = false; }
}
export function startCustomerWorkspaceWorker(): NodeJS.Timeout | undefined {
  if (process.env.CUSTOMER_WORKSPACE_PROVISIONING_ENABLED !== 'true') return;
  const timer = setInterval(() => { void tickCustomerWorkspaces().catch(() => console.warn('[customer-workspace] tick failed')); }, 30000);
  timer.unref(); return timer;
}
