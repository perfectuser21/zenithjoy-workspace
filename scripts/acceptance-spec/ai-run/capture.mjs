#!/usr/bin/env node
/**
 * capture.mjs — AI员工采证器（发版验收双表 · 刀2）
 *
 * 像员工一样从用户端走预发后台：注册 → 发起采集 → 依次走任务/账号/线索/派单页面，
 * 按 cells-map 逐格截图 + 抓取页面可见文本，产出证据包与待判定骨架。
 * 判定不在这里发生——判定属于 AI 判官（见 judge-runbook.md），判据=屏幕所见。
 *
 * 用法:
 *   node scripts/acceptance-spec/ai-run/capture.mjs \
 *     --staging https://staging-autopilot.zenjoymedia.media \
 *     --out acceptance-spec/runs/<自定时间戳>
 *
 * 产出:
 *   <out>/evidence/<格号>/*.png|page.txt   逐格截图与页面文本
 *   <out>/pending-judgments.json           待判定骨架（verdict=null，判官填完后校验为 ai-column.json）
 *   <out>/capture-log.txt                  采证过程流水
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { CELLS_MAP } from './cells-map.mjs';
import { getCellCriteria, checkCellsMapComplete } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const STAGING = arg('staging', 'https://staging-autopilot.zenjoymedia.media');
const OUT = resolve(REPO_ROOT, arg('out', `acceptance-spec/runs/manual-${Date.now()}`));
const KEYWORD = arg('keyword', '装修');

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
  // 采证前自检：映射与规程必须 1:1，否则宁可不产出也不产出半份证据
  const { errors: mapErrors } = await checkCellsMapComplete(CELLS_MAP);
  if (mapErrors.length > 0) {
    console.error('FAIL: 采证映射与规程不一致，拒绝开跑：');
    for (const e of mapErrors) console.error(' ', e);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG, '', 'utf8');
  log(`采证开始 staging=${STAGING} out=${OUT}`);

  // 版本戳：尽力取后端构建号，取不到如实标注
  let backendSha = 'unknown(健康端点未暴露构建号)';
  try {
    const r = await fetch(`${STAGING}/api/walking-skeleton/version`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json();
      if (j?.sha || j?.build) backendSha = String(j.sha || j.build);
    }
  } catch { /* 保持 unknown */ }

  const criteria = await getCellCriteria();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);

  const cellState = {}; // id -> { evidence: [], notes: [] }
  for (const c of CELLS_MAP) cellState[c.id] = { evidence: [], notes: [] };

  const stampSuffix = new Date().toISOString().replace(/[:.]/g, '-');
  const email = `ai-table-${Date.now()}@zenithjoy.test`;
  const password = 'AiTable!2026';

  async function captureFor(cellIds, name, note) {
    for (const id of cellIds) {
      const dir = resolve(OUT, 'evidence', id);
      await snap(page, dir, name);
      cellState[id].evidence.push(`evidence/${id}/${name}.png`, `evidence/${id}/${name}.page.txt`);
      if (note) cellState[id].notes.push(note);
    }
  }

  try {
    // ── 用户流1：注册（S1-c3 的直接证据：在预发域名完成注册+授权）──
    log('步骤：注册用户流');
    await page.goto(`${STAGING}/signup`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await captureFor(['S1-c3'], '01-signup-page', '注册页（预发域名可见）');
    // 尽力走真实注册表单（字段名按常见命名探测，探不到则记录并继续）
    try {
      const nameInput = page.locator('input[name="name"], input[placeholder*="名"], input[autocomplete="name"]').first();
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const pwdInput = page.locator('input[type="password"]').first();
      await nameInput.fill('AI验收员', { timeout: 5000 });
      await emailInput.fill(email, { timeout: 5000 });
      await pwdInput.fill(password, { timeout: 5000 });
      await page.locator('button[type="submit"], button:has-text("注册")').first().click({ timeout: 5000 });
      await page.waitForTimeout(4000);
      await captureFor(['S1-c3'], '02-after-signup', `注册提交后（账号 ${email}）`);
      log(`注册表单已提交：${email}`);
    } catch (e) {
      log(`注册表单交互失败（记录后继续，判官据此判无法验证）：${e.message}`);
      cellState['S1-c3'].notes.push(`注册表单交互失败: ${e.message}`);
    }

    // ── 用户流2：发起采集（S6-c3 触发 + S6-c4 归属隔离）──
    log('步骤：任务页发起采集');
    await page.goto(`${STAGING}/area/acquisition/tasks`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S6-c4'], '01-tasks-initial', '新账号任务列表初始状态（归属隔离证据）');
    try {
      const kwInput = page.locator('input[placeholder*="关键词"]').first();
      await kwInput.fill(KEYWORD, { timeout: 8000 });
      await page.locator('button:has-text("开始采集")').first().click({ timeout: 5000 });
      await page.waitForTimeout(4000);
      await captureFor(['S6-c3'], '01-collect-started', `已发起采集 关键词=${KEYWORD}`);
      log(`采集已发起 关键词=${KEYWORD}`);
    } catch (e) {
      log(`发起采集交互失败（记录后继续）：${e.message}`);
      cellState['S6-c3'].notes.push(`发起采集交互失败: ${e.message}`);
      await captureFor(['S6-c3'], '01-collect-fail', '发起采集失败现场');
    }

    // ── 用户流3：等待任务演进（S7/S8/S9，预算=规程原文，轮询截容）──
    log('步骤：等待任务演进（最长5分钟，每60秒截容一次）');
    const waitCells = ['S7-c1', 'S7-c2', 'S8-c1', 'S8-c3', 'S8-c4', 'S9-c1', 'S9-c2'];
    const start = Date.now();
    let tick = 0;
    while (Date.now() - start < 300000) {
      tick += 1;
      await page.goto(`${STAGING}/area/acquisition/tasks`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      await captureFor(waitCells, `poll-${String(tick).padStart(2, '0')}`, `第${tick}次轮询（${Math.round((Date.now() - start) / 1000)}秒）`);
      // 若列表出现明显终态字样则提前结束（成功/失败/completed/failed）
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (/已完成|失败|completed|failed|成功/.test(bodyText)) {
        log(`第${tick}次轮询检测到终态字样，提前结束等待`);
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

    // ── 用户流4：账号页（S4/S5）──
    log('步骤：账号页观察');
    await page.goto(`${STAGING}/area/acquisition/accounts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4'], '01-accounts', '设备与账号状态页');

    // ── 用户流5：线索页（S10）──
    log('步骤：线索页观察');
    await page.goto(`${STAGING}/area/acquisition/leads`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S10-c1', 'S10-c4'], '01-leads', '线索列表页');

    // ── 用户流6：派单页（S11/S13）──
    log('步骤：派单页观察');
    await page.goto(`${STAGING}/area/acquisition/outreach`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await captureFor(['S11-c1', 'S11-c3', 'S11-c4', 'S13-c4'], '01-outreach', '私信派单页');
  } finally {
    await browser.close();
  }

  // ── 待判定骨架（判官填 verdict 后即为 ai-column.json）──
  const pending = {
    schema_version: 1,
    environment: '预发后台',
    boundary: '验证环境=预发后台；未覆盖：真机/收信端',
    version_stamp: {
      captured_at: new Date().toISOString(),
      staging_url: STAGING,
      backend_sha: backendSha,
      apk_expected: '2.1.19',
    },
    run: { trigger: 'manual', operator: 'AI员工采证器' },
    cells: CELLS_MAP.map(c => ({
      id: c.id,
      verdict: null, // 由 AI 判官按 judge-runbook.md 依据截图/页面文本填写：通过 | 不通过 | 无法验证
      criteria: criteria[c.id]?.criteria || '',
      symptoms: [],
      reasons: [],
      evidence: cellState[c.id].evidence.length > 0 ? cellState[c.id].evidence : ['(采证缺失——判官必须判无法验证并注明)'],
      ...(c.scenario_required ? { scenario_required: true } : {}),
      ...(cellState[c.id].notes.length > 0 ? { note: cellState[c.id].notes.join('；') } : {}),
    })),
  };
  writeFileSync(resolve(OUT, 'pending-judgments.json'), JSON.stringify(pending, null, 2), 'utf8');
  log(`采证完成：${OUT}/pending-judgments.json（${pending.cells.length} 格待判定，账号 ${email}）`);
  log(`时间戳后缀参考: ${stampSuffix}`);
}

main().catch(e => {
  console.error('FAIL: 采证器异常终止：', e.message);
  process.exit(1);
});
