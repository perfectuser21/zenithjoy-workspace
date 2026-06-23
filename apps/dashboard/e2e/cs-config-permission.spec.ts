import { test, expect } from '@playwright/test'
const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT = '../../sprints/06232248-line04-cs-config-permission/screenshots'

// 注入 my-role 响应（admin / member 两态），auth 走未登录免跳转（requireAuth:false 路由）
function stub(page, role) {
  page.route('**/api/auth/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/my-role', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ role, can_config: role === 'admin' || role === 'owner' }) }))
}

test('管理员：营业时间+每日上限输入可见可编辑，填写保存读回', async ({ page }) => {
  stub(page, 'admin')
  let putBody = {}
  await page.route('**/api/wechat/cs/config/**', async route => {
    putBody = route.request().method() === 'PUT' ? JSON.parse(route.request().postData() || '{}') : putBody
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, config: { wechat_id: 'wxid_csa', persona: { self_name: '小齐' }, business_hours_start: '09:00', daily_limit: 50 } }) })
  })
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await expect(page.getByTestId('cs-business-hours-start')).toBeVisible()
  await expect(page.getByTestId('cs-business-hours-end')).toBeVisible()
  await expect(page.getByTestId('cs-daily-limit')).toBeEnabled()
  await page.screenshot({ path: `${SHOT}/01-admin-initial.png`, fullPage: true })
  await page.getByTestId('cs-wechat-id-input').fill('wxid_csa')
  await page.getByTestId('cs-business-hours-start').fill('09:00')
  await page.getByTestId('cs-daily-limit').fill('50')
  await page.getByTestId('cs-save-btn').click()
  await page.screenshot({ path: `${SHOT}/02-admin-saved.png`, fullPage: true })
  await expect(page.getByTestId('cs-save-success')).toBeVisible()
  expect(putBody.business_hours_start).toBe('09:00')
  expect(putBody.daily_limit).toBe(50)
})

test('非管理员（member）：配置项只读/禁用 + 显示「仅管理员可配置」', async ({ page }) => {
  stub(page, 'member')
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await expect(page.getByTestId('cs-readonly-notice')).toContainText('仅管理员可配置')
  await expect(page.getByTestId('cs-save-btn')).toBeDisabled()
  await expect(page.getByTestId('cs-daily-limit')).toBeDisabled()
  await page.screenshot({ path: `${SHOT}/03-member-readonly.png`, fullPage: true })
})
