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

test('管理员：保存后刷新页面，营业时间/每日上限读回新值（Step 3 可观测）', async ({ page }) => {
  stub(page, 'admin')
  // 保存值刻意区别于组件默认（09:00/21:00/50），证明刷新后是 GET 回填、非默认值兜底
  const saved = { wechat_id: 'wxid_csa', persona: { self_name: '小齐' }, business_hours_start: '10:30', business_hours_end: '22:30', daily_limit: 88 }
  await page.route('**/api/wechat/cs/config/**', async route => {
    // PUT 保存 + GET 回填都返回这份新值；page.route 跨 reload 持续生效
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(route.request().method() === 'PUT' ? { success: true, config: saved } : saved) })
  })
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await page.getByTestId('cs-wechat-id-input').fill('wxid_csa')
  await page.getByTestId('cs-business-hours-start').fill('10:30')
  await page.getByTestId('cs-business-hours-end').fill('22:30')
  await page.getByTestId('cs-daily-limit').fill('88')
  await page.getByTestId('cs-save-btn').click()
  await expect(page.getByTestId('cs-save-success')).toBeVisible()
  // —— 刷新页面（URL 已带 ?wechatId）→ 进页 GET 回填 → 断言输入框读回保存的新值 ——
  await page.reload()
  await expect(page.getByTestId('cs-wechat-id-input')).toHaveValue('wxid_csa')
  await expect(page.getByTestId('cs-business-hours-start')).toHaveValue('10:30')
  await expect(page.getByTestId('cs-business-hours-end')).toHaveValue('22:30')
  await expect(page.getByTestId('cs-daily-limit')).toHaveValue('88')
  await page.screenshot({ path: `${SHOT}/04-admin-readback-after-reload.png`, fullPage: true })
})

test('非管理员（member）：配置项只读/禁用 + 显示「仅管理员可配置」', async ({ page }) => {
  stub(page, 'member')
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)
  await expect(page.getByTestId('cs-readonly-notice')).toContainText('仅管理员可配置')
  await expect(page.getByTestId('cs-save-btn')).toBeDisabled()
  await expect(page.getByTestId('cs-daily-limit')).toBeDisabled()
  await page.screenshot({ path: `${SHOT}/03-member-readonly.png`, fullPage: true })
})
