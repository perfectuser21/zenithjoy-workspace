/**
 * Ability Acceptance 路由
 * Sprint ID: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
 *
 * 端点（全部受 staffGuard 保护）：
 *   GET  /templates
 *   GET  /versions
 *   POST /runs
 *   GET  /runs
 *   GET  /runs/:runId
 *   POST /runs/:runId/devices/:deviceIndex/checks
 *   POST /runs/:runId/submit
 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staffGuard } from '../middleware/staff';
import db from '../db/connection';

const router = Router();

// 所有端点受 staffGuard 保护
router.use(staffGuard);

// 从请求头获取 tenant_id（X-Tenant-Id 头）
function getTenantId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-tenant-id'];
  return typeof raw === 'string' ? raw.trim() : 'default';
}

// 从请求头获取 user email
function getUserEmail(req: { headers: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers['x-user-email'];
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// GET /templates — 获取验收模板列表
router.get('/templates', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const result = await db.query(
      'SELECT * FROM acceptance_template WHERE tenant_id = $1 AND is_active = true ORDER BY seq',
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// GET /versions — 获取版本信息
router.get('/versions', async (req, res) => {
  try {
    // 版本来源优先级：env var → VERSION 文件 → Unknown
    const stagingVersion = process.env.STAGING_VERSION || readVersionFile() || 'Unknown';
    const productionVersion = process.env.PRODUCTION_VERSION || readVersionFile() || 'Unknown';

    res.json({
      success: true,
      data: {
        staging: { version: stagingVersion, source: process.env.STAGING_VERSION ? 'env:STAGING_VERSION' : 'file:VERSION' },
        production: { version: productionVersion, source: process.env.PRODUCTION_VERSION ? 'env:PRODUCTION_VERSION' : 'file:VERSION' },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

function readVersionFile(): string {
  try {
    const versionPath = resolve(process.cwd(), 'VERSION');
    const content = readFileSync(versionPath, 'utf8').trim();
    return content || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// POST /runs — 创建或复用验收 run（幂等）
router.post('/runs', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const userEmail = getUserEmail(req);
    const { app_id, line_id, surface, task_id, sha } = req.body || {};

    // 检查是否已存在
    const existing = await db.query(
      'SELECT run_id FROM acceptance_run WHERE tenant_id = $1 AND task_id = $2 AND sha = $3',
      [tenantId, task_id, sha]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        data: { run_id: existing.rows[0].run_id, created: false, status: 'in_progress' },
      });
    }

    // 创建新 run
    const result = await db.query(
      `INSERT INTO acceptance_run (tenant_id, app_id, line_id, surface, task_id, sha, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING run_id`,
      [tenantId, app_id, line_id, surface, task_id, sha, userEmail]
    );

    return res.json({
      success: true,
      data: { run_id: result.rows[0].run_id, created: true, status: 'in_progress' },
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// GET /runs — 获取运行列表（租户隔离）
router.get('/runs', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const result = await db.query(
      'SELECT * FROM acceptance_run WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// GET /runs/:runId — 获取单个 run 详情
router.get('/runs/:runId', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { runId } = req.params;

    const runResult = await db.query(
      'SELECT * FROM acceptance_run WHERE run_id = $1 AND tenant_id = $2',
      [runId, tenantId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Run 不存在' } });
    }

    // 查询设备结果
    const devicesResult = await db.query(
      'SELECT * FROM device_result WHERE run_id = $1 ORDER BY device_index',
      [runId]
    );

    const devices = await Promise.all(devicesResult.rows.map(async (device) => {
      const checksResult = await db.query(
        'SELECT * FROM check_result WHERE device_result_id = $1',
        [device.id]
      );
      return { ...device, checks: checksResult.rows };
    }));

    return res.json({
      success: true,
      data: { ...runResult.rows[0], devices },
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// POST /runs/:runId/devices/:deviceIndex/checks — 录入验收结果
router.post('/runs/:runId/devices/:deviceIndex/checks', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const userEmail = getUserEmail(req);
    const { runId, deviceIndex } = req.params;
    const deviceIdx = parseInt(deviceIndex, 10);

    // 校验 device_index 范围
    if (isNaN(deviceIdx) || deviceIdx < 1 || deviceIdx > 5) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'DEVICE_INDEX_OUT_OF_RANGE', message: 'device_index 必须在 1-5 之间' },
      });
    }

    const { template_id, result, evidence } = req.body || {};

    // 校验 result 值
    const validResults = ['PASS', 'FAIL', 'BLOCKED', 'pending'];
    if (!result || !validResults.includes(result)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'INVALID_RESULT', message: `result 必须是 ${validResults.join(', ')} 之一` },
      });
    }

    // 检查 run 是否存在且未提交
    const runResult = await db.query(
      'SELECT status FROM acceptance_run WHERE run_id = $1 AND tenant_id = $2',
      [runId, tenantId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Run 不存在' } });
    }

    if (runResult.rows[0].status === 'submitted') {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'RUN_ALREADY_SUBMITTED', message: '该 Run 已提交，无法修改' },
      });
    }

    // 确保 device_result 记录存在（upsert）
    const deviceResult = await db.query(
      `INSERT INTO device_result (run_id, tenant_id, device_index)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id, device_index) DO UPDATE SET device_index = EXCLUDED.device_index
       RETURNING id`,
      [runId, tenantId, deviceIdx]
    );

    const deviceResultId = deviceResult.rows[0].id;

    // 插入或更新检查结果
    await db.query(
      `INSERT INTO check_result (device_result_id, run_id, tenant_id, template_id, result, evidence, checked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (device_result_id, template_id) DO UPDATE SET result = EXCLUDED.result, evidence = EXCLUDED.evidence, updated_at = NOW()`,
      [deviceResultId, runId, tenantId, template_id, result, evidence || null, userEmail]
    );

    return res.json({ success: true, data: { updated: true } });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

// POST /runs/:runId/submit — 提交验收
router.post('/runs/:runId/submit', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { runId } = req.params;

    const runResult = await db.query(
      'SELECT status FROM acceptance_run WHERE run_id = $1 AND tenant_id = $2',
      [runId, tenantId]
    );

    if (runResult.rows.length === 0) {
      return res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Run 不存在' } });
    }

    if (runResult.rows[0].status === 'submitted') {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'RUN_ALREADY_SUBMITTED', message: '该 Run 已提交' },
      });
    }

    await db.query(
      'UPDATE acceptance_run SET status = $1, submitted_at = NOW() WHERE run_id = $2 AND tenant_id = $3',
      ['submitted', runId, tenantId]
    );

    return res.json({
      success: true,
      data: { run_id: runId, status: 'submitted' },
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  }
});

export { router as abilityAcceptanceRouter };
