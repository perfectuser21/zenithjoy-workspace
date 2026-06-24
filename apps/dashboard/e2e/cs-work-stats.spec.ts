import { test, expect } from '@playwright/test'

// Line04 客服工作汇总页（S3）E2E — 目标环境 windows_cloud（GHA windows-latest）。
// 打开「客服工作汇总」页 → 看到每客服一张卡片(接收/回复/接待/时长 4 个数 + 真发/演练标)
// → 点「昨天」4 个数变为昨天的值。stats 接口用 page.route 注入 today/yesterday 两套数据。
const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'
const SHOT = '../../sprints/06232241-line04-cs-work-stats/screenshots'

// 两套 stats（今天 vs 昨天），点切换时按 ?date= 返回对应一套
const TODAY = {
  ok: true,
  date: 'today',
  stats: [
    { cs_wechat_id: 'wxid_csa', self_name: '小齐', online: true, auto_agent_enabled: true,
      received_count: 12, reply_count: 9, served_customers: 5, work_duration_minutes: 180 },
    { cs_wechat_id: 'wxid_csb', self_name: '小白', online: false, auto_agent_enabled: false,
      received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 30 },
  ],
}
const YESTERDAY = {
  ok: true,
  date: 'yesterday',
  stats: [
    { cs_wechat_id: 'wxid_csa', self_name: '小齐', online: true, auto_agent_enabled: true,
      received_count: 7, reply_count: 6, served_customers: 4, work_duration_minutes: 95 },
    { cs_wechat_id: 'wxid_csb', self_name: '小白', online: false, auto_agent_enabled: false,
      received_count: 0, reply_count: 0, served_customers: 0, work_duration_minutes: 0 },
  ],
}

function stubStats(page) {
  page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/stats**', (route) => {
    const url = new URL(route.request().url())
    const date = url.searchParams.get('date') || 'today'
    const body = date === 'yesterday' ? YESTERDAY : TODAY
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test('客服工作汇总：每客服卡片 4 个数 + 真发/演练标，切昨天数字变化', async ({ page }) => {
  stubStats(page)
  await page.goto(`${BASE_URL}/wechat/cs-stats`)

  // 今天：CSA 卡片 4 个数正确
  const csaCard = page.getByTestId('cs-stat-card-wxid_csa')
  await expect(csaCard).toBeVisible()
  await expect(csaCard.getByTestId('stat-received')).toContainText('12')
  await expect(csaCard.getByTestId('stat-reply')).toContainText('9')
  await expect(csaCard.getByTestId('stat-served')).toContainText('5')
  await expect(csaCard.getByTestId('stat-duration')).toContainText('180')
  // 真发标（auto_agent_enabled=true）
  await expect(csaCard.getByTestId('stat-mode')).toContainText('真发')
  // CSB 演练标
  const csbCard = page.getByTestId('cs-stat-card-wxid_csb')
  await expect(csbCard.getByTestId('stat-mode')).toContainText('演练')
  await page.screenshot({ path: `${SHOT}/01-today.png`, fullPage: true })

  // 切「昨天」→ CSA received 从 12 → 7
  await page.getByTestId('cs-stats-tab-yesterday').click()
  await expect(csaCard.getByTestId('stat-received')).toContainText('7')
  await expect(csaCard.getByTestId('stat-reply')).toContainText('6')
  await expect(csaCard.getByTestId('stat-duration')).toContainText('95')
  await page.screenshot({ path: `${SHOT}/02-yesterday.png`, fullPage: true })
})

test('某客服无数据 → 卡片显示 4 个 0（不报错不消失）', async ({ page }) => {
  page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, date: 'today',
      stats: [{ cs_wechat_id: 'wxid_idle', self_name: '小闲', online: true, auto_agent_enabled: false,
        received_count: 0, reply_count: 0, served_customers: 0, work_duration_minutes: 0 }],
    }) }))
  await page.goto(`${BASE_URL}/wechat/cs-stats`)
  const card = page.getByTestId('cs-stat-card-wxid_idle')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('stat-received')).toContainText('0')
  await expect(card.getByTestId('stat-served')).toContainText('0')
  await page.screenshot({ path: `${SHOT}/03-empty.png`, fullPage: true })
})
