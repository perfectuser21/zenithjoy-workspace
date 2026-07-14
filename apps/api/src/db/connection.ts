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
  // 2026-07-14 根因修复：低流量(尤其 staging)时旧的 idleTimeout 30s 频繁回收空闲连接、池常空，
  // 每请求新建连接偶尔 >2s 触发 connectionTimeout → collect/start / pending-collect-tasks 间歇 500
  // → 安卓 agent 拿不到/派不成采集任务、task 卡 running。生产+staging 各报 28/18 次连接超时。
  // 调大两个超时：连接常驻更久少新建 + 新建给足时间。
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
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
