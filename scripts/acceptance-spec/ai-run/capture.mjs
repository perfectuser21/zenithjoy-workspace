#!/usr/bin/env node
/**
 * capture.mjs — AI员工采证器（发版验收双表 · 刀2.2）
 *
 * D2 白名单收口：action 只允许 {observe, trigger_collect}，全局 trigger_collect ≤ 2 次。
 * 无凭据/双自检失败/版本戳不可达 → 整轮以 ai_incomplete 退出，零回写。
 *
 * 用法（常驻验收账号登录模式）:
 *   STAGING_ACCEPTANCE_EMAIL=... STAGING_ACCEPTANCE_PASSWORD=... \
 *   node scripts/acceptance-spec/ai-run/capture.mjs \
 *     --staging https://staging-autopilot.zenjoymedia.media \
 *     --out acceptance-spec/runs/<自定时间戳>
 *   凭据在 1Password CS「ZenithJoy AI验收账号 (staging常驻)」（绑真机租户，4台安卓在线）
 *
 * 产出:
 *   <out>/evidence/<格号>/*.png|page.txt   逐格截图与页面文本
 *   <out>/pending-judgments.json           待判定骨架（verdict=null，判官填完后校验为 ai-column.json）
 *   <out>/run-summary.json                 本轮模式/账号/在线机器数（不含密码）
 *   <out>/capture-log.txt                  采证过程流水
 */

// 顶层只保留无外部依赖的 Node 内置 + 本地轻量模块（check.mjs / login.mjs 无 playwright/ajv 依赖）
// 使得 `import capture.mjs` 不因 playwright/ajv 缺失而整体失败，assertTenantAndDevice 可被单测 import。
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 导出 assertTenantAndDevice 供单测直接使用（check.mjs 无重量级依赖）
export { assertTenantAndDevice } from './check.mjs';
import { assertTenantAndDevice } from './check.mjs';
import { resolveCredentials, buildRunSummary } from './login.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

// ── trigger_collect 全局计数闸 ────────────────────────────────
const TRIGGER_COLLECT_MAX = 2;
let triggerCollectCount = 0;

function assertTriggerCollectQuota() {
  if (triggerCollectCount >= TRIGGER_COLLECT_MAX) {
    console.error(`FAIL: trigger_collect 超出上限 ${TRIGGER_COLLECT_MAX}（D2 Invariant-2），整轮断言失败`);
    process.exit(1);
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const STAGING = arg('staging', 'https://staging-autopilot.zenjoymedia.media');
const OUT = resolve(REPO_ROOT, arg('out', `acceptance-spec/runs/manual-${Date.now()}`));
const KEYWORD = arg('keyword', '装修');
const ACCEPTANCE_TENANT_ID = process.env.ACCEPTANCE_TENANT_ID || null;

const LOG = resolve(OUT, 'capture-log.txt');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

async function snap(page, cellDir, name) {
  mkdirSync(cellDir, { recursive: true });
  await page.screenshot({ path: resolve(cellDir, `${name}.png`), fullPage: false });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 20000));
  writeFileSync(resolve(cellDir, `${name}.page.txt`), text, 'utf8');
}

