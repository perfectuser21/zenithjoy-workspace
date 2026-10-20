/**
 * structured-workbench-views.spec.ts —— 路③ Sprint C（S3 视图切得开）真浏览器全链
 *
 * 变体C 死规则：**禁请求拦截/改写**（不截请求、不伪造响应）——
 * 全部请求打真实 apps/api + 真 Postgres。断网用真实网络条件（setOffline 整个 context 断网），
 * 不是把某个请求截下来伪造响应。认证走真会话 cookie。
 *
 * 两个 test 对应 workflow 里两个 step，用 ASCII 标签分派（--grep @views-*）：
 *   @views-kanban  看板分列 + 指针拖卡换列落库 + 409 冲突弹回 + 断网弹回 → 截图 01 02 06 03
 *   @views-prefs   表格筛/排/隐藏列 + 视图偏好断网保存失败可见提示 → 截图 04 05
 * 标签必须是 ASCII：windows runner 上 cmd /c 传中文参数要跟代码页较劲，解码歪了 Playwright
 * 会报 "No tests found" 而不是报错——最难看的一种假绿。
 *
 * 拖拽用真指针序列（mouse.down → 越过 PointerSensor 激活距离的小步 move → move 到目标列 → mouse.up）。
 */
import {
  test,
  expect,
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5178';
const SESSION_COOKIE = process.env.E2E_VIEWS_COOKIE || '';
/** 同组织的第二个真会话：制造「同事先改过这一行」的 409，不是伪造出来的第二身份 */
const SESSION_COOKIE2 = process.env.E2E_VIEWS_COOKIE2 || SESSION_COOKIE;
const SPRINT_DIR = 'sprints/08210012-workbench-sprintC-views';
const SHOT_DIR = resolve(process.cwd(), '..', '..', SPRINT_DIR, 'screenshots');
const DB_BASE = '/api/knowledge/db';

const shot = (name: string) => resolve(SHOT_DIR, name);

const EIGHT_FIELDS = [
  { name: '字段-text', field_type: 'text', options: [] as string[], display_order: 0 },
  { name: '字段-long_text', field_type: 'long_text', options: [] as string[], display_order: 1 },
  { name: '字段-number', field_type: 'number', options: [] as string[], display_order: 2 },
  { name: '字段-date', field_type: 'date', options: [] as string[], display_order: 3 },
  { name: '字段-single_select', field_type: 'single_select', options: ['甲', '乙'], display_order: 4 },
  { name: '字段-multi_select', field_type: 'multi_select', options: ['甲', '乙'], display_order: 5 },
  { name: '字段-person', field_type: 'person', options: [] as string[], display_order: 6 },
  { name: '字段-url', field_type: 'url', options: [] as string[], display_order: 7 },
];

interface FieldOut {
  field_id: string;
  name: string;
  field_type: string;
}

async function createTable(api: APIRequestContext, name: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
    data: { name, visibility: 'org', fields: EIGHT_FIELDS },
  });
  expect(res.status(), `建表失败：${await res.text()}`).toBe(201);
  const body = await res.json();
  return { tableId: body.data.table_id as string, fields: body.data.fields as FieldOut[] };
}

function fieldIdOf(fields: FieldOut[], fieldType: string): string {
  const hit = fields.find((f) => f.field_type === fieldType);
  expect(hit, `缺 ${fieldType} 字段`).toBeTruthy();
  return hit!.field_id;
}

async function createRow(api: APIRequestContext, tableId: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`, { data: {} });
  expect(res.status(), `建行失败：${await res.text()}`).toBe(201);
  return (await res.json()).data as { row_id: string; version: number };
}

async function patchRow(
  api: APIRequestContext,
  rowId: string,
  version: number,
  data: Record<string, unknown>
) {
  const res = await api.patch(`${BASE_URL}${DB_BASE}/rows/${rowId}`, { data: { version, data } });
  expect(res.status(), `写行失败：${await res.text()}`).toBe(200);
  return (await res.json()).data as { version: number };
}

async function createView(api: APIRequestContext, tableId: string, body: Record<string, unknown>) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/views`, { data: body });
  expect(res.status(), `建视图失败：${await res.text()}`).toBe(201);
  return (await res.json()).data as { view_id: string };
}

