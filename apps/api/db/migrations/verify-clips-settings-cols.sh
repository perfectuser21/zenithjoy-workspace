#!/bin/bash
# 验证 user_clip_settings 是否已有 6 个新 OAuth 列
# 期望：PASS: all 6 columns present
# 若列不存在：FAIL + exit 1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PG_MODULE="$ROOT_DIR/node_modules/pg"

node -e "
const { Pool } = require('$PG_MODULE');
const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'cecelia',
  password: process.env.DATABASE_PASSWORD,
});
const REQUIRED = [
  'notion_token',
  'feishu_user_token',
  'feishu_refresh_token',
  'feishu_user_id',
  'feishu_user_name',
  'feishu_token_expires_at',
];
pool.query(
  \"SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='user_clip_settings' AND column_name = ANY(\\\$1)\",
  [REQUIRED]
).then(r => {
  const found = r.rows.map(x => x.column_name);
  const missing = REQUIRED.filter(c => !found.includes(c));
  if (missing.length > 0) {
    console.error('FAIL: missing columns:', missing.join(', '));
    console.error('found:', found.join(', ') || '(none)');
    pool.end();
    process.exit(1);
  }
  console.log('PASS: all 6 columns present');
  pool.end();
}).catch(e => {
  console.error('DB error:', e.message);
  process.exit(1);
});
" 2>&1
