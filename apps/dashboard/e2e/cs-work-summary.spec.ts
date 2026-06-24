// cs-work-summary.spec.ts — 客服工作汇总页：每客服一卡 4 数 + mode 标 + 今天/昨天切换
// page.route stub /cs/stats（纯前端渲染逻辑，无 DB；后端口径由 ci-l4 smoke 验）
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT_DIR = '../../sprints/06232241-line04-cs-work-stats/screenshots'

const TODAY = {
  ok: true, date: 'today', timezone: 'Asia/Shanghai',
  agents: [{ cs_wechat_id: 'wxid_a', cs_name: '客服小美', online: true, mode: 'live',
    received_count: 10, reply_count: 8, served_customers: 3, work_duration_minutes: 45 }],
}
const YESTERDAY = {
  ok: true, date: 'yesterday', timezone: 'Asia/Shanghai',
  agents: [{ cs_wechat_id: 'wxid_a', cs_name: '客服小美', online: true, mode: 'live',
    received_count: 2, reply_count: 1, served_customers: 1, work_duration_minutes: 5 }],
}

async function stub(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/wechat/cs/stats**', (r) => {
    const url = new URL(r.request().url())
    const body = url.searchParams.get('date') === 'yesterday' ? YESTERDAY : TODAY
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('汇总页：每客服一卡 4 数 + 真发标 + 今天/昨天切换', async ({ page }) => {
  await stub(page)
  await page.goto(`${BASE_URL}/wechat/cs-stats`)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${SHOT_DIR}/01-initial.png`, fullPage: true })

  const card = page.getByTestId('cs-card-wxid_a')
  await expect(card).toBeVisible({ timeout: 10000 })
  await expect(card.getByTestId('received-count')).toHaveText('10')
  await expect(card.getByTestId('reply-count')).toHaveText('8')
  await expect(card.getByTestId('served-customers')).toHaveText('3')
  await expect(card.getByTestId('work-duration')).toContainText('45')
  await expect(card.getByTestId('cs-mode-badge')).toContainText('真发')
  await page.screenshot({ path: `${SHOT_DIR}/02-action.png`, fullPage: true })

  await page.getByTestId('date-toggle-yesterday').click()
  await expect(card.getByTestId('received-count')).toHaveText('2')
  await expect(card.getByTestId('reply-count')).toHaveText('1')
  await page.screenshot({ path: `${SHOT_DIR}/03-result.png`, fullPage: true })
})