async function rowFs(api: APIRequestContext, tableId: string, rowId: string, fs: string) {
  const res = await api.get(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`);
  const rows = (await res.json()).data.rows as Array<{ row_id: string; version: number; data: Record<string, unknown> }>;
  return rows.find((r) => r.row_id === rowId)!.data[fs];
}

async function colleague(): Promise<APIRequestContext> {
  return apiRequest.newContext({ extraHTTPHeaders: { Cookie: SESSION_COOKIE2 } });
}

/** 真指针拖拽：先小步越过 PointerSensor 的激活距离，再 move 到目标列中心，最后抬手 */
async function dragCard(page: Page, cardTestId: string, targetTestId: string) {
  const card = page.getByTestId(cardTestId);
  const target = page.getByTestId(targetTestId);
  await card.scrollIntoViewIfNeeded();
  const cb = await card.boundingBox();
  const tb = await target.boundingBox();
  if (!cb || !tb) throw new Error(`拖拽元素无 boundingBox: ${cardTestId} / ${targetTestId}`);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 14, cb.y + cb.height / 2 + 14, { steps: 6 });
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 14 });
  await page.mouse.up();
}

test.describe('路③ S3 视图切得开', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    expect(SESSION_COOKIE, 'E2E_VIEWS_COOKIE 未注入：没有真会话，这条 E2E 只会拿到一片 401').not.toBe('');
    const url = new URL(BASE_URL);
    for (const pair of SESSION_COOKIE.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      await context.addCookies([{ name, value: rest.join('='), domain: url.hostname, path: '/' }]);
    }
  });

  test('看板分列 + 拖卡换列落库 + 409 冲突弹回 + 断网弹回 @views-kanban', async ({ page, context }) => {
    const api = page.request;
    const { tableId, fields } = await createTable(api, `S3看板-${Date.now()}`);
    const fs = fieldIdOf(fields, 'single_select');

    // 预置：甲/乙 各一行 + 三行未分组（不设 single_select 值 = 缺键态）
    const rJia = await createRow(api, tableId);
    await patchRow(api, rJia.row_id, rJia.version, { [fs]: '甲' });
    const rYi = await createRow(api, tableId);
    await patchRow(api, rYi.row_id, rYi.version, { [fs]: '乙' });
    for (let i = 0; i < 3; i += 1) await createRow(api, tableId);

    // 预置一个看板视图（分组 = 单选字段），页面加载即进看板
    await createView(api, tableId, {
      name: '看板视图',
      view_type: 'kanban',
      group_field_id: fs,
      is_active: true,
    });

    await page.goto(`${BASE_URL}/workbench/tables/${tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('kanban-board')).toBeVisible({ timeout: 20_000 });

    // 01：列 = 单选 options 全集 +「未分组」，未分组列恰好 3 张卡
    await expect(page.getByTestId('kanban-column-甲')).toBeVisible();
    await expect(page.getByTestId('kanban-column-乙')).toBeVisible();
    await expect(page.getByTestId('kanban-column-__ungrouped__')).toBeVisible();
    await expect(
      page.getByTestId('kanban-column-__ungrouped__').getByTestId(/^kanban-card-/)
    ).toHaveCount(3);

    // GP #3 的 UI 兑现：分组字段选择器**只列单选字段**，七类非单选在 UI 层就进不了看板
    // （比「选了非法类型再报错」更优——用户压根选不到；API 层七类 400 是防绕过后端的兜底）。
    const groupSelect = page.getByTestId('group-field-select');
    await expect(groupSelect).toBeVisible();
    const groupOptions = await groupSelect.locator('option').allTextContents();
    expect(
      groupOptions.some((t) => t.includes('字段-single_select')),
      '分组选择器应含单选字段'
    ).toBe(true);
    for (const banned of [
      '字段-number',
      '字段-date',
      '字段-text',
      '字段-long_text',
      '字段-multi_select',
      '字段-person',
      '字段-url',
    ]) {
      expect(
        groupOptions.some((t) => t.includes(banned)),
        `分组选择器不应出现非单选字段 ${banned}（非法类型在 UI 层进不了看板）`
      ).toBe(false);
    }
    await page.screenshot({ path: shot('01-kanban-columns.png'), fullPage: true });

    // 02：把「甲」列那张卡拖到「乙」列 → 库中该行分组值改成乙、version +1，刷新仍在新列
    await dragCard(page, `kanban-card-${rJia.row_id}`, 'kanban-column-乙');
    await expect
      .poll(async () => rowFs(api, tableId, rJia.row_id, fs), { timeout: 15_000 })
      .toBe('乙');
    await expect(page.getByTestId('kanban-column-乙').getByTestId(`kanban-card-${rJia.row_id}`)).toBeVisible();
    await page.screenshot({ path: shot('02-kanban-dragged.png'), fullPage: true });

    // 06：同事先改过「乙」那一行 → 页面手上的 version 过期 → 拖它 409 弹回原列 + 冲突提示
    const mate = await colleague();
    const mateRes = await mate.patch(`${BASE_URL}${DB_BASE}/rows/${rYi.row_id}`, {
      data: { version: rYi.version + 1, data: { [fs]: '甲' } },
    });
    expect(mateRes.status(), `同事写回失败：${await mateRes.text()}`).toBe(200);
    await dragCard(page, `kanban-card-${rYi.row_id}`, 'kanban-column-甲');
    await expect(page.getByTestId('kanban-drop-conflict')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('kanban-drop-conflict')).toContainText(
      '该行已被他人修改，你的改动未保存'
    );
    await expect(page.getByTestId('kanban-column-乙').getByTestId(`kanban-card-${rYi.row_id}`)).toBeVisible();
    await page.screenshot({ path: shot('06-kanban-conflict.png'), fullPage: true });
    await mate.dispose();

    // 03：真断网下拖卡 → 卡片弹回原列 + kanban-drop-error 可见
    await context.setOffline(true);
    await dragCard(page, `kanban-card-${rJia.row_id}`, 'kanban-column-甲');
    await expect(page.getByTestId('kanban-drop-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('kanban-column-乙').getByTestId(`kanban-card-${rJia.row_id}`)).toBeVisible();
    await page.screenshot({ path: shot('03-kanban-revert.png'), fullPage: true });
    await context.setOffline(false);
  });

  test('表格筛/排/隐藏列 + 视图偏好断网保存失败可见提示 @views-prefs', async ({ page, context }) => {
    const api = page.request;
    const { tableId, fields } = await createTable(api, `S3偏好-${Date.now()}`);
    const ft = fieldIdOf(fields, 'text');
    const fn = fieldIdOf(fields, 'number');

    // 三行：数值 9 / 10 / 2（字典序会把 10 排到 9 前，数值序才是 2,9,10）
    for (const [t, n] of [
      ['甲一', 9],
      ['乙二', 10],
      ['甲三', 2],
    ] as Array<[string, number]>) {
      const r = await createRow(api, tableId);
      await patchRow(api, r.row_id, r.version, { [ft]: t, [fn]: n });
    }

    await page.goto(`${BASE_URL}/workbench/tables/${tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('view-switcher')).toBeVisible({ timeout: 20_000 });

    // 04：按文本字段筛「甲」+ 按数字字段升序排 + 隐藏数字列
    // 工具栏收进弹层（Notion 级 UI 重做 cp-08230010）：筛/排/隐藏列先点开对应面板再操作，testid 不变。
    await page.getByTestId('filtersort-panel-trigger').click();
    await page.getByTestId('filter-field-select').selectOption(ft);
    await page.getByTestId('filter-value-input').fill('甲');
    await page.getByTestId('sort-field-select').selectOption(fn);
    await page.getByTestId('sort-dir-select').selectOption('asc');
    await page.getByTestId('apply-query-button').click();
    await page.getByTestId('properties-panel-trigger').click();
    await page.getByTestId(`hide-col-${fn}`).check();
    await expect(page.getByTestId('row-limit-hint')).toContainText('已有 2 行', { timeout: 15_000 });
    await page.screenshot({ path: shot('04-grid-filter-sort.png'), fullPage: true });

    // 05：真断网下改视图配置（切一次隐藏列）→ 保存失败可见提示，页面主体不白屏，恢复网络就地重试成功
    await context.setOffline(true);
    await page.getByTestId(`hide-col-${ft}`).check();
    await expect(page.getByTestId('view-prefs-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('view-prefs-error')).toContainText('视图偏好未保存');
    await expect(page.getByTestId('workbench-table-page')).toBeVisible();
    await page.screenshot({ path: shot('05-view-prefs-error.png'), fullPage: true });

    await context.setOffline(false);
    await page.getByTestId('view-prefs-retry').click();
    await expect(page.getByTestId('view-prefs-error')).toHaveCount(0, { timeout: 15_000 });
  });
});
