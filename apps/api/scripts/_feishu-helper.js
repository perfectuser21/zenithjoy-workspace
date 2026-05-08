/**
 * apps/api/scripts/_feishu-helper.js — fixture script 共享工具
 *
 * 职责：
 *   - 解析 ~/.credentials/feishu.env（CI 缺失 → fallback mock 模式）
 *   - 调飞书 Bitable v1 OpenAPI（tenant_token / records.create / records.search / records.update）
 *   - 提供轻量 cli arg 解析（兼容 minimist 风格）+ --help 模板生成
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i += 1;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function showHelpAndExit(usageText) {
  process.stdout.write(usageText.endsWith('\n') ? usageText : usageText + '\n');
  process.exit(0);
}

function loadCredentials() {
  const envFile = path.join(os.homedir(), '.credentials', 'feishu.env');
  const out = {};
  if (!fs.existsSync(envFile)) return out;
  const txt = fs.readFileSync(envFile, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function isMockMode() {
  const env = { ...loadCredentials(), ...process.env };
  // CI / 单元测试无 feishu 凭据 → mock
  return !env.FEISHU_TEST_APP_ID || !env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET;
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getTenantToken() {
  const env = { ...loadCredentials(), ...process.env };
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET 缺失');
  }
  const r = await postJson(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET },
  );
  if (r.code !== 0) throw new Error('飞书 token 失败: ' + JSON.stringify(r));
  return r.tenant_access_token;
}

module.exports = {
  parseArgs,
  showHelpAndExit,
  loadCredentials,
  isMockMode,
  postJson,
  getTenantToken,
};
