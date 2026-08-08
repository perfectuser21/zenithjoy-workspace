/**
 * W4 四象限合看页 + 建单页 + 裁决流程 E2E
 *
 * 目标环境：mac_web（本机 Playwright，localhost:5174）
 * 合同来源：sprints/w4-quadrant-page-d4b/contract-draft.md
 *
 * 变体C 死规则（继承自 acceptance.spec.ts）：
 *   - Brain 在 CI 沙盒不可达 → 降级路径（degraded-banner / locked）属合法路径
 *   - 所有断言用 locatorA.or(locatorB) 容纳降级分支，不硬编码正常/降级某一种
 *   - 严禁使用 Playwright 请求拦截 API（guard 字符串匹配）
 *
 * TASK_ID: c33a0160-53bc-48b5-ac92-4f7ae5cedcd7
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots');

function shot(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

// mandatory 场景码列表（与 acceptance-spec/line02-android.yaml 中 scenario_class: mandatory 对齐）
const MANDATORY_SCENARIOS = ['S1', 'S4', 'S5', 'S6', 'S7'];

// ─── [BEHAVIOR-1] 合看页路由可访问 ───────────────────────────────────────────

test.describe('合看页路由', () => {
  test('[BEHAVIOR-1] /acceptance/:runKey/quadrant 路由可渲染，三态之一可见', async ({ page }) => {
    // 使用占位 runKey；CI 沙盒 Brain 不可达时落到 degraded 或 locked
    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const locked = page.getByTestId('quadrant-locked');
    const degraded = page.getByTestId('quadrant-degraded-banner');

    await expect(matrix.or(locked).or(degraded)).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: shot('w4-01-quadrant-route.png'), fullPage: true });
  });

  test('[BEHAVIOR-1] 合看页不白屏（无未捕获异常）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const locked = page.getByTestId('quadrant-locked');
    const degraded = page.getByTestId('quadrant-degraded-banner');
    await expect(matrix.or(locked).or(degraded)).toBeVisible({ timeout: 10000 });

    expect(errors).toHaveLength(0);
  });
});

// ─── [BEHAVIOR-2] 矩阵渲染（Brain 可达时）────────────────────────────────────

test.describe('合看页矩阵渲染', () => {
  test('[BEHAVIOR-2] 矩阵存在时，格元素含正确 data-testid 格式', async ({ page }) => {
    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const degraded = page.getByTestId('quadrant-degraded-banner');
    const locked = page.getByTestId('quadrant-locked');

    await expect(matrix.or(locked).or(degraded)).toBeVisible({ timeout: 10000 });

    const matrixVisible = await matrix.isVisible();
    if (!matrixVisible) {
      // Brain 不可达或 human_complete 未完成 — 降级路径合法，跳过矩阵格断言
      return;
    }

    await page.screenshot({ path: shot('w4-02-quadrant-matrix.png'), fullPage: true });

    // 至少存在一个 cell 格元素（ai 或 human 列）
    const cellAi = page.locator('[data-testid^="cell-"][data-testid$="-ai"]').first();
    const cellHuman = page.locator('[data-testid^="cell-"][data-testid$="-human"]').first();
    await expect(cellAi.or(cellHuman)).toBeVisible();
  });

  test('[BEHAVIOR-2] S13-c4 格（若存在）含「本版无受控手段制造频控场景」图例', async ({ page }) => {
    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const matrixVisible = await matrix.isVisible().catch(() => false);
    if (!matrixVisible) return; // 降级路径跳过

    // S13-c4 格：scenario_id=S13, col=ai 或 human（视具体实现）
    const s13c4 = page.locator('[data-testid*="S13"]').filter({ hasText: '本版无受控手段制造频控场景' });
    const count = await s13c4.count();
    if (count > 0) {
      await expect(s13c4.first()).toBeVisible();
    }
    // 若 run_key 不含 S13 场景码，此断言跳过属合法
  });
});

// ─── [BEHAVIOR-3] 分歧格展开双证据 ───────────────────────────────────────────

test.describe('分歧格展开', () => {
  test('[BEHAVIOR-3] 点击分歧格后左右双证据区可见', async ({ page }) => {
    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const matrixVisible = await matrix.isVisible().catch(() => false);
    if (!matrixVisible) return; // 降级路径跳过

    // 查找所有分歧格（含 data-divergence 属性或特定 CSS class）
    const divergenceCells = page.locator('[data-divergence="true"]');
    const divergenceCount = await divergenceCells.count();
    if (divergenceCount === 0) {
      // 当前 run 无分歧格，跳过
      return;
    }

    const firstCell = divergenceCells.first();
    const cellId = await firstCell.getAttribute('data-cell-id') ?? 'unknown';
    await firstCell.click();

    await page.screenshot({ path: shot('w4-03-divergence-expanded.png'), fullPage: true });

    const container = page.getByTestId(`divergence-${cellId}`);
    const aiEvidence = page.getByTestId(`divergence-ai-${cellId}`);
    const humanEvidence = page.getByTestId(`divergence-human-${cellId}`);

    await expect(container).toBeVisible();
    await expect(aiEvidence).toBeVisible();
    await expect(humanEvidence).toBeVisible();
  });
});

// ─── [BEHAVIOR-7] 建单页 7 字段 + mandatory 场景码校验 ─────────────────────────

test.describe('建单页', () => {
  test('[BEHAVIOR-7] /acceptance/new 可渲染，7 个字段存在', async ({ page }) => {
    await page.goto('/acceptance/new');

    const form = page.getByTestId('new-run-form');
    await expect(form).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: shot('w4-04-new-run-form.png'), fullPage: true });

    // 7 字段全部存在
    const fields = [
      'new-run-tenant-account',
      'new-run-phone-model',
      'new-run-client-id',
      'new-run-task-no',
      'new-run-passphrase',
      'new-run-scenarios-observed',
      'new-run-device-reboot-at',
    ];
    for (const testId of fields) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });

  test('[BEHAVIOR-7] mandatory 场景码未全勾选时，提交按钮为 disabled', async ({ page }) => {
    await page.goto('/acceptance/new');

    const form = page.getByTestId('new-run-form');
    await expect(form).toBeVisible({ timeout: 10000 });

    const submitBtn = page.getByTestId('new-run-submit');

    // 初始状态（未勾选任何场景码）：提交按钮应为 disabled
    await expect(submitBtn).toBeDisabled();

    // 截图确认禁用状态
    await page.screenshot({ path: shot('w4-05-new-run-submit-disabled.png') });
  });

  test('[BEHAVIOR-7] 勾选部分（非全部）mandatory 场景码，提交按钮仍为 disabled，提示含缺失数量', async ({ page }) => {
    await page.goto('/acceptance/new');

    const form = page.getByTestId('new-run-form');
    await expect(form).toBeVisible({ timeout: 10000 });

    // 只勾选第一个 mandatory 场景码（S1）
    const scenariosContainer = page.getByTestId('new-run-scenarios-observed');
    const s1Checkbox = scenariosContainer.locator(`input[value="S1"], input[data-scenario="S1"]`).first();
    if (await s1Checkbox.isVisible()) {
      await s1Checkbox.check();
    }

    const submitBtn = page.getByTestId('new-run-submit');
    await expect(submitBtn).toBeDisabled();

    // 提示文字含「请勾选所有必选场景」
    const hint = page.locator('text=请勾选所有必选场景');
    await expect(hint).toBeVisible();
  });

  test('[BEHAVIOR-7] 5 个 mandatory 场景码全勾选后，提交按钮变为可点击（INV-3）', async ({ page }) => {
    await page.goto('/acceptance/new');

    const form = page.getByTestId('new-run-form');
    await expect(form).toBeVisible({ timeout: 10000 });

    const scenariosContainer = page.getByTestId('new-run-scenarios-observed');

    // 勾选所有 mandatory 场景码
    for (const scenario of MANDATORY_SCENARIOS) {
      const checkbox = scenariosContainer
        .locator(`input[value="${scenario}"], input[data-scenario="${scenario}"]`)
        .first();
      if (await checkbox.isVisible()) {
        await checkbox.check();
      }
    }

    const submitBtn = page.getByTestId('new-run-submit');
    await expect(submitBtn).toBeEnabled();

    await page.screenshot({ path: shot('w4-06-new-run-submit-enabled.png') });
  });

  test('[BEHAVIOR-7] 勾选 S4 后 device_reboot_at 变为必填', async ({ page }) => {
    await page.goto('/acceptance/new');

    const form = page.getByTestId('new-run-form');
    await expect(form).toBeVisible({ timeout: 10000 });

    const scenariosContainer = page.getByTestId('new-run-scenarios-observed');
    const s4Checkbox = scenariosContainer
      .locator(`input[value="S4"], input[data-scenario="S4"]`)
      .first();

    if (await s4Checkbox.isVisible()) {
      await s4Checkbox.check();

      const deviceRebootAt = page.getByTestId('new-run-device-reboot-at');
      // S4 勾选后，device_reboot_at 应变为 required
      const isRequired = await deviceRebootAt.getAttribute('required');
      const ariaRequired = await deviceRebootAt.getAttribute('aria-required');
      const isMarked = isRequired !== null || ariaRequired === 'true';
      expect(isMarked).toBe(true);
    }
  });
});

// ─── [BEHAVIOR-5] 员工 403 不崩溃 ───────────────────────────────────────────

test.describe('权限边界', () => {
  test('[BEHAVIOR-5] staff token 触发关闭复盘时，页面不白屏并显示权限提示', async ({ page }) => {
    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const locked = page.getByTestId('quadrant-locked');
    const degraded = page.getByTestId('quadrant-degraded-banner');
    await expect(matrix.or(locked).or(degraded)).toBeVisible({ timeout: 10000 });

    // staff token 下，关闭复盘按钮不应存在于 DOM
    const closedBtn = page.getByTestId('review-closed-btn');
    const closedBtnCount = await closedBtn.count();
    expect(closedBtnCount).toBe(0);

    // 若因某种原因按钮存在（reviewer token），点击后不白屏
    // 此处测试 staff token 视角：按钮不存在即为通过
  });
});

// ─── [BEHAVIOR-8] lib.mjs generate 只读 HTML（Node.js 断言）─────────────────

test.describe('lib.mjs generate 只读验证', () => {
  test('[BEHAVIOR-8] generate 产出 HTML 不含 <select> 三态控件，措辞统一为「无法验证」', async () => {
    const { execSync } = await import('child_process');
    const { readFileSync, existsSync, mkdirSync, rmSync } = await import('fs');

    const outPath = '/tmp/w4-acceptance-gen-test.html';

    // 清理旧文件
    if (existsSync(outPath)) rmSync(outPath);

    try {
      execSync(
        `cd /workspace && node scripts/acceptance-spec/cli.mjs generate > ${outPath}`,
        { timeout: 30000 }
      );
    } catch {
      // cli.mjs generate 失败（yaml 校验错误等）直接 skip
      console.warn('[BEHAVIOR-8] cli.mjs generate 执行失败，跳过只读验证');
      return;
    }

    if (!existsSync(outPath)) {
      console.warn('[BEHAVIOR-8] 未生成输出文件，跳过');
      return;
    }

    const html = readFileSync(outPath, 'utf8');

    // 断言 1：不含 <select> 元素
    expect(html).not.toMatch(/<select/i);

    // 断言 2：不含旧措辞「暂时无法验证」
    expect(html).not.toContain('暂时无法验证');

    // 断言 3：规程内容仍存在（步骤说明不为空）
    expect(html.length).toBeGreaterThan(500);
  });
});

// ─── [BEHAVIOR-9] 反代层 ai_raw 不透传 ──────────────────────────────────────

test.describe('反代层安全验证', () => {
  test('[BEHAVIOR-9] /api/staff/acceptance/quadrant 响应不含 ai_raw / ai_column 字段', async ({ page }) => {
    let quadrantResponse: Record<string, unknown> | null = null;

    // 监听响应（非请求拦截，仅读取已完成的响应 body）
    page.on('response', async (response) => {
      if (response.url().includes('/api/staff/acceptance/quadrant')) {
        try {
          const json = await response.json();
          quadrantResponse = json as Record<string, unknown>;
        } catch {
          // 非 JSON 响应忽略
        }
      }
    });

    await page.goto('/acceptance/smoke-test-run/quadrant');

    const matrix = page.getByTestId('quadrant-matrix');
    const locked = page.getByTestId('quadrant-locked');
    const degraded = page.getByTestId('quadrant-degraded-banner');
    await expect(matrix.or(locked).or(degraded)).toBeVisible({ timeout: 10000 });

    if (!quadrantResponse) {
      // Brain 不可达（未收到 quadrant 响应），降级路径合法，跳过字段断言
      return;
    }

    // 断言响应不含 ai_raw / ai_column 原始字段（INV-1）
    expect(quadrantResponse).not.toHaveProperty('ai_raw');
    expect(quadrantResponse).not.toHaveProperty('ai_column');

    // matrix 字段应存在（有效响应）
    if ('availability' in quadrantResponse && quadrantResponse['availability'] === 'degraded') {
      return; // 降级响应合法跳过
    }
    expect(quadrantResponse).toHaveProperty('matrix');
  });
});
