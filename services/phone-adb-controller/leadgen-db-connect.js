// leadgen-db-connect.js —— 真实Postgres连接,只给生产脚本用,单测绝不require这个文件。
//
// 跟 apps/api/db/index.ts 同样的连接约定:优先 DATABASE_URL,没有则用离散变量
// (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)。凭据走 ~/.credentials/,不硬编码。
"use strict";
let _pool = null;

function getPool() {
  if (_pool) return _pool;
  // 惰性require:只有真的要连库(生产脚本调用getPool)才会加载pg,
  // 单测走leadgen-db-lib.js传假pool进去,永远不会执行到这一行。
  const { Pool } = require("pg");
  _pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE || "zenithjoy",
      });
  return _pool;
}

module.exports = { getPool };
