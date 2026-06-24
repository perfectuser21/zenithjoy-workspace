/**
 * CsOneClickSetupPage（我的客服机 / 一键配置）E2E — 设白名单点「设置完毕」不白屏
 *
 * 复现 P0 bug（2026-06-23 老板实测）：在「我的客服机」选机器、填白名单、点【设置完毕】，
 * 后端写接口安全闸（#838）对非管理员/跨租户返回 403，响应体 `error` 是对象
 * `{code, message}`。旧前端把 `data.error`（对象）直接塞进 error state 再渲染 `{error}`，
 * React 抛「Objects are not valid as a React child」→ 无 ErrorBoundary → 整页白屏。
 *
 * 运行（CI windows runner，dev 起在 VITE_SKIP_AUTH=true）：
 *   npx playwright test e2e/cs-oneclick-setup.spec.ts
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://localhost:5174'

const MOCK_MACHINES = {
  machines: [
    {
      machine_id: 'mid-abc123def456',
      hostname: 'xian-pc',
      configured: true,
      wechat_id: 'cs-mid',
      self_name: '小助手',
      whitelist: ['默忆'],
      auto_agent_enabled: true,
      online: true,
      wechat_ok: true,
    },
  ],
}

// 后端写接口安全闸（#838）拒绝形状：error 是对象 {code, message}（非字符串）
const FORBIDDEN_BODY = {
  success: false,
  data: null,
  error: { code: 'NOT_ADMIN', message: '仅管理员可配置（需 owner / admin 角色）' },
  timestamp: '2026-06-23T00:00:00.000Z',
}

async function stubMachines(page: import('@playwright/test').Page) {
  await page.route('**/api/wechat/cs/machines', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MACHINES),
    })
  )
}

test('设白名单点「设置完毕」遇 403（error 是对象）— 页面不白屏，显示可读提示', async ({ page }) => {
  await stubMachines(page)
  await page.route('**/api/wechat/cs/setup/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify(FORBIDDEN_BODY),
    })
  )

  await page.goto(`${BASE_URL}/wechat/setup`)

  // 选机器（已配那台，预填白名单）
  await page.getByTestId('machine-radio').first().check()
  // 改白名单后点设置完毕
  await page.getByTestId('setup-whitelist').fill('默忆, 客户A')
  await page.getByTestId('setup-submit').click()

  // —— 关键断言：页面没白屏 —— 表单标题还在，且显示了可读的错误提示而非整树崩溃 ——
  await expect(page.getByRole('heading', { name: /我的客服机/ })).toBeVisible()
  await expect(page.getByText('仅管理员可配置（需 owner / admin 角色）')).toBeVisible()
  await page.screenshot({ path: 'screenshots/cs-oneclick-403-no-whitescreen.png', fullPage: true })
})

test('设置成功（200）— 显示成功提示', async ({ page }) => {
  await stubMachines(page)
  await page.route('**/api/wechat/cs/setup/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, wechat_id: 'cs-mid', config: {}, setup_notice: null }),
    })
  )

  await page.goto(`${BASE_URL}/wechat/setup`)
  await page.getByTestId('machine-radio').first().check()
  await page.getByTestId('setup-self-name').fill('小助手')
  await page.getByTestId('setup-whitelist').fill('默忆')
  await page.getByTestId('setup-submit').click()

  await expect(page.getByText(/设置成功/)).toBeVisible()
})
