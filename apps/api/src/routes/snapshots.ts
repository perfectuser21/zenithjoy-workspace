import { Router, Request, Response } from 'express';
import pool from '../db/connection';

const router = Router();

// POST /api/snapshots/ingest
// 西安爬虫采完数据后直接 POST 到这里
router.post('/ingest', async (req: Request, res: Response) => {
  const { platform, items } = req.body;

  if (!platform || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'platform 和 items[] 为必填项',
    });
  }

  const validPlatforms = ['douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'toutiao', 'zhihu', 'channels', 'wechat'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({
      success: false,
      error: `platform 必须是: ${validPlatforms.join(', ')}`,
    });
  }

  try {
    let inserted = 0;
    let skipped = 0;

    for (const item of items) {
      const { content_id, scraped_date, scraped_at, title, views, likes, comments, shares, extra_data } = item;

      if (!content_id || !scraped_date) continue;

      const result = await pool.query(
        `INSERT INTO zenithjoy.daily_snapshots
          (platform, content_id, scraped_date, scraped_at, title, views, likes, comments, shares, extra_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (platform, content_id, scraped_date) DO UPDATE SET
           scraped_at  = EXCLUDED.scraped_at,
           title       = COALESCE(EXCLUDED.title, zenithjoy.daily_snapshots.title),
           views       = EXCLUDED.views,
           likes       = EXCLUDED.likes,
           comments    = EXCLUDED.comments,
           shares      = EXCLUDED.shares,
           extra_data  = COALESCE(EXCLUDED.extra_data, zenithjoy.daily_snapshots.extra_data)
         RETURNING id`,
        [
          platform,
          content_id,
          scraped_date,
          scraped_at || new Date().toISOString(),
          title || null,
          views || 0,
          likes || 0,
          comments || 0,
          shares || 0,
          extra_data ? JSON.stringify(extra_data) : null,
        ]
      );

      if (result.rowCount && result.rowCount > 0) inserted++;
      else skipped++;
    }

    return res.json({
      success: true,
      platform,
      inserted,
      skipped,
      total: items.length,
    });
  } catch (err) {
    console.error('snapshots ingest error:', err);
    return res.status(500).json({ success: false, error: '写入失败' });
  }
});

// GET /api/snapshots/:platform
// 查询某平台最近数据
router.get('/:platform', async (req: Request, res: Response) => {
  const { platform } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const date = req.query.date as string;

  try {
    let query = `
      SELECT id, platform, content_id, scraped_date, title,
             views, likes, comments, shares, extra_data, created_at
      FROM zenithjoy.daily_snapshots
      WHERE platform = $1
    `;
    const params: (string | number)[] = [platform];

    if (date) {
      params.push(date);
      query += ` AND scraped_date = $${params.length}`;
    }

    query += ` ORDER BY scraped_date DESC, views DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      platform,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error('snapshots fetch error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

// GET /api/snapshots/work/:workId
// 查询某作品在所有平台的数据（关联 publish_logs）
router.get('/work/:workId', async (req: Request, res: Response) => {
  const { workId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
        pl.platform,
        pl.platform_post_id,
        pl.published_at,
        ds.scraped_date,
        ds.content_id,
        ds.title,
        ds.views,
        ds.likes,
        ds.comments,
        ds.shares,
        ds.extra_data,
        (ds.scraped_date - pl.published_at::date) AS day_n
       FROM zenithjoy.publish_logs pl
       LEFT JOIN zenithjoy.daily_snapshots ds
         ON ds.platform = pl.platform
         AND ds.content_id = pl.platform_post_id
       WHERE pl.work_id = $1
         AND pl.platform_post_id IS NOT NULL
       ORDER BY pl.platform, ds.scraped_date`,
      [workId]
    );

    return res.json({
      success: true,
      work_id: workId,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (err) {
    console.error('snapshots work fetch error:', err);
    return res.status(500).json({ success: false, error: '查询失败' });
  }
});

export default router;
