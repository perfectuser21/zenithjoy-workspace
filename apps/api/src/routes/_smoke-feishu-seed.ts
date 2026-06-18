/**
 * Path 2 Sprint A WS5: DEV-only 飞书 seed helper
 *
 * 端点：POST /api/_smoke/feishu-seed
 * 双门禁：
 *   1. process.env.NODE_ENV !== 'production'  否则 404
 *   2. X-Smoke-Token 必须等 process.env.SMOKE_TOKEN（默认 'smoke-secret-2026'）  否则 403
 *
 * 内部不直接 INSERT DB — 调业务层 writeRecord(tenantId, tableId, fields)，让飞书层调用链保留。
 * 这样 CI 模式下：helper → writeRecord → axios.post(${FEISHU_API_BASE}/...) → fake-feishu-server。
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  writeRecord,
  fetchLeadConfig,
} from '../services/feishu-bitable-multitenant';
import pool from '../db/connection';

const router = Router();

const EXPECTED_SMOKE_TOKEN = process.env.SMOKE_TOKEN || 'smoke-secret-2026';

// 门禁中间件：NODE_ENV=production 一律 404；缺/错 X-Smoke-Token → 403
router.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
  }
  const tok = req.header('X-Smoke-Token');
  if (!tok || tok !== EXPECTED_SMOKE_TOKEN) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

// POST /api/_smoke/feishu-seed
// body: { tenant_id, profile: {industry, keyword, hook}, target_videos: [{url, note}] }
router.post('/feishu-seed', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  const profile = req.body?.profile || {};
  const targetVideos = req.body?.target_videos || [];

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 取 binding 拿到 table_id_lead_profile + table_id_target_videos
    const r = await pool.query(
      `SELECT table_id_lead_profile, table_id_target_videos
         FROM zenithjoy.tenant_feishu_bindings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'FEISHU_NOT_BOUND', message: '未绑飞书' },
        timestamp: new Date().toISOString(),
      });
    }
    const { table_id_lead_profile, table_id_target_videos } = r.rows[0];

    if (table_id_lead_profile && (profile.industry || profile.keyword || profile.hook)) {
      await writeRecord(tenantId, table_id_lead_profile, {
        行业: profile.industry || '',
        关键词: profile.keyword || '',
        钩子文案: profile.hook || '',
      });
    }

    for (const v of targetVideos as Array<{ url: string; note?: string }>) {
      if (!v.url) continue;
      if (!table_id_target_videos) break;
      await writeRecord(tenantId, table_id_target_videos, {
        '视频 URL': v.url,
        备注: v.note || '',
        添加时间: new Date().toISOString(),
      });
    }

    // 顺手 fetchLeadConfig 让 fake-feishu-server 缓存的内存数据立刻可读（验证用）
    let snapshot = null;
    try {
      snapshot = await fetchLeadConfig(tenantId);
    } catch {
      // ignore — seed 已写入即可
    }

    return res.json({
      success: true,
      data: { seeded: true, snapshot },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SEED_FAILED', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
export { router };

// ============================================================================
// Path 2 Step4 — DEV-only fake-feishu 替身（apps/api 内自托管，FEISHU_API_BASE 指向本服务）
//
// 复刻飞书核心面（token / bitable apps·tables·records / docx 建·读）+ 测试控制面：
//   POST /__test/set-doc          设置企业信息 docx 纯文本（按 doc_token）
//   POST /__test/set-write-mode   切换写表 mode（ok | fail），控制 lead_write_status success/pending
//   GET  /__test/seen-records     按 table_id 查所有写入记录（验证抖音号写进飞书）
//   POST /__test/reset            清空 seen + writeMode 复位（多次跑防串扰）
//
// 仅在 NODE_ENV!=production 时由 app.ts 条件挂载（生产走真飞书，FEISHU_API_BASE 不指向此处）。
// ============================================================================
import { randomBytes } from 'crypto';

const fakeFeishuRouter = Router();

interface FakeRecord {
  record_id: string;
  fields: Record<string, unknown>;
}
const docStore: Record<string, string> = {};                       // doc_token -> 纯文本
const recordStore: Record<string, Record<string, FakeRecord[]>> = {}; // app_token -> table_id -> records
const seenRecords: Record<string, FakeRecord[]> = {};              // table_id -> records（跨 app_token）
let writeMode: 'ok' | 'fail' = 'ok';

function rid(prefix: string): string {
  return prefix + randomBytes(8).toString('hex');
}

// ── 飞书 token ──
fakeFeishuRouter.post('/open-apis/auth/v3/tenant_access_token/internal', (_req: Request, res: Response) => {
  res.json({ code: 0, msg: 'success', tenant_access_token: 'fake_t_' + Date.now(), expire: 7200 });
});

// ── 建 Bitable ──
fakeFeishuRouter.post('/open-apis/bitable/v1/apps', (_req: Request, res: Response) => {
  const appToken = rid('bascn');
  recordStore[appToken] = {};
  res.json({ code: 0, msg: 'success', data: { app: { app_token: appToken, name: 'fake-app' } } });
});

// ── 建 Table ──
fakeFeishuRouter.post('/open-apis/bitable/v1/apps/:appToken/tables', (req: Request, res: Response) => {
  const { appToken } = req.params;
  if (!recordStore[appToken]) recordStore[appToken] = {};
  const tableId = rid('tbl');
  recordStore[appToken][tableId] = [];
  res.json({ code: 0, msg: 'success', data: { table_id: tableId } });
});

// ── 写 / 读 records ──
fakeFeishuRouter.post(
  '/open-apis/bitable/v1/apps/:appToken/tables/:tableId/records',
  (req: Request, res: Response) => {
    if (writeMode === 'fail') {
      return res.json({ code: 1254000, msg: 'fake write fail (mode=fail)' });
    }
    const { appToken, tableId } = req.params;
    const fields = req.body?.fields || {};
    if (!recordStore[appToken]) recordStore[appToken] = {};
    if (!recordStore[appToken][tableId]) recordStore[appToken][tableId] = [];
    const record: FakeRecord = { record_id: rid('rec'), fields };
    recordStore[appToken][tableId].push(record);
    if (!seenRecords[tableId]) seenRecords[tableId] = [];
    seenRecords[tableId].push(record);
    return res.json({ code: 0, msg: 'success', data: { record } });
  }
);
fakeFeishuRouter.get(
  '/open-apis/bitable/v1/apps/:appToken/tables/:tableId/records',
  (req: Request, res: Response) => {
    const { appToken, tableId } = req.params;
    const items = (recordStore[appToken]?.[tableId] || []).map((r) => ({
      record_id: r.record_id,
      fields: r.fields,
    }));
    res.json({ code: 0, msg: 'success', data: { items, total: items.length, has_more: false } });
  }
);

// ── docx 建 / 读纯文本 ──
fakeFeishuRouter.post('/open-apis/docx/v1/documents', (_req: Request, res: Response) => {
  const docToken = rid('doccn');
  docStore[docToken] = docStore[docToken] || '';
  res.json({ code: 0, msg: 'success', data: { document: { document_id: docToken } } });
});
fakeFeishuRouter.get('/open-apis/docx/v1/documents/:docToken/raw_content', (req: Request, res: Response) => {
  const { docToken } = req.params;
  res.json({ code: 0, msg: 'success', data: { content: docStore[docToken] ?? '' } });
});

// ── 测试控制面 ──
fakeFeishuRouter.post('/__test/set-doc', (req: Request, res: Response) => {
  const { doc_token, text } = req.body || {};
  if (!doc_token) return res.status(400).json({ ok: false, error: 'doc_token required' });
  docStore[doc_token] = typeof text === 'string' ? text : '';
  return res.json({ ok: true });
});
fakeFeishuRouter.post('/__test/set-write-mode', (req: Request, res: Response) => {
  const mode = req.body?.mode;
  if (mode === 'ok' || mode === 'fail') {
    writeMode = mode;
    return res.json({ ok: true, mode: writeMode });
  }
  return res.status(400).json({ ok: false, error: 'mode must be ok|fail' });
});
fakeFeishuRouter.get('/__test/seen-records', (req: Request, res: Response) => {
  const tableId = String(req.query.table_id || '');
  const items = seenRecords[tableId] || [];
  res.json({ count: items.length, records: items.map((r) => r.fields) });
});
fakeFeishuRouter.post('/__test/reset', (_req: Request, res: Response) => {
  for (const k of Object.keys(seenRecords)) delete seenRecords[k];
  writeMode = 'ok';
  res.json({ ok: true, reset: true });
});

export { fakeFeishuRouter };
