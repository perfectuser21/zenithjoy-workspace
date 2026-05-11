'use strict';
/**
 * Agent Hardening H-1 — Lead 自验脚本（mac controller, 0-touch）
 *
 * 8 Step：
 *  1. mac curl POST /api/auth/sign-up/email 注册新 test user
 *  2. mac SQL 拿 license_key (free tier, device_limit=1)
 *  3. 模拟"第 1 个 Agent 实例" register 直接 mac curl POST /api/agent/register → 验 success
 *  4. 模拟"第 2 个 Agent 实例" same license → 验 403 LICENSE_DEVICE_LIMIT_EXCEEDED
 *  5. mac SQL verify license_machines 表只 1 行 active for this license
 *  6. mac inline psql INSERT publish_tasks status='queued' → 验 PASS new constraint
 *  7. mac SQL `\d publish_tasks` verify chk_publish_tasks_status 含完整 9 enum
 *  8. mac inline ws 模拟 mock WS client → verify backend 用 UUID 作 routing key
 *
 * 注意：本 sprint H-1 只做 backend，不需要真启 ssh rog Agent —
 * 用 mac inline curl + WS mock client 替代（PRD 描述的 "ssh rog 启第 1/2 个 Agent" 留 H-2 install pack auto-deploy 后做）
 *
 * SLA: user_intervention_count = 0（本 sprint 100% 0-touch）
 *
 * 运行：
 *   node scripts/lead-acceptance/agent-hardening-h1-self-test.cjs --api=http://localhost:5200
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

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
const DB = {
  host: args['db-host'] || process.env.DATABASE_HOST || '127.0.0.1',
  port: args['db-port'] || process.env.DATABASE_PORT || '5432',
  name: args['db-name'] || process.env.DATABASE_NAME || 'zenithjoy',
  user: args['db-user'] || process.env.DATABASE_USER || 'zenithjoy',
  pass: process.env.DATABASE_PASSWORD || '',
};
const OUT_DIR = args['out-dir'] || path.join(os.homedir(), 'h1-self-out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const TS = Date.now();
const summary = {
  sprint: 'agent-hardening-h1',
  api_base: API_BASE,
  start_at: new Date().toISOString(),
  ts: TS,
  steps: {},
  user_intervention_count: 0,
  status: 'IN_PROGRESS',
};

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function psql(sql) {
  const cmd = `PGPASSWORD='${DB.pass}' psql -h ${DB.host} -p ${DB.port} -U ${DB.user} -d ${DB.name} -tAq -c "${sql.replace(/"/g, '\\"')}"`;
  // -tA 模式 RETURNING 仍会输出 'INSERT 0 1' 状态行，取 stdout 第一行
  return execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0].trim();
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

function maskLicense(lk) {
  if (!lk) return null;
  return lk.slice(0, 8) + 'xxxxxx';
}

async function step1_signup() {
  const email = `h1-lead-${TS}@example.com`;
  const r = await fetchJSON(`${API_BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': API_BASE },
    body: JSON.stringify({ email, password: 'H1lead!2026', name: 'H1 Lead' }),
  });
  if (!r.body.user || !r.body.user.id) {
    summary.steps.step1_signup = { status: 'FAIL', body: r.body };
    return null;
  }
  summary.steps.step1_signup = { status: 'PASS', user_id: r.body.user.id, email };
  log(`Step 1 PASS: user_id=${r.body.user.id}`);
  return r.body.user.id;
}

function step2_get_license(userId) {
  const lk = psql(`SELECT license_key FROM zenithjoy.licenses WHERE customer_id LIKE '%${userId}%' OR notes LIKE '%${userId}%' ORDER BY created_at DESC LIMIT 1`);
  if (!/^ZJ-F-[A-Z0-9]{8}$/.test(lk)) {
    summary.steps.step2_license_key = { status: 'FAIL', value: lk };
    return null;
  }
  summary.steps.step2_license_key = { status: 'PASS', license_key_masked: maskLicense(lk), tier: 'free' };
  log(`Step 2 PASS: license=${maskLicense(lk)}`);
  return lk;
}

async function step3_first_agent_register(licenseKey) {
  const r = await fetchJSON(`${API_BASE}/api/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: licenseKey,
      machine_id: `lead-h1-${TS}-a`,
      hostname: 'rog-h1-lead-1',
      version: '0.1.0',
    }),
  });
  const ok = r.status === 200 &&
    r.body.success === true &&
    r.body.device_count === 1 &&
    r.body.device_limit === 1 &&
    /^[0-9a-f]{8}-/.test(r.body.agent_id || '');
  summary.steps.step3_first_agent_register = {
    status: ok ? 'PASS' : 'FAIL',
    http_status: r.status,
    body: r.body,
  };
  log(`Step 3 ${ok ? 'PASS' : 'FAIL'}: HTTP ${r.status} success=${r.body.success} device_count=${r.body.device_count}`);
  return r.body.agent_id;
}

async function step4_second_agent_403(licenseKey) {
  const r = await fetchJSON(`${API_BASE}/api/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      license_key: licenseKey,
      machine_id: `lead-h1-${TS}-b`,
      hostname: 'rog-h1-lead-2',
      version: '0.1.0',
    }),
  });
  const ok = r.status === 403 &&
    r.body.error === 'LICENSE_DEVICE_LIMIT_EXCEEDED' &&
    r.body.current_count === 1 &&
    r.body.limit === 1;
  summary.steps.step4_second_agent_403_LIMIT_EXCEEDED = {
    status: ok ? 'PASS' : 'FAIL',
    http_status: r.status,
    body: r.body,
    critical: true,
  };
  log(`Step 4 ${ok ? 'PASS' : 'FAIL'} (CRITICAL): HTTP ${r.status} error=${r.body.error} current_count=${r.body.current_count}`);
}

function step5_agents_table_1_row(licenseKey) {
  const count = psql(`SELECT COUNT(*) FROM zenithjoy.license_machines lm JOIN zenithjoy.licenses l ON l.id=lm.license_id WHERE l.license_key='${licenseKey}' AND lm.status='active' AND lm.first_seen > NOW() - interval '5 minutes'`);
  const ok = count === '1';
  summary.steps.step5_agents_table_1_row = { status: ok ? 'PASS' : 'FAIL', count };
  log(`Step 5 ${ok ? 'PASS' : 'FAIL'}: license_machines active count=${count}`);
}

function step6_publish_tasks_queued_constraint() {
  // 直 INSERT agents 行 + INSERT publish_tasks status='queued' — 验 constraint
  try {
    // 借 step 1 注册 user 的默认 tenant 满足 agents.tenant_id NOT NULL
    const tid = psql(`SELECT id FROM zenithjoy.tenants ORDER BY created_at DESC LIMIT 1`);
    const aid = psql(`INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, status) VALUES ('${tid}', 'h1-lead-${TS}', ARRAY['douyin'], '0.1.0', 'online') RETURNING id`);
    const pid = psql(`INSERT INTO zenithjoy.publish_tasks (agent_id, platform, status) VALUES ('${aid}', 'douyin', 'queued') RETURNING id`);
    const ok = /^[0-9a-f-]{36}$/.test(pid);
    summary.steps.step6_publish_tasks_queued_constraint = {
      status: ok ? 'PASS' : 'FAIL',
      agent_id: aid,
      task_id: pid,
      critical: true,
    };
    log(`Step 6 ${ok ? 'PASS' : 'FAIL'} (CRITICAL): publish_tasks 'queued' INSERT 返 task_id=${pid}`);
    return aid;
  } catch (e) {
    summary.steps.step6_publish_tasks_queued_constraint = {
      status: 'FAIL',
      error: e.message,
      critical: true,
    };
    log(`Step 6 FAIL: ${e.message}`);
    return null;
  }
}

function step7_constraint_full_enum() {
  const cdef = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_publish_tasks_status'`);
  const allStatuses = ['pending', 'running', 'success', 'failed', 'done', 'queued', 'dispatched', 'in_progress', 'completed'];
  const missing = allStatuses.filter((s) => !cdef.includes(`'${s}'`));
  const ok = missing.length === 0;
  summary.steps.step7_constraint_full_enum = {
    status: ok ? 'PASS' : 'FAIL',
    constraint_def: cdef,
    missing,
  };
  log(`Step 7 ${ok ? 'PASS' : 'FAIL'}: enum 9/9 ${missing.length > 0 ? 'missing=' + missing.join(',') : ''}`);
}

async function step8_ws_routing_uuid(licenseKey, agentDbUuid) {
  const recvFile = path.join(OUT_DIR, `h1-ws-recv-${TS}.jsonl`);
  fs.writeFileSync(recvFile, '');

  // 启 mock WS client (inline node)
  const wsScript = `
    const fs = require('fs');
    const WS = require('ws');
    const ws = new WS('${API_BASE.replace('http', 'ws')}/agent-ws?token=${licenseKey}');
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello', v: 1, msgId: 'm-1', ts: Date.now(),
        payload: { agentId: 'h1-lead-${TS}', capabilities: ['douyin'], version: '0.1.0' }
      }));
    });
    ws.on('message', (raw) => fs.appendFileSync('${recvFile}', raw.toString() + '\\n'));
    ws.on('error', (e) => { console.error('ws err', e.message); process.exit(1); });
    setTimeout(() => process.exit(0), 8000);
  `;
  const wsProc = spawn('node', ['-e', wsScript], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise((r) => setTimeout(r, 2500));

  // 触发 dispatch
  await fetchJSON(`${API_BASE}/api/agent/test-publish-douyin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  await new Promise((r) => setTimeout(r, 4000));
  try { wsProc.kill('SIGTERM'); } catch {}

  let recv = '';
  try { recv = fs.readFileSync(recvFile, 'utf8'); } catch {}
  const lines = recv.split('\n').filter((l) => l.includes('publish_request') || l.includes('"task"'));
  const msg = lines[0];
  let ok = false;
  let agentIdInMsg = null;
  if (msg) {
    try {
      const obj = JSON.parse(msg);
      agentIdInMsg = (obj.payload && obj.payload.agent_id) || obj.agent_id || null;
      ok = agentIdInMsg && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(agentIdInMsg);
    } catch {}
  }
  summary.steps.step8_ws_routing_uuid = {
    status: ok ? 'PASS' : 'FAIL',
    received_lines_count: lines.length,
    first_msg_agent_id: agentIdInMsg,
    critical: true,
  };
  log(`Step 8 ${ok ? 'PASS' : 'FAIL'} (CRITICAL): WS message agent_id=${agentIdInMsg}`);
}

(async () => {
  log(`H-1 self-test start — API=${API_BASE} TS=${TS}`);
  log(`out_dir=${OUT_DIR}`);

  const userId = await step1_signup();
  if (!userId) { writeSummaryAndExit('FAIL'); return; }

  const lk = step2_get_license(userId);
  if (!lk) { writeSummaryAndExit('FAIL'); return; }

  const agentUuid = await step3_first_agent_register(lk);
  await step4_second_agent_403(lk);
  step5_agents_table_1_row(lk);
  step6_publish_tasks_queued_constraint();
  step7_constraint_full_enum();
  await step8_ws_routing_uuid(lk, agentUuid);

  // 检查 critical step 是否全 PASS
  const critFails = Object.entries(summary.steps).filter(
    ([_, v]) => v.critical && v.status !== 'PASS'
  );
  const allCriticalPassed = critFails.length === 0;
  writeSummaryAndExit(allCriticalPassed ? 'PASS' : 'PARTIAL_PASS');
})();

function writeSummaryAndExit(status) {
  summary.status = status;
  summary.end_at = new Date().toISOString();
  const outFile = path.join(OUT_DIR, `summary-${TS}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\n=== Summary === status=${status} user_intervention_count=${summary.user_intervention_count}`);
  console.log(`Output: ${outFile}`);
  // 打印最终 status table
  for (const [k, v] of Object.entries(summary.steps)) {
    const tag = v.critical ? '⚠CRIT' : '     ';
    console.log(`  ${tag} ${k}: ${v.status}`);
  }
  process.exit(status === 'PASS' ? 0 : (status === 'PARTIAL_PASS' ? 2 : 1));
}
