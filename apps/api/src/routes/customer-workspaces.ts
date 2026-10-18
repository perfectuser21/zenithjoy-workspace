// 内部开户资源面。租户不可凭自报company/parent更改投影目标。
import { Router } from 'express';
import pool from '../db/connection';
import { internalAuth } from '../middleware/internal-auth';
import { workspaceTemplate, normalizeWorkspaceParent, WORKSPACE_TEMPLATE_VERSION, type WorkspaceState } from '../services/customer-workspace';

export const customerWorkspacesRouter = Router();
customerWorkspacesRouter.use((req, res, next) => {
  if (!process.env.ZENITHJOY_INTERNAL_TOKEN) { res.status(503).json({ success: false, error: 'WORKSPACE_SERVICE_AUTH_UNCONFIGURED' }); return; }
  internalAuth(req, res, next);
});
customerWorkspacesRouter.get('/template', (req, res) => {
  const modules = req.query.module === 'leadgen' ? ['leadgen'] : [];
  res.json({ success: true, data: { template_version: WORKSPACE_TEMPLATE_VERSION, objects: workspaceTemplate(modules) } });
});
customerWorkspacesRouter.get('/:companyId', async (req, res) => {
  try {
    const result = await pool.query('SELECT company_id,tenant_id,platform,parent_id,template_version,modules,status,state,updated_at FROM zenithjoy.customer_workspaces WHERE company_id=$1', [req.params.companyId]);
    res.json({ success: true, data: result.rows });
  } catch { res.status(500).json({ success: false, error: 'WORKSPACE_READ_FAILED' }); }
});
customerWorkspacesRouter.post('/:companyId/bind', async (req, res) => {
  const body = req.body ?? {}, platform = body.platform;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(req.params.companyId) || !uuid.test(body.tenant_id ?? '') || !['notion', 'feishu'].includes(platform) || typeof body.parent_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.parent_id) || body.approved_parent !== true) {
    res.status(400).json({ success: false, error: 'EXPLICIT_APPROVED_WORKSPACE_BINDING_REQUIRED' }); return;
  }
  let definitions;
  let parentId: string;
  try { definitions = workspaceTemplate(body.modules ?? []); parentId = normalizeWorkspaceParent(platform, body.parent_id); }
  catch { res.status(400).json({ success: false, error: 'INVALID_MODULES' }); return; }
  if (body.credential_ref !== undefined && (typeof body.credential_ref !== 'string' || !new RegExp(`^CUSTOMER_WORKSPACE_${String(platform).toUpperCase()}_[A-Z0-9_]{1,100}$`).test(body.credential_ref))) {
    res.status(400).json({ success: false, error: 'WORKSPACE_CREDENTIAL_REFERENCE_INVALID' }); return;
  }
  let client;
  try { client = await pool.connect(); }
  catch { res.status(503).json({ success: false, error: 'WORKSPACE_DATABASE_UNAVAILABLE' }); return; }
  try {
    await client.query('BEGIN');
    const profile = (await client.query('SELECT company_id,tenant_id,company_name FROM zenithjoy.tenant_company_profiles WHERE company_id=$1 AND tenant_id=$2 FOR SHARE', [req.params.companyId, body.tenant_id])).rows[0];
    if (!profile) { await client.query('ROLLBACK'); res.status(404).json({ success: false, error: 'COMPANY_TENANT_MISMATCH' }); return; }
    const state: WorkspaceState = { ...profile, platform, parent_id: parentId, template_version: WORKSPACE_TEMPLATE_VERSION, modules: body.modules ?? [], ...(body.credential_ref ? { credential_ref: body.credential_ref } : {}), status: 'pending', resources: {}, data_sync_status: 'not_connected' };
    await client.query('INSERT INTO zenithjoy.customer_workspaces(company_id,tenant_id,platform,parent_id,template_version,modules,state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) ON CONFLICT(company_id,platform) DO NOTHING', [profile.company_id, profile.tenant_id, platform, state.parent_id, state.template_version, JSON.stringify(state.modules), JSON.stringify(state)]);
    const existing = (await client.query('SELECT state FROM zenithjoy.customer_workspaces WHERE company_id=$1 AND tenant_id=$2 AND platform=$3 FOR UPDATE', [profile.company_id, profile.tenant_id, platform])).rows[0]?.state as WorkspaceState | undefined;
    if (!existing || existing.parent_id !== state.parent_id || JSON.stringify(existing.modules) !== JSON.stringify(state.modules) || existing.template_version !== state.template_version || existing.credential_ref !== state.credential_ref) {
      await client.query('ROLLBACK'); res.status(409).json({ success: false, error: 'WORKSPACE_BINDING_CONFLICT' }); return;
    }
    await client.query('INSERT INTO zenithjoy.customer_workspace_events(company_id,tenant_id,platform,actor,state) VALUES($1,$2,$3,$4,$5::jsonb)', [profile.company_id, profile.tenant_id, platform, 'internal-service:workspace-binding', JSON.stringify(existing)]);
    await client.query('COMMIT');
    res.status(202).json({ success: true, data: { ...existing, object_count: definitions.length, worker_enabled: process.env.CUSTOMER_WORKSPACE_PROVISIONING_ENABLED === 'true' } });
  } catch (error) {
    await client.query('ROLLBACK');
    const duplicate = (error as { code?: string }).code === '23505';
    res.status(duplicate ? 409 : 500).json({ success: false, error: duplicate ? 'WORKSPACE_PARENT_ALREADY_BOUND' : 'WORKSPACE_BIND_FAILED' });
  } finally { client.release(); }
});
customerWorkspacesRouter.post('/:companyId/reconcile', async (req, res) => {
  const body = req.body ?? {};
  if (!['notion', 'feishu'].includes(body.platform) || typeof body.expected_updated_at !== 'string') {
    res.status(400).json({ success: false, error: 'WORKSPACE_REVISION_REQUIRED' }); return;
  }
  try {
    // 只恢复检查；逐资产创建意图仍保留，找不到未决目标就再次停住。
    const result = await pool.query("WITH changed AS (UPDATE zenithjoy.customer_workspaces SET status='pending',state=jsonb_set(state,'{status}','\"pending\"'::jsonb),updated_at=now() WHERE company_id=$1 AND platform=$2 AND updated_at=$3::timestamptz AND status='needs_reconciliation' RETURNING company_id,tenant_id,platform,status,state) INSERT INTO zenithjoy.customer_workspace_events(company_id,tenant_id,platform,actor,state) SELECT company_id,tenant_id,platform,'internal-service:workspace-reconcile',state FROM changed RETURNING company_id,platform,'pending' AS status", [req.params.companyId, body.platform, body.expected_updated_at]);
    if (result.rowCount !== 1) { res.status(409).json({ success: false, error: 'WORKSPACE_REVISION_CONFLICT' }); return; }
    res.status(202).json({ success: true, data: result.rows[0] });
  } catch { res.status(500).json({ success: false, error: 'WORKSPACE_RECONCILE_FAILED' }); }
});
