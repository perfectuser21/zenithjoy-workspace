/**
 * Path 4 Sprint B — 微信客服中台配置页 E2E
 *
 * Golden Path：
 * 1. 打开 /wechat/cs-config，GET persona + business-kb 加载填表单
 * 2. 改人设字段点保存 → 断言 PUT /wechat/persona 请求体含新值
 * 3. 改企业信息点保存 → 断言 PUT /wechat/business-kb
 * 4. 点「AI 帮我生成 A1–A5」→ 断言触发 POST /wechat/business-kb/suggest-audience
 *    且返回的 segments 填进表单
 *
 * 运行（CI windows runner）：
 *   npx playwright test e2e/wechat-cs-config.spec.ts
 */
import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174'

const MOCK_PERSONA = {
  self_name: '小张',
  address_style: '亲',
  tone: '热情',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: ['亲爱的'],
  few_shot: [{ customer: '在吗', me: '在的~' }],
}

const MOCK_KB = {
  company: {
    name: 'ZenithJoy',
    what_we_do: '一人公司内容运营',
    value_prop: '帮你自动化获客',
    contact: 'wx_zenithjoy',
  },
  products: [{ name: '内容工厂', selling_points: '一键出图文', price: '￥99/月' }],
  audience_segments: [{ code: 'A0', label: '存量', desc: '老客户' }],
  qa_docs: [{ q: '怎么收费', a: '按月订阅' }],
}

const MOCK_SUGGESTED = [
  { code: 'A1', label: '初创团队', desc: '1-3 人小团队，预算有限' },
  { code: 'A2', label: '个人博主', desc: '想做内容但没时间' },
  { code: 'A3', label: '电商卖家', desc: '需要批量种草内容' },
  { code: 'A4', label: '本地商家', desc: '想做同城获客' },
  { code: 'A5', label: '知识付费', desc: '靠内容卖课' },
]

// 公共 mock：GET persona + business-kb
async function stubLoad(page: import('@playwright/test').Page) {
  await page.route('**/api/wechat/persona', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PERSONA),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    }
  })
  await page.route('**/api/wechat/business-kb', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_KB),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    }
  })
}

test('加载 — GET persona + business-kb 填进表单', async ({ page }) => {
  await stubLoad(page)

  await page.goto(`${BASE_URL}/wechat/cs-config`)
  await page.screenshot({ path: 'screenshots/wechat-cs-01-loaded.png' })

  await expect(page.getByTestId('persona-self-name')).toHaveValue('小张')
  await expect(page.getByTestId('company-name')).toHaveValue('ZenithJoy')
  await expect(page.getByTestId('product-name')).toHaveValue('内容工厂')
})

test('改人设字段点保存 — 断言 PUT /wechat/persona 请求体含新值', async ({ page }) => {
  let putBody: Record<string, unknown> = {}

  await page.route('**/api/wechat/persona', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PERSONA),
      })
    } else {
      putBody = JSON.parse(route.request().postData() || '{}')
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    }
  })
  await page.route('**/api/wechat/business-kb', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_KB),
    })
  })

  await page.goto(`${BASE_URL}/wechat/cs-config`)
  await page.getByTestId('persona-self-name').fill('小李')
  // 人设区的保存按钮（第一个 Section 的「保存」）
  await page.getByRole('button', { name: '保存' }).first().click()
  await page.screenshot({ path: 'screenshots/wechat-cs-02-save-persona.png' })

  await expect(page.getByText('人设已保存')).toBeVisible()
  expect(putBody['self_name']).toBe('小李')
})

test('改企业信息点保存 — 断言 PUT /wechat/business-kb 请求体', async ({ page }) => {
  let putBody: Record<string, unknown> = {}

  await page.route('**/api/wechat/persona', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PERSONA),
    })
  })
  await page.route('**/api/wechat/business-kb', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_KB),
      })
    } else {
      putBody = JSON.parse(route.request().postData() || '{}')
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      })
    }
  })

  await page.goto(`${BASE_URL}/wechat/cs-config`)
  await page.getByTestId('company-name').fill('ZenithJoy-Pro')
  await page.getByRole('button', { name: '保存' }).nth(1).click()

  await expect(page.getByText('企业信息已保存')).toBeVisible()
  const company = putBody['company'] as Record<string, unknown>
  expect(company['name']).toBe('ZenithJoy-Pro')
})

test('点 AI 帮我生成 — 触发 suggest-audience 并把返回填进表单', async ({ page }) => {
  let suggestBody: Record<string, unknown> = {}
  await stubLoad(page)

  await page.route('**/api/wechat/business-kb/suggest-audience', (route) => {
    suggestBody = JSON.parse(route.request().postData() || '{}')
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ audience_segments: MOCK_SUGGESTED }),
    })
  })

  await page.goto(`${BASE_URL}/wechat/cs-config`)
  await page.getByTestId('suggest-audience-btn').click()
  await page.screenshot({ path: 'screenshots/wechat-cs-03-ai-suggest.png' })

  // 断言触发了请求（body 带企业信息）
  expect(suggestBody['industry']).toBeTruthy()

  // 断言返回的 5 组人群填进表单（A1 出现在第一个 code 输入框）
  const codes = page.getByTestId('audience-code')
  await expect(codes).toHaveCount(5)
  await expect(codes.first()).toHaveValue('A1')
  await expect(page.getByText(/AI 生成了 5 组人群/)).toBeVisible()
})
