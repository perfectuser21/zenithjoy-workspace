const express = require('express');
const { Pool } = require('pg');

const router = express.Router();

// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'host.docker.internal',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'timescaledb',
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Platform to table/view mapping
const PLATFORM_VIEWS = {
  douyin: 'raw_data_douyin',
  kuaishou: 'raw_data_kuaishou',
  xiaohongshu: 'raw_data_xiaohongshu',
  toutiao: 'raw_data_toutiao',
  weibo: 'raw_data_weibo',
  zhihu: 'raw_data_zhihu',
  channels: 'raw_data_channels',
};

// GET /:platform - Get platform data
router.get('/:platform', async (req, res) => {
  const { platform } = req.params;
  
  // Validate platform
  if (!PLATFORM_VIEWS[platform]) {
    return res.status(400).json({
      success: false,
      platform,
      count: 0,
      data: [],
      error: `Invalid platform: ${platform}. Valid platforms: ${Object.keys(PLATFORM_VIEWS).join(', ')}`,
    });
  }

  const viewName = PLATFORM_VIEWS[platform];

  try {
    // Query data from TimescaleDB view (limit 100 for performance)
    const result = await pool.query(
      `SELECT * FROM ${viewName} ORDER BY scraped_at DESC LIMIT 100`
    );

    res.json({
      success: true,
      platform,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error(`Error fetching ${platform} data:`, error);
    res.status(500).json({
      success: false,
      platform,
      count: 0,
      data: [],
      error: error.message,
    });
  }
});

// Test database connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connected successfully');
  }
});

module.exports = router;
