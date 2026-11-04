import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { tenantBypass } from '../middleware/tenant-bypass';

interface DayData {
  date: string;
  day_n: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

const router = Router({ mergeParams: true });
const tenantMiddleware = [tenantContext, tenantBypass];

// GET /api/works/:id/performance
router.get('/', tenantMiddleware, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         pl.platform,
         ds.scraped_date AS date,
         (ds.scraped_date - pl.published_at::date)::integer AS day_n,
         ds.views, ds.likes, ds.comments, ds.shares, ds.saves
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.works w ON w.id = pl.work_id
       JOIN zenithjoy.daily_snapshots ds
         ON ds.platform = pl.platform
         AND ds.content_id = pl.platform_post_id
       WHERE pl.work_id = $1
         AND pl.platform_post_id IS NOT NULL
         AND ($2::boolean OR w.tenant_id = $3::uuid)
       ORDER BY pl.platform, ds.scraped_date`,
      [id, req.bypassTenant === true, req.tenantId || null]
    );

    const platforms: Record<string, DayData[]> = {};
    for (const row of result.rows) {
      const { platform, ...data } = row;
      if (!platforms[platform]) platforms[platform] = [];
      platforms[platform].push(data as DayData);
    }

    return res.json({ work_id: id, platforms });
  } catch (err) {
    console.error('work performance all-platforms error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

// GET /api/works/:id/performance/:platform
router.get('/:platform', tenantMiddleware, async (req: Request, res: Response) => {
  const { id, platform } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         pl.published_at,
         ds.scraped_date AS date,
         (ds.scraped_date - pl.published_at::date)::integer AS day_n,
         ds.views, ds.likes, ds.comments, ds.shares, ds.saves
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.works w ON w.id = pl.work_id
       JOIN zenithjoy.daily_snapshots ds
         ON ds.platform = pl.platform
         AND ds.content_id = pl.platform_post_id
       WHERE pl.work_id = $1
         AND pl.platform = $2
         AND pl.platform_post_id IS NOT NULL
         AND ($3::boolean OR w.tenant_id = $4::uuid)
       ORDER BY ds.scraped_date`,
      [id, platform, req.bypassTenant === true, req.tenantId || null]
    );

    const published_at = result.rows[0]?.published_at ?? null;
    const data = result.rows.map(({ published_at: _pa, ...rest }) => rest);

    return res.json({ work_id: id, platform, published_at, data });
  } catch (err) {
    console.error('work performance single-platform error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

export default router;
