/**
 * Staff Hub 业务线健康看板（GP3 / line-health）E2E — 真实后端，禁用 Playwright 请求拦截 API
 *
 * 覆盖 contract-dod.md [BEHAVIOR:E2E] 的 Golden Path 四步 + 四张截图：
 *   01-overview.png       总览页 3 张卡片，line01/line02 显示"未接入"徽章
 *   02-detail-deploy.png  点 line04 卡片进详情页，默认"部署"tab 渲染三环境状态
 *   03-detail-abilities.png 切"能力"tab，渲染能力清单或"数据暂不可达"降级文案（二者均可）
 *   04-fallback-banner.png product-map.json 缺失场景下页面顶部出现降级 banner
 *
 * 变体C 死规则：所有断言打真实 apps/api（无 stub），因此
 *   - Brain 在 CI/沙盒可能不可达 → line04 走 degraded 分支，属合法路径（合同「未覆盖真实链路清单」第2条）
 *   - GitHub 未认证可能限流 → environments 可能全 unavailable，断言只看结构不看具体数据
 *
 * product-map 缺失场景不伪造 HTTP 响应，而是在 Node 侧真重命名文件
 * （apps/api 每次请求真读该文件），跑完立即恢复。
 *
 * 注意：本文件正文与注释都不得出现 Playwright 拦截 API 的字面调用串 —— 合同 DoD 的
 * [ARTIFACT] 检查、workflow guard 与 e2e-verify.ps1 都用纯字符串匹配把关，注释里提一嘴也会误伤。
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots');
// spec 的 cwd 是 apps/staff-hub；product-map 在仓库根
const PRODUCT_MAP = path.resolve(process.cwd(), '../../product-map/generated/product-map.json');

function shot(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

test.describe('Staff Hub 业务线健康看板', () => {
  test('总览页渲染 3 张业务线卡片，line01/line02 显示未接入徽章', async ({ page }) => {
    await page.goto('/line-health');
    await expect(page.getByTestId('line-health-page')).toBeVisible();

    for (const key of ['line01', 'line02', 'line04']) {
      await expect(page.getByTestId(`line-card-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId('line-badge-line01')).toHaveText('未接入');
    await expect(page.getByTestId('line-badge-line02')).toHaveText('未接入');
    await expect(page.getByTestId('line-not-connected-line01')).toBeVisible();

    await page.screenshot({ path: shot('01-overview.png'), fullPage: true });
  });

  test('点击 line04 卡片进详情页，默认部署 tab 渲染三环境状态', async ({ page }) => {
    await page.goto('/line-health');
    await page.getByTestId('line-card-line04').click();

    await expect(page).toHaveURL(/\/line-health\/line04$/);
    await expect(page.getByTestId('line-detail-page')).toBeVisible();
    await expect(page.getByTestId('deployment-panel')).toBeVisible();
    await expect(page.getByTestId('deployment-environments')).toBeVisible();
    for (const env of ['dev', 'staging', 'production']) {
      await expect(page.getByTestId(`env-row-${env}`)).toBeVisible();
    }

    await page.screenshot({ path: shot('02-detail-deploy.png'), fullPage: true });
  });

  test('切换能力 tab，渲染能力清单或数据暂不可达降级文案', async ({ page }) => {
    await page.goto('/line-health/line04');
    await page.getByTestId('tab-abilities').click();

    await expect(page.getByTestId('abilities-panel')).toBeVisible();
    // Brain 在 windows_cloud 沙盒不可达时走 abilities-empty 降级文案，两种结果均视为通过
    const list = page.getByTestId('abilities-list');
    const empty = page.getByTestId('abilities-empty');
    await expect(list.or(empty)).toBeVisible();

    await page.screenshot({ path: shot('03-detail-abilities.png'), fullPage: true });
  });

  test('未接入业务线（line01）两个 tab 均显示空态文案，且可返回总览', async ({ page }) => {
    await page.goto('/line-health/line01');
    await expect(page.getByTestId('deployment-not-connected')).toHaveText(
      '该业务线尚未接入 Brain 数据，暂无法展示'
    );
    await page.getByTestId('tab-abilities').click();
    await expect(page.getByTestId('abilities-not-connected')).toHaveText(
      '该业务线尚未接入 Brain 数据，暂无法展示'
    );

    await page.getByTestId('back-to-overview').click();
    await expect(page.getByTestId('line-health-page')).toBeVisible();
  });

  test('product-map.json 缺失时页面顶部出现降级 banner，而非白屏', async ({ page }) => {
    const backup = `${PRODUCT_MAP}.e2e-bak`;
    fs.renameSync(PRODUCT_MAP, backup);
    try {
      await page.goto('/line-health');
      await expect(page.getByTestId('fallback-banner')).toBeVisible();
      // 兜底清单仍要渲染 3 张卡片（不是白屏/空数组）
      for (const key of ['line01', 'line02', 'line04']) {
        await expect(page.getByTestId(`line-card-${key}`)).toBeVisible();
      }
      await page.screenshot({ path: shot('04-fallback-banner.png'), fullPage: true });
    } finally {
      fs.renameSync(backup, PRODUCT_MAP);
    }
  });
});
