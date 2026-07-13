import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // P0 事故修复（2026-07-13）：连接级别 search_path，只影响 ZenithJoy 自己
  // 发起的连接，不像旧方案的 ALTER DATABASE 那样污染共享库的全局默认值
  // （曾导致 Brain 的 public.tasks 查询被 zenithjoy.tasks 抢先解析而 crash-loop）。
  // Better Auth 的 user/session/account/verification 表已挪到 zenithjoy schema，
  // operator_sessions 同理，此处让 unqualified 查询能透明找到新位置。
  options: '-c search_path=zenithjoy,public',
});

// 只在第一次物理连接时打印一次，避免连接池轮换时刷屏
let _dbConnectedLogged = false;
pool.on('connect', () => {
  if (!_dbConnectedLogged) {
    console.log('✅ Database connected');
    _dbConnectedLogged = true;
  }
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

export default pool;
