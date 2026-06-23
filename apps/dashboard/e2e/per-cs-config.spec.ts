/**
 * Line04 每客服设置区 E2E（windows job，page.route 拦后端，无 DB）
 *
 * 验前台「每客服设置区」编辑该客服那一行并保存：
 *  - 初始加载：客服微信号输入框 + 人设/开关/白名单字段可见
 *  - 填客服 A 微信号 wxid_csa + 人设「萌萌」点保存 → 拦截到的 PUT url 含 wxid_csa
 *    且 body.persona.self_name === "萌萌"（验「只写该客服那一行」）
 *  - 保存成功提示可见 + 回显人设「萌萌」
 *
 * 截图存 sprints/06222337-line04-per-cs-config/screenshots/<step>.png（cwd=apps/dashboard）。
 *
 * 运行：npx playwright test e2e/per-cs-config.spec.ts
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT_DIR = '../../sprints/06222337-line04-per-cs-config/screenshots'

// 让 auth 快速判定为未登录（requireAuth:false 路由直接渲染该页，不跳登录）
// 该页编辑动作需管理员（Sprint 06232248 Issue 96db53be 加了 my-role 只读闸）→ stub 成 admin 可编辑。
async function stubAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/wechat/cs/my-role', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'admin', can_config: true }),
    }),
  )
}

test('每客服设置区初始加载 — 微信号 + 人设/开关/白名单字段可见', async ({ page }) => {
  await stubAuth(page)
  await page.goto(`${BASE_URL}/wechat/per-cs-config`)

  await expect(page.getByTestId('cs-wechat-id-input')).toBeVisible()
  await expect(page.getByTestId('cs-persona-name-input')).toBeVisible()
  await expect(page.getByTestId('cs-auto-agent-toggle')).toBeVisible()
  await expect(page.getByTestId('cs-whitelist-input')).toBeVisible()

  await page.screenshot({ path: `${SHOT_DIR}/01-initial.png`, fullPage: true })
})

test('填客服 A 保存 → PUT 只写 wxid_csa 那一行 + body.persona.self_name=萌萌 + 回显', async ({
  page,
}) => {
  await stubAuth(page)

  let putUrl = ''
  let putBody: { persona?: { self_name?: string } } = {}
  await page.route('**/api/wechat/cs/config/**', async (route) => {
    const req = route.request()
    putUrl = req.url()
    putBody = JSON.parse(req.postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, config: putBody }),
    })
  })

  await page.goto(`${BASE_URL}/wechat/per-cs-config`)

  await page.getByTestId('cs-wechat-id-input').fill('wxid_csa')
  await page.getByTestId('cs-persona-name-input').fill('萌萌')
  await page.getByTestId('cs-save-btn').click()

  // 保存成功提示
  await expect(page.getByTestId('cs-save-success')).toBeVisible()
  await page.screenshot({ path: `${SHOT_DIR}/02-action.png`, fullPage: true })

  // 验「只写该客服那一行」：URL 含 wxid_csa；body 人设正确
  expect(putUrl).toContain('wxid_csa')
  expect(putBody.persona?.self_name).toBe('萌萌')

  // 回显人设
  await expect(page.getByTestId('cs-persona-name-result')).toHaveText('萌萌')
  await page.screenshot({ path: `${SHOT_DIR}/03-result.png`, fullPage: true })
})
