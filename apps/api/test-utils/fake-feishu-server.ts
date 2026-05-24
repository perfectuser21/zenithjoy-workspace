/**
 * Path 2 Sprint A WS3+WS5: fake-feishu-server
 *
 * 独立 Node.js HTTP 进程监听 localhost:3099，模拟飞书 5 个核心端点：
 *   1. POST /open-apis/auth/v3/tenant_access_token/internal — 返 fake_t_<ts> + expire 7200
 *   2. POST /open-apis/bitable/v1/apps                       — 返 app_token = bascn<random16>
 *   3. POST /open-apis/bitable/v1/apps/:app_token/tables     — 返 table_id = tbl<random16>
 *   4. POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records — 写内存
 *   5. GET  /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records — 读内存
 *
 * 错误注入：query ?inject_error=R2_PROVISION_FAIL → createTable 返非 0 code
 *           query ?inject_error=R3_NOT_FOUND      → list_records 返 code 91402
 *
 * CI workflow 用法：
 *   node apps/api/test-utils/fake-feishu-server.js &  # 后台拉起
 *   export FEISHU_API_BASE=http://localhost:3099
 *   bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh
 *   kill $!
 */
import http from 'http';
import { URL } from 'url';

const PORT = parseInt(process.env.FAKE_FEISHU_PORT || '3099', 10);

interface RecordItem {
  record_id: string;
  fields: Record<string, unknown>;
}

// 内存存储：{ [app_token]: { [table_id]: RecordItem[] } }
const store: Record<string, Record<string, RecordItem[]>> = {};

// Path 2 Sprint B-1 WS6：seen-records helper — 按 table_id 索引所有写入记录
// 让 smoke 在 step 9 验证 fake-server 收到 ≥5 次 records POST
const seenRecords: Record<string, RecordItem[]> = {};

function randomId(prefix: string, len = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = prefix;
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = u.pathname;
  const inject = u.searchParams.get('inject_error') || '';

  try {
    // ── 1. tenant_access_token ──
    if (req.method === 'POST' && path === '/open-apis/auth/v3/tenant_access_token/internal') {
      const body = await readBody(req);
      const parsed = body ? JSON.parse(body) : {};
      if (!parsed.app_id || !parsed.app_secret) {
        return send(res, 200, { code: 99991663, msg: 'app_id_invalid' });
      }
      return send(res, 200, {
        code: 0,
        msg: 'success',
        tenant_access_token: 'fake_t_' + Date.now(),
        expire: 7200,
      });
    }

    // ── 2. createBitable ──
    if (req.method === 'POST' && path === '/open-apis/bitable/v1/apps') {
      const appToken = randomId('bascn', 16);
      store[appToken] = {};
      return send(res, 200, {
        code: 0,
        msg: 'success',
        data: { app: { app_token: appToken, name: 'fake-app' } },
      });
    }

    // ── 3. createTable ──
    const createTableMatch = path.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables$/);
    if (req.method === 'POST' && createTableMatch) {
      const appToken = createTableMatch[1];
      if (inject === 'R2_PROVISION_FAIL') {
        return send(res, 200, { code: 1254301, msg: 'fake R2 inject createTable failed' });
      }
      if (!store[appToken]) store[appToken] = {};
      const tableId = randomId('tbl', 16);
      store[appToken][tableId] = [];
      return send(res, 200, {
        code: 0,
        msg: 'success',
        data: { table_id: tableId },
      });
    }

    // ── 4. records (POST = create, GET = list) ──
    const recordsMatch = path.match(
      /^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables\/([^/]+)\/records$/
    );
    if (recordsMatch) {
      const [, appToken, tableId] = recordsMatch;

      if (req.method === 'POST') {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        const fields = parsed.fields || {};
        if (!store[appToken]) store[appToken] = {};
        if (!store[appToken][tableId]) store[appToken][tableId] = [];
        const recordId = randomId('rec', 8);
        const recordItem = { record_id: recordId, fields };
        store[appToken][tableId].push(recordItem);
        // Path 2 Sprint B-1 WS6: 同步追加到 seenRecords by table_id（跨 app_token 索引）
        if (!seenRecords[tableId]) seenRecords[tableId] = [];
        seenRecords[tableId].push(recordItem);
        return send(res, 200, {
          code: 0,
          msg: 'success',
          data: { record: { record_id: recordId, fields } },
        });
      }

      if (req.method === 'GET') {
        // Token validation: reject tokens that don't start with 'fake_t_' (simulates expired token)
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (token && !token.startsWith('fake_t_')) {
          return send(res, 200, { code: 99991661, msg: 'fake: invalid or expired token' });
        }
        if (inject === 'R3_NOT_FOUND') {
          return send(res, 200, { code: 91402, msg: 'fake R3 inject Bitable not found' });
        }
        if (!store[appToken] || !store[appToken][tableId]) {
          return send(res, 200, { code: 0, msg: 'success', data: { items: [] } });
        }
        const items = store[appToken][tableId].map((r) => ({
          record_id: r.record_id,
          fields: r.fields,
        }));
        return send(res, 200, {
          code: 0,
          msg: 'success',
          data: { items, total: items.length, has_more: false },
        });
      }
    }

    // ── health ──
    if (req.method === 'GET' && path === '/healthz') {
      return send(res, 200, { ok: true, port: PORT });
    }

    // ── Path 2 Sprint B-1 WS6: __test/seen-records helper ──
    // GET /__test/seen-records?table_id=tbl_xxx — 返 { count, records[] }
    if (req.method === 'GET' && path === '/__test/seen-records') {
      const tableId = u.searchParams.get('table_id') || '';
      const items = seenRecords[tableId] || [];
      return send(res, 200, {
        count: items.length,
        records: items.map((r) => r.fields),
      });
    }

    // ── Path 2 Sprint B-1 WS6: __test/reset helper（CI 同进程多次跑时清状态）──
    if (req.method === 'POST' && path === '/__test/reset') {
      for (const k of Object.keys(seenRecords)) delete seenRecords[k];
      return send(res, 200, { ok: true, reset: true });
    }

    return send(res, 404, { code: 404, msg: `unknown path ${path}` });
  } catch (err) {
    return send(res, 500, { code: 500, msg: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[fake-feishu] listening :${PORT} — endpoints: token/apps/tables/records`);
});

// Graceful shutdown for CI cleanup
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

export default server;