async function main() {
  // ── 重量级依赖 lazy import（避免顶层 import 在无 playwright/ajv 环境失败）──
  const { CELLS_MAP } = await import('./cells-map.mjs');
  const { getCellCriteria, checkCellsMapComplete, buildPendingCells } = await import('./lib.mjs');
  const { performLogin } = await import('./login.mjs');
  const { chromium } = await import('@playwright/test');

  // ── action 白名单校验（必须在 lazy import 之后）──────────
  const ALLOWED_ACTIONS = new Set(['observe', 'trigger_collect']);
  for (const cell of CELLS_MAP) {
    if (!ALLOWED_ACTIONS.has(cell.action)) {
      console.error(`FAIL: cells-map 含非法 action "${cell.action}" (格 ${cell.id})，D2 白名单仅允许 {observe, trigger_collect}`);
      process.exit(1);
    }
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG, '', 'utf8');

  // ── 凭据解析：无凭据 → ai_incomplete 退出 ────────────────
  const creds = resolveCredentials(
    { email: arg('email', null), password: arg('password', null) },
    process.env
  );

  if (creds.mode === 'ai_incomplete' || creds.ai_incomplete) {
    log(`[ai_incomplete] 无凭据：${creds.error || '未设置 STAGING_ACCEPTANCE_EMAIL / STAGING_ACCEPTANCE_PASSWORD'}`);
    const summary = buildRunSummary({
      mode: 'ai_incomplete',
      email: null,
      staging: STAGING,
      machinesOnline: 0,
      triggerCollectCount: 0,
      aiIncomplete: true,
      versionStamp: { captured_at: new Date().toISOString(), backend_sha: null, frontend_sha: null },
    });
    writeFileSync(resolve(OUT, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    // 不生成 pending-judgments.json
    process.exit(1);
  }

  log(`采证开始 staging=${STAGING} out=${OUT}`);
  log(`身份模式=${creds.mode}${creds.source ? `（凭据来源 ${creds.source}）` : ''} 账号=${creds.email}`);

  // ── 采证前自检：映射与规程必须 1:1 ──────────────────────
  const { errors: mapErrors } = await checkCellsMapComplete(CELLS_MAP);
  if (mapErrors.length > 0) {
    console.error('FAIL: 采证映射与规程不一致，拒绝开跑：');
    for (const e of mapErrors) console.error(' ', e);
    process.exit(1);
  }

  // ── 版本戳：fail-loud（D2 FR-3）────────────────────────
  let backendSha;
  let versionCapturedAt;
  try {
    const r = await fetch(`${STAGING}/api/version`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`/api/version 返回 ${r.status}`);
    const j = await r.json();
    backendSha = j?.sha || j?.build || null;
    versionCapturedAt = new Date().toISOString();
    if (!backendSha) throw new Error('/api/version 响应中无 sha/build 字段');
    log(`版本戳：backend_sha=${backendSha}`);
  } catch (e) {
    log(`[ai_incomplete] /api/version 不可达 → fail-loud 退出：${e.message}`);
    const summary = buildRunSummary({
      mode: creds.mode,
      email: creds.email,
      staging: STAGING,
      machinesOnline: 0,
      triggerCollectCount: 0,
      aiIncomplete: true,
      versionStamp: { captured_at: new Date().toISOString(), backend_sha: null, frontend_sha: null },
    });
    writeFileSync(resolve(OUT, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    process.exit(1);
  }

  const criteria = await getCellCriteria();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);

  const cellState = {}; // id -> { evidence: [], notes: [] }
  for (const c of CELLS_MAP) cellState[c.id] = { evidence: [], notes: [] };
  let machinesOnline = 0;

  const stampSuffix = new Date().toISOString().replace(/[:.]/g, '-');
  const frontendSha = process.env.VITE_BUILD_SHA || null;

  async function captureFor(cellIds, name, note) {
    for (const id of cellIds) {
      const dir = resolve(OUT, 'evidence', id);
      await snap(page, dir, name);
      cellState[id].evidence.push(`evidence/${id}/${name}.png`, `evidence/${id}/${name}.page.txt`);
      if (note) cellState[id].notes.push(note);
    }
  }

  try {
    // ── 步骤1：常驻验收账号登录（S1-c3 observe）────────────
    log('步骤：常驻验收账号登录');
    let loginOk = false;
    try {
      loginOk = await performLogin(page, STAGING, creds.email, creds.password);
      await captureFor(['S1-c3'], '01-after-login', `常驻验收账号登录${loginOk ? '成功' : '后仍停留登录页'}（${creds.email}）`);
      if (!loginOk) {
        cellState['S1-c3'].notes.push('登录后仍停留在登录页');
        log('登录未离开登录页——后续链路格大概率无数据，判官据实判定');
      } else {
        log('登录成功');
      }
    } catch (e) {
      log(`登录交互失败（记录后继续）：${e.message}`);
      cellState['S1-c3'].notes.push(`登录交互失败: ${e.message}`);
      await captureFor(['S1-c3'], '01-login-fail', '登录失败现场');
    }

    // ── 步骤2：机器页（获取 machinesOnline，用于双自检）────
    log('步骤：机器页观察（设备在线/归属）');
    await page.goto(`${STAGING}/dashboard/machines`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S4-c2', 'S4-c3'], '01-machines', '机器列表页（在线状态与最后心跳）');

    // S4-c2 三档取数（D2 FR-1e）：页面时间戳 / 单头 device_reboot_at / 回落 human_only
    try {
      // 优先从页面可见时间戳获取
      const pageText = await page.evaluate(() => document.body.innerText);
      const tsMatch = pageText.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
      if (tsMatch) {
        cellState['S4-c2'].notes.push(`页面时间戳: ${tsMatch[0]}`);
      } else {
        // 回落：标记 human_only（需员工核对）
        cellState['S4-c2'].notes.push('human_only: 页面无可读时间戳，需员工核对 device_reboot_at');
      }
    } catch {
      cellState['S4-c2'].notes.push('human_only: 时间戳读取失败，需员工核对');
    }

    try {
      machinesOnline = await page.locator('text=/在线|online/i').count();
    } catch { /* 计数失败不阻塞 */ }
    log(`机器页可见"在线"字样计数=${machinesOnline}`);

    // ── 双自检（D2 FR-2）：必须在任何 trigger_collect 前执行 ──
    try {
      await assertTenantAndDevice({
        stagingUrl: STAGING,
        acceptanceTenantId: ACCEPTANCE_TENANT_ID,
        machinesOnline,
      });
      log('双自检通过：tenant + machines_online 均满足');
    } catch (e) {
      log(`[ai_incomplete] 双自检失败 → 整轮退出：${e.message}`);
      const summary = buildRunSummary({
        mode: creds.mode,
        email: creds.email,
        staging: STAGING,
        machinesOnline,
        triggerCollectCount: 0,
        aiIncomplete: true,
        versionStamp: { captured_at: versionCapturedAt, backend_sha: backendSha, frontend_sha: frontendSha },
      });
      writeFileSync(resolve(OUT, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
      process.exit(1);
    }

    // ── 步骤3：账号页（S5）────────────────────────────────
    log('步骤：账号页观察');
    await page.goto(`${STAGING}/area/acquisition/accounts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'], '02-accounts', '设备与账号状态页');

    // ── 步骤4：首次 trigger_collect（S6-c3）─────────────────
    log('步骤：任务页首次发起采集（S6-c3）');
    await page.goto(`${STAGING}/area/acquisition/tasks`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S6-c4'], '01-tasks-initial', '新账号任务列表初始状态（归属隔离证据）');
    try {
      assertTriggerCollectQuota(); // 检查配额（第 1 次）
      const kwInput = page.locator('input[placeholder*="关键词"]').first();
      await kwInput.fill(KEYWORD, { timeout: 8000 });
      await page.locator('button:has-text("开始采集")').first().click({ timeout: 5000 });
      await page.waitForTimeout(4000);
      triggerCollectCount += 1;
      await captureFor(['S6-c3'], '01-collect-started', `首次发起采集 关键词=${KEYWORD}（第 ${triggerCollectCount} 次 trigger_collect）`);
      log(`首次采集已发起 关键词=${KEYWORD} trigger_collect_count=${triggerCollectCount}`);
    } catch (e) {
      if (e.message && e.message.includes('trigger_collect 超出上限')) throw e;
      log(`发起采集交互失败（记录后继续）：${e.message}`);
      cellState['S6-c3'].notes.push(`发起采集交互失败: ${e.message}`);
      await captureFor(['S6-c3'], '01-collect-fail', '发起采集失败现场');
    }

    // ── 步骤5：等待任务演进（S7/S8/S9）──────────────────────
    // S7-c2 5分钟终态 / S9-c2 3分钟判定（D2 FR-1d：自持轮询计时）
    log('步骤：等待任务演进（S7: 5分钟终态 / S9: 3分钟判定，每60秒截容）');
    const waitCells = ['S7-c1', 'S7-c2', 'S8-c1', 'S8-c3', 'S8-c4', 'S9-c1', 'S9-c2'];
    const S7_BUDGET_MS = 300000; // 5分钟（规程原文）
    const S9_BUDGET_MS = 180000; // 3分钟（规程原文）
    const waitStart = Date.now();
    let tick = 0;
    let s9Done = false;

    while (Date.now() - waitStart < S7_BUDGET_MS) {
      tick += 1;
      const elapsed = Date.now() - waitStart;
      await page.goto(`${STAGING}/area/acquisition/tasks`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await captureFor(waitCells, `poll-${String(tick).padStart(2, '0')}`, `第${tick}次轮询（${Math.round(elapsed / 1000)}秒）`);

      const bodyText = await page.evaluate(() => document.body.innerText);

      // S9-c2：3分钟内出判定结果
      if (!s9Done && elapsed >= S9_BUDGET_MS) {
        cellState['S9-c2'].notes.push(`3分钟判定检查：${elapsed}ms 时首次检查判定状态`);
        s9Done = true;
      }

      // S7-c2：5分钟终态（提前退出）
      if (/已完成|失败|completed|failed|成功/.test(bodyText)) {
        log(`第${tick}次轮询检测到终态字样，提前结束等待（${Math.round(elapsed / 1000)}秒）`);
        cellState['S7-c2'].notes.push(`${Math.round(elapsed / 1000)}秒内进入终态`);
        break;
      }
      await page.waitForTimeout(60000);
    }

    // 任务详情（若列表有可点行，进入第一条详情补证）
    try {
      const firstRow = page.locator('table tbody tr').first();
      await firstRow.click({ timeout: 5000 });
      await page.waitForTimeout(2500);
      await captureFor(['S8-c1', 'S8-c3', 'S8-c4', 'S9-c1', 'S9-c2', 'S6-c3'], 'task-detail', '任务详情页（视频/判定明细）');
    } catch {
      log('任务详情不可进入（可能无任务行），跳过详情补证');
    }

    // ── 步骤6：线索页首次观察（S10-c1）──────────────────────
    log('步骤：线索页观察');
    await page.goto(`${STAGING}/area/acquisition/leads`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S10-c1'], '01-leads', '线索列表页（首次观察）');

    // ── 步骤7：二次 trigger_collect（S10-c4）────────────────
    log('步骤：二次 trigger_collect（S10-c4，同关键词复采）');
    try {
      assertTriggerCollectQuota(); // 检查配额（第 2 次）
      // 线索页无直接发起按钮，需回到任务页用同关键词二次触发
      await page.goto(`${STAGING}/area/acquisition/tasks`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const kwInput2 = page.locator('input[placeholder*="关键词"]').first();
      await kwInput2.fill(KEYWORD, { timeout: 8000 });
      await page.locator('button:has-text("开始采集")').first().click({ timeout: 5000 });
      await page.waitForTimeout(4000);
      triggerCollectCount += 1;
      // 截图归 S10-c4（二次采集证据）
      await captureFor(['S10-c4'], '02-collect-second', `二次发起采集 关键词=${KEYWORD}（第 ${triggerCollectCount} 次 trigger_collect）`);
      // 线索页截图（对照证据）
      await page.goto(`${STAGING}/area/acquisition/leads`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await captureFor(['S10-c4'], '02-leads-after-second-collect', '二次采集后线索页（两轮数据对照）');
      log(`二次采集已发起 关键词=${KEYWORD} trigger_collect_count=${triggerCollectCount}`);
    } catch (e) {
      if (e.message && e.message.includes('trigger_collect 超出上限')) throw e;
      log(`二次采集交互失败（记录后继续）：${e.message}`);
      cellState['S10-c4'].notes.push(`二次采集交互失败: ${e.message}`);
      await captureFor(['S10-c4'], '02-collect-second-fail', '二次采集失败现场');
    }

    // ── 步骤8：派单页（S11）──────────────────────────────────
    log('步骤：派单页观察');
    await page.goto(`${STAGING}/area/acquisition/outreach`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S11-c1', 'S11-c3', 'S11-c4'], '01-outreach', '派单页');
  } finally {
    await browser.close();
  }

  // ── 待判定骨架（判官填 verdict 后即为 ai-column.json）──────
  const pending = {
    schema_version: 1,
    environment: '预发后台',
    boundary: '验证环境=预发后台；未覆盖：真机/收信端',
    version_stamp: {
      captured_at: versionCapturedAt,
      staging_url: STAGING,
      backend_sha: backendSha,
      frontend_sha: frontendSha,
      apk_expected: '2.1.19',
    },
    run: { trigger: 'manual', operator: 'AI员工采证器' },
    cells: buildPendingCells(CELLS_MAP, criteria, cellState),
  };
  writeFileSync(resolve(OUT, 'pending-judgments.json'), JSON.stringify(pending, null, 2), 'utf8');

  const summary = buildRunSummary({
    mode: creds.mode,
    email: creds.email,
    staging: STAGING,
    machinesOnline,
    triggerCollectCount,
    aiIncomplete: false,
    versionStamp: {
      captured_at: versionCapturedAt,
      backend_sha: backendSha,
      frontend_sha: frontendSha,
    },
  });
  writeFileSync(resolve(OUT, 'run-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  log(`采证完成：${OUT}/pending-judgments.json（${pending.cells.length} 格待判定，trigger_collect_count=${triggerCollectCount}，账号 ${creds.email}）`);
  log(`时间戳后缀参考: ${stampSuffix}`);
}

// 仅在直接运行时执行 main()（被 import 时跳过，供单测 import assertTenantAndDevice）
const isEntryPoint = process.argv[1] && (
  import.meta.url === new URL(process.argv[1], 'file://').href ||
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
);
if (isEntryPoint) {
  main().catch(e => {
    console.error('FAIL: 采证器异常终止：', e.message);
    process.exit(1);
  });
}
