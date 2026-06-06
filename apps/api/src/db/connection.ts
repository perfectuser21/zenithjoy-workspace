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
