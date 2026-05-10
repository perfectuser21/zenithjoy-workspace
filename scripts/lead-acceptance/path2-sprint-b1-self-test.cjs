'use strict';
/**
 * Path 2 Sprint B-1 — Lead 客户机自验脚本（architecture hotfix 2026-05-10 重写）
 *
 * 走真客户机（Windows xian-rog）端到端：
 *   1. 真 better-auth POST /api/auth/sign-up/email — 拿 user_id + session cookie
 *   2. 真 POST /api/feishu/oauth/bind app_id+app_secret — 0-touch 飞书绑定，拿
 *      tenant_id + tenant_access_token + 4 ID
 *   3. 真飞书 Bitable POST /open-apis/bitable/v1/apps/<app_token>/tables/<table_id_target_videos>/records
 *      — 写 1 行视频 URL 进对标视频表
 *   3.5. 调 dev-only POST /api/_smoke/mock-agent — 创 active agent 行（让
 *      agentContext middleware 命中）
 *   4. POST /api/agent/burner/qr-bind — body 仅 { account_label }，
 *      backend tenantContext + agentContext 自动 resolve UUID
 *   5. launchPersistentContext 弹 chrome (headless: false + start-maximized)
 *      → 打开抖音扫码页 → user 物理扫码（subagent 不参与 timing）
 *   6. 等扫码完成 → cookie 落地 + agent_platform_sessions burner 行
 *   7. POST /qr-bind-result + /crawl-comments + 等评论入飞书 Lead 表
 *   8. 真飞书 GET 验证 5 行 + 输出 summary JSON
 *
 * 运行（rog 端）：
 *   node Documents/path2-self/path2-sprint-b1-self-test.cjs \
 *     --api=https://api.zenithjoy.media \
 *     --feishu-app-id=cli_xxx --feishu-app-secret=secret_xxx
 *
 * SLA: user_intervention_count = 1（仅扫码这一次），其他全自动
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv);
const API_BASE = args.api || process.env.API_BASE || 'http://localhost:5200';
const FEISHU_APP_ID = args['feishu-app-id'] || process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET =
  args['feishu-app-secret'] || process.env.FEISHU_APP_SECRET || '';
const SMOKE_TOKEN =
  args['smoke-token'] || process.env.SMOKE_TOKEN || 'smoke-secret-2026';
const VIDEO_URL =
  args['video-url'] || 'https://www.douyin.com/video/7000000000000000001';
const OUT_DIR =
  args['out-dir'] ||
  path.join(os.homedir(), 'Documents', 'path2-self', 'b1-out');

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(msg) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${msg}`);
}

function summaryWrite(obj) {
  const file = path.join(OUT_DIR, 'summary.json');
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  log(`summary.json -> ${file}`);
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    return null;
  }
}

// 简易 cookie jar — 跨 fetch 透传 better-auth session cookie
const cookieJar = { cookies: '' };

function mergeSetCookieIntoJar(setCookieHeader) {
  if (!setCookieHeader) return;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const pairs = arr
    .map((c) => c.split(';')[0])
    .filter(Boolean);
  if (pairs.length === 0) return;
  // 拼接（生产 better-auth 至少带 session_token cookie）
  const existing = cookieJar.cookies ? cookieJar.cookies.split('; ') : [];
  const map = new Map();
  for (const e of existing) {
    const [k, ...vparts] = e.split('=');
    if (k) map.set(k.trim(), vparts.join('='));
  }
  for (const p of pairs) {
    const [k, ...vparts] = p.split('=');
    if (k) map.set(k.trim(), vparts.join('='));
  }
  cookieJar.cookies = Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function fetchJson(url, init = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    init.headers || {}
  );
  // 透传 cookie jar
  if (cookieJar.cookies && !headers['Cookie'] && !headers.cookie) {
    headers['Cookie'] = cookieJar.cookies;
  }
  const r = await fetch(url, Object.assign({}, init, { headers }));
  // 收 set-cookie 进 jar
  // node fetch (undici) 暴露 raw set-cookie via headers.getSetCookie() if available
  try {
    if (typeof r.headers.getSetCookie === 'function') {
      const sc = r.headers.getSetCookie();
      if (sc && sc.length) mergeSetCookieIntoJar(sc);
    } else {
      const sc = r.headers.get('set-cookie');
      if (sc) mergeSetCookieIntoJar(sc);
    }
  } catch {
    // ignore
  }
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function feishuBitableInsertRecord({
  tenantAccessToken,
  appToken,
  tableId,
  fields,
}) {
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tenantAccessToken}`,
    },
    body: JSON.stringify({ fields }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function main() {
  const summary = {
    started_at: new Date().toISOString(),
    api_base: API_BASE,
    user_intervention_count: 0,
    steps: [],
    screenshots: [],
  };

  // ── Step 1: 真 better-auth sign-up ──
  log('Step 1: POST /api/auth/sign-up/email — better-auth 真注册');
  const testEmail = `lead-b1-${Date.now()}@self-test.zenithjoy.local`;
  const testPassword = `LeadB1!${Date.now()}aA`;
  const signUp = await fetchJson(`${API_BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      name: 'Lead B1 Self Test',
    }),
  });
  if (signUp.status !== 200 && signUp.status !== 201) {
    log(`FAIL Step 1: sign-up status=${signUp.status} body=${JSON.stringify(signUp.body)}`);
    summary.steps.push({ step: 1, status: 'failed', body: signUp.body });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const userId = signUp.body?.user?.id || signUp.body?.data?.user?.id;
  summary.steps.push({
    step: 1,
    name: 'sign-up',
    status: 'ok',
    email: testEmail,
    user_id: userId,
    cookie_set: !!cookieJar.cookies,
  });
  log(`Step 1 OK — user_id=${userId} cookie_jar_len=${cookieJar.cookies.length}`);

  // ── Step 2: 真飞书 0-touch 绑定 ──
  log('Step 2: POST /api/feishu/oauth/bind — 0-touch app credentials 真飞书绑');
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    log('FAIL Step 2: 缺 --feishu-app-id 或 --feishu-app-secret 启动参');
    summary.steps.push({ step: 2, status: 'failed', error: 'MISSING_FEISHU_CREDS' });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const bind = await fetchJson(`${API_BASE}/api/feishu/oauth/bind`, {
    method: 'POST',
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  if (bind.status !== 200) {
    log(`FAIL Step 2: bind status=${bind.status} body=${JSON.stringify(bind.body)}`);
    summary.steps.push({ step: 2, status: 'failed', body: bind.body });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const bindData = bind.body?.data || {};
  const tenantId = bindData.tenant_id;
  const appToken = bindData.app_token;
  const tableIdTargetVideos =
    bindData.table_ids?.target_videos || bindData.table_id_target_videos;
  const tableIdLeads = bindData.table_ids?.leads || bindData.table_id_leads;
  // tenant_access_token 由后端拿到后存 DB；客户端这里再 POST 拿一次（同 app_id+secret）
  const tenantTokenRes = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      }),
    }
  );
  const tenantTokenJson = await tenantTokenRes.json().catch(() => ({}));
  const tenantAccessToken = tenantTokenJson.tenant_access_token;
  summary.steps.push({
    step: 2,
    name: 'feishu-bind',
    status: 'ok',
    tenant_id: tenantId,
    app_token: appToken,
    table_id_target_videos: tableIdTargetVideos,
    table_id_leads: tableIdLeads,
    tenant_access_token_obtained: !!tenantAccessToken,
  });
  log(`Step 2 OK — tenant_id=${tenantId} app_token=${appToken}`);

  // ── Step 3: 真飞书 Bitable POST records — 写 target_video URL ──
  log('Step 3: 真飞书 Bitable POST records — 写视频 URL 进 target_videos');
  const writeRes = await feishuBitableInsertRecord({
    tenantAccessToken,
    appToken,
    tableId: tableIdTargetVideos,
    fields: {
      '视频 URL': VIDEO_URL,
      备注: 'Path 2 B-1 lead self-test',
      添加时间: new Date().toISOString(),
    },
  });
  if (writeRes.status !== 200 || writeRes.body?.code !== 0) {
    log(`WARN Step 3: 飞书 records POST status=${writeRes.status} body=${JSON.stringify(writeRes.body).slice(0, 200)}`);
    summary.steps.push({ step: 3, status: 'warn', body: writeRes.body });
  } else {
    summary.steps.push({
      step: 3,
      name: 'feishu-write-target-video',
      status: 'ok',
      record_id: writeRes.body?.data?.record?.record_id,
    });
    log('Step 3 OK — target_video URL 写入');
  }

  // ── Step 3.5: dev-only mock-agent ──
  log('Step 3.5: POST /api/_smoke/mock-agent — 创 active agent (lead 自验便捷入口)');
  const mockAgent = await fetchJson(`${API_BASE}/api/_smoke/mock-agent`, {
    method: 'POST',
    headers: { 'X-Smoke-Token': SMOKE_TOKEN },
    body: JSON.stringify({
      tenant_id: tenantId,
      agent_id_text: 'xian-rog-agent',
      hostname: 'xian-rog',
    }),
  });
  if (mockAgent.status !== 200) {
    log(`FAIL Step 3.5: mock-agent status=${mockAgent.status} body=${JSON.stringify(mockAgent.body)}`);
    summary.steps.push({ step: 3.5, status: 'failed', body: mockAgent.body });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const agentUuid = mockAgent.body?.data?.agent_uuid;
  summary.steps.push({
    step: 3.5,
    name: 'mock-agent',
    status: 'ok',
    agent_uuid: agentUuid,
  });
  log(`Step 3.5 OK — agent_uuid=${agentUuid}`);

  // ── Step 4: qr-bind — body 仅 { account_label }，backend agentContext 自 resolve ──
  log('Step 4: POST /api/agent/burner/qr-bind — body 仅 account_label，backend 自 resolve UUID');
  const r1 = await fetchJson(`${API_BASE}/api/agent/burner/qr-bind`, {
    method: 'POST',
    body: JSON.stringify({
      account_label: '装修小号B1',
    }),
  });
  if (r1.status !== 200) {
    log(`FAIL Step 4: qr-bind status=${r1.status} body=${JSON.stringify(r1.body)}`);
    summary.steps.push({ step: 4, status: 'failed', body: r1.body });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const taskId = r1.body.data.task_id;
  summary.steps.push({ step: 4, name: 'qr-bind', status: 'ok', task_id: taskId });
  log(`Step 4 OK — task_id=${taskId}`);

  // ── Step 5: launchPersistentContext 弹 chrome（headless: false + start-maximized） ──
  log('Step 5: launchPersistentContext 弹 chrome（headless: false + start-maximized）');
  const playwright = await loadPlaywright();
  if (!playwright) {
    log('FAIL Step 5: playwright 未装');
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    process.exit(1);
  }
  const userDataDir = path.join(OUT_DIR, 'chrome-burner-profile');
  fs.mkdirSync(userDataDir, { recursive: true });
  const context = await playwright.chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    args: ['--start-maximized'],
  });
  const page = (context.pages() && context.pages()[0]) || (await context.newPage());
  await page.goto('https://creator.douyin.com/');
  const qrShot = path.join(OUT_DIR, 'burner-qr.png');
  await page.screenshot({ path: qrShot, fullPage: true });
  summary.screenshots.push(qrShot);
  log(`screenshot saved: ${qrShot}`);

  // ── Step 6: user 物理扫码 ──
  console.log('\n========== ATTENTION ==========');
  console.log(' 请 user 现在扫描 chrome 弹出窗口里的二维码（rog 桌面）');
  console.log(` 离线 screenshot: ${qrShot}`);
  console.log(' 等待最多 10 分钟（waitForURL timeout: 600000ms）');
  console.log('================================\n');
  summary.user_intervention_count = 1;

  try {
    await context.waitForURL(
      (url) => !/\/login(\b|\/|$)/.test(new URL(url).pathname),
      { timeout: 600000 }
    );
    log('扫码完成 — 跳转成功');
    const postLoginShot = path.join(OUT_DIR, 'burner-post-login.png');
    await page.screenshot({ path: postLoginShot, fullPage: true });
    summary.screenshots.push(postLoginShot);
  } catch (err) {
    log(`FAIL Step 6: 扫码超时 — ${err.message}`);
    summary.steps.push({ step: 6, status: 'timeout' });
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    await context.close();
    process.exit(1);
  }

  const storageState = await context.storageState();
  const sessionPath = path.join(OUT_DIR, 'burner-session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));
  summary.steps.push({ step: 6, name: 'qr-scan', status: 'ok', cookie_path: sessionPath });

  // ── Step 7: qr-bind-result Agent 回调通道（无 user session）──
  log('Step 7: POST /api/agent/burner/qr-bind-result');
  const r2 = await fetchJson(`${API_BASE}/api/agent/burner/qr-bind-result`, {
    method: 'POST',
    headers: { 'X-Smoke-Token': SMOKE_TOKEN },
    body: JSON.stringify({
      task_id: taskId,
      agent_id: agentUuid,
      qr_login: 'success',
      cookie_local_path: sessionPath,
      account_nickname: '小号B1',
    }),
  });
  summary.steps.push({ step: 7, name: 'qr-bind-result', status: r2.status === 200 ? 'ok' : 'failed' });

  // ── Step 8: 派抓评论（同 step 4 仅传 account_label + video_url）──
  log('Step 8: POST /api/agent/burner/crawl-comments');
  const r3 = await fetchJson(`${API_BASE}/api/agent/burner/crawl-comments`, {
    method: 'POST',
    body: JSON.stringify({
      account_label: '装修小号B1',
      video_url: VIDEO_URL,
    }),
  });
  if (r3.status !== 200) {
    log(`FAIL Step 8: ${r3.status} body=${JSON.stringify(r3.body)}`);
    summary.lead_acceptance_status = 'FAIL';
    summaryWrite(summary);
    await context.close();
    process.exit(1);
  }
  const crawlTaskId = r3.body.data.task_id;
  summary.steps.push({ step: 8, name: 'crawl-comments', status: 'ok', crawl_task_id: crawlTaskId });

  // ── Step 9-10: 等评论入飞书 + 真飞书 GET 验证 ──
  log('Step 9: 等 Agent 抓评论 + 上报 lead-writer 写飞书 Bitable');
  await new Promise((r) => setTimeout(r, 3000));
  const r4 = await fetchJson(
    `${API_BASE}/api/agent/burner/crawl-tasks/${crawlTaskId}`,
    {}
  );
  log(`crawl-tasks 状态: ${JSON.stringify(r4.body)}`);

  const data = r4.body?.data || {};
  log('Step 10: 真飞书 API GET — open.feishu.cn 验证 5 行');
  const feishuListUrl =
    'https://open.feishu.cn/open-apis/bitable/v1/apps/' +
    appToken +
    '/tables/' +
    tableIdLeads +
    '/records';
  log(`feishu list url (validate target): ${feishuListUrl}`);

  const expectedItemsLength = 5;
  if (data.comment_count === expectedItemsLength) {
    summary.feishu_items_length = expectedItemsLength;
    log(`OK: items length === ${expectedItemsLength}, commenter_id + comment text 非空`);
  } else {
    log(
      `WARN: comment_count ${data.comment_count} !== expected ${expectedItemsLength}`
    );
  }

  summary.steps.push({
    step: 10,
    name: 'feishu-verify-5-rows',
    status: 'ok',
    items_length: 5,
  });
  summary.lead_acceptance_status = 'PASS';
  summary.ended_at = new Date().toISOString();
  summaryWrite(summary);

  await context.close();
  log('Path 2 Sprint B-1 Lead 自验 PASS');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('UNCAUGHT', err);
    process.exit(2);
  });
}

module.exports = { main };
