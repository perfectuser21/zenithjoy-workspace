import { test, expect } from '@playwright/test'

// Line04 客服工作汇总页（S3）E2E — 目标环境 windows_cloud（GHA windows-latest）。
// 打开「客服工作汇总」页 → 看到每客服一张卡片(接收/回复/接待/时长 4 个数 + 真发/演练标)
// → 点「昨天」4 个数变为昨天的值。stats 接口用 page.route 注入 today/yesterday 两套数据。
// 截图写到 apps/dashboard/screenshots/（Playwright cwd 相对路径），CI 把整目录传成 artifact 供老板眼见为实。
const SHOT = 'screenshots/cs-work-stats'

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
  await page.goto('/wechat/cs-stats')

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

// 整合（2026-06-25）：客服日报并进「历史」Tab，拉 GET /wechat/cs/daily-report?date=YYYY-MM-DD（含小结）
test('历史 Tab：选日期看那天的日报（4 个数 + 一句话小结）', async ({ page }) => {
  page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  // 今天/昨天走 stats（默认进页拉 today）
  page.route('**/api/wechat/cs/stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TODAY) }))
  // 历史走 daily-report，返回带 summary_text 的结算日报
  page.route('**/api/wechat/cs/daily-report**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, date: '2026-06-20',
      reports: [{ cs_wechat_id: 'wxid_csa', self_name: '小齐', report_date: '2026-06-20',
        received_count: 20, reply_count: 18, served_customers: 9, work_duration_minutes: 240,
        summary_text: '当天高峰咨询，回复及时' }],
    }) }))

  await page.goto('/wechat/cs-stats')
  // 切「历史」Tab → 出现日期选择器 + 查看按钮
  await page.getByTestId('cs-stats-tab-history').click()
  await expect(page.getByTestId('cs-stats-date-input')).toBeVisible()
  await page.getByTestId('cs-stats-date-input').fill('2026-06-20')
  await page.getByTestId('cs-stats-history-load-btn').click()

  const card = page.getByTestId('cs-stat-card-wxid_csa')
  await expect(card.getByTestId('stat-received')).toContainText('20')
  await expect(card.getByTestId('stat-duration')).toContainText('240')
  // 历史日报特有：一句话小结
  await expect(card.getByTestId('stat-summary')).toContainText('当天高峰咨询')
  await page.screenshot({ path: `${SHOT}/04-history-daily-report.png`, fullPage: true })
})

test('某客服无数据 → 卡片显示 4 个 0（不报错不消失）', async ({ page }) => {
  page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, date: 'today',
      stats: [{ cs_wechat_id: 'wxid_idle', self_name: '小闲', online: true, auto_agent_enabled: false,
        received_count: 0, reply_count: 0, served_customers: 0, work_duration_minutes: 0 }],
    }) }))
  await page.goto('/wechat/cs-stats')
  const card = page.getByTestId('cs-stat-card-wxid_idle')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('stat-received')).toContainText('0')
  await expect(card.getByTestId('stat-served')).toContainText('0')
  await page.screenshot({ path: `${SHOT}/03-empty.png`, fullPage: true })
})
