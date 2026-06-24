import { test, expect } from '@playwright/test'

// Line04 客服日报页（S4）E2E — 目标环境 windows_cloud（GHA windows-latest）。
// 选历史日期 → 看到那天每客服 4 个数 + 小结。daily-report 查询端点用 page.route 注入。
const SHOT = '../../sprints/06240001-line04-cs-daily-report/screenshots'

const REPORTS = {
  ok: true,
  date: '2026-06-20',
  reports: [
    { cs_wechat_id: 'wxid_csa', self_name: '小齐', received_count: 15, reply_count: 11,
      served_customers: 6, work_duration_minutes: 210, summary_text: '今日接待 6 位客户，回复及时。' },
    { cs_wechat_id: 'wxid_csb', self_name: '小白', received_count: 0, reply_count: 0,
      served_customers: 0, work_duration_minutes: 0, summary_text: '今日无消息。' },
  ],
}

function stub(page) {
  page.route('**/api/auth/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
  page.route('**/api/wechat/cs/daily-report**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPORTS) }))
}

test('客服日报：选历史日期 → 看到每客服当天 4 个数 + 小结', async ({ page }) => {
  stub(page)
  await page.goto('/wechat/cs-daily-report')

  // 选日期
  await page.getByTestId('cs-report-date-input').fill('2026-06-20')
  await page.getByTestId('cs-report-load-btn').click()

  const csaCard = page.getByTestId('cs-report-card-wxid_csa')
  await expect(csaCard).toBeVisible()
  await expect(csaCard.getByTestId('report-received')).toContainText('15')
  await expect(csaCard.getByTestId('report-reply')).toContainText('11')
  await expect(csaCard.getByTestId('report-served')).toContainText('6')
  await expect(csaCard.getByTestId('report-duration')).toContainText('210')
  await expect(csaCard.getByTestId('report-summary')).toContainText('接待 6 位客户')
  await page.screenshot({ path: `${SHOT}/01-report.png`, fullPage: true })

  // 第二个客服全 0 行也在（不漏行）
  const csbCard = page.getByTestId('cs-report-card-wxid_csb')
  await expect(csbCard.getByTestId('report-received')).toContainText('0')
})
