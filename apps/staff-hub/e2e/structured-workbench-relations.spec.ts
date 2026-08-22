/**
 * structured-workbench-relations.spec.ts —— 路③ Sprint D（S4 关联连得上）真浏览器全链
 *
 * 变体C 死规则：**禁请求拦截/改写** —— 全部请求打真实 apps/api + 真 Postgres。
 * 认证走真会话 cookie（由 e2e-relations-run.ps1 先调 /api/staff/feishu-login 拿到再注入），
 * 一个身份头都不拼——路③ 的服务端闸压根不读请求头。
 *
 * 三个 test 对应 workflow 里三个 step，用 **ASCII 标签**分派（`--grep @relation-*`）：
 *   @relation-build   建 relation 字段配目标表 → 行选择器挑记录 → 单元格显示目标标题 → 截图 01
 *   @relation-jump    点单元格关联项 → 跳转到目标表该记录详情面板                 → 截图 02
 *   @relation-backref 打开被引用记录详情 → 反向面板列出引用来源（表名 + 行标题）   → 截图 03
 * 标签必须是 ASCII：windows runner 上传中文参数要跟代码页较劲，一旦解码歪了
 * Playwright 会报 "No tests found" 而不是报错，那是一种最难看的假绿。
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5178';
const SESSION_COOKIE = process.env.E2E_RELATIONS_COOKIE || '';
const SPRINT_DIR = 'sprints/08220300-workbench-sprintD-relations';
const SHOT_DIR = resolve(process.cwd(), '..', '..', SPRINT_DIR, 'screenshots');
const DB_BASE = '/api/knowledge/db';

const shot = (name: string) => resolve(SHOT_DIR, name);

interface FieldOut {
  field_id: string;
  name: string;
  field_type: string;
  options: string[];
}

/** 建一张只含一个 text 标题字段的表，返回 { tableId, titleFieldId } */
async function createSimpleTable(api: APIRequestContext, name: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
    data: {
      name,
      visibility: 'org',
      fields: [{ name: '标题', field_type: 'text', options: [], display_order: 0 }],
    },
  });
  expect(res.status(), `建表失败：${await res.text()}`).toBe(201);
  const body = await res.json();
  const fields = body.data.fields as FieldOut[];
  return { tableId: body.data.table_id as string, titleFieldId: fields[0].field_id };
}

/** 在 tableId 上加一个 relation 字段配置目标表，返回 relation 字段 id */
async function addRelationField(api: APIRequestContext, tableId: string, targetTableId: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/fields`, {
    data: {
      fields: [{ name: '关联', field_type: 'relation', options: [targetTableId], display_order: 9 }],
    },
  });
  expect(res.status(), `建 relation 字段失败：${await res.text()}`).toBe(201);
  const body = await res.json();
  const rel = (body.data.fields as FieldOut[]).find((f) => f.field_type === 'relation');
  expect(rel, '缺 relation 字段').toBeTruthy();
  return rel!.field_id;
}

/** 建一行并把标题字段设为 title，返回 row_id */
async function createTitledRow(
  api: APIRequestContext,
  tableId: string,
  titleFieldId: string,
  title: string
) {
  const created = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`, { data: {} });
  expect(created.status()).toBe(201);
  const rowId = (await created.json()).data.row_id as string;
  const patched = await api.patch(`${BASE_URL}${DB_BASE}/rows/${rowId}`, {
    data: { version: 1, data: { [titleFieldId]: title } },
  });
  expect(patched.status(), `设标题失败：${await patched.text()}`).toBe(200);
  return rowId;
}

/** 把 sourceRow 的 relation 字段关联到 [targetRow]（版本从 API 现读，避免 409） */
async function linkRelation(
  api: APIRequestContext,
  sourceRowId: string,
  relFieldId: string,
  targetRowId: string
) {
  const res = await api.patch(`${BASE_URL}${DB_BASE}/rows/${sourceRowId}`, {
    data: { version: 1, data: { [relFieldId]: [targetRowId] } },
  });
  expect(res.status(), `建关联失败：${await res.text()}`).toBe(200);
}

test.describe('路③ S4 跨表关联链', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    expect(
      SESSION_COOKIE,
      'E2E_RELATIONS_COOKIE 未注入：没有真会话，这条 E2E 只会拿到一片 401'
    ).not.toBe('');
    const url = new URL(BASE_URL);
    for (const pair of SESSION_COOKIE.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      await context.addCookies([{ name, value: rest.join('='), domain: url.hostname, path: '/' }]);
    }
  });

  test('建 relation 字段配目标表 → 行选择器挑记录 → 单元格显示目标标题 @relation-build', async ({
    page,
  }) => {
    const api = page.request;
    const ts = Date.now();
    const b = await createSimpleTable(api, `B目标-${ts}`);
    await createTitledRow(api, b.tableId, b.titleFieldId, '目标记录甲');
    await createTitledRow(api, b.tableId, b.titleFieldId, '目标记录乙');
    const a = await createSimpleTable(api, `A源-${ts}`);
    const relFieldId = await addRelationField(api, a.tableId, b.tableId);
    const aRow = await createTitledRow(api, a.tableId, a.titleFieldId, '来源行A');

    await page.goto(`${BASE_URL}/workbench/tables/${a.tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    // 打开行选择器（配置关联）→ 勾选「目标记录甲」→ 保存
    await page.getByTestId(`rel-edit-${aRow}-${relFieldId}`).click();
    await expect(page.getByTestId('relation-picker')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('relation-candidate-list')).toContainText('目标记录甲');
    // 候选项按标题点选（label 文本匹配「目标记录甲」）
    await page.getByTestId('relation-candidate-list').getByText('目标记录甲').click();
    await page.getByTestId('relation-picker-save').click();

    // 单元格显示所选目标记录标题（toBeVisible + toContainText）
    const cell = page.getByTestId(`cell-${aRow}-${relFieldId}`);
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await expect(cell).toContainText('目标记录甲', { timeout: 15_000 });
    await page.screenshot({ path: shot('01-relation-build.png'), fullPage: true });
  });

  test('点单元格关联项 → 跳转到目标表该记录详情面板 @relation-jump', async ({ page }) => {
    const api = page.request;
    const ts = Date.now();
    const b = await createSimpleTable(api, `B目标-${ts}`);
    const b1 = await createTitledRow(api, b.tableId, b.titleFieldId, '被跳转目标乙');
    const a = await createSimpleTable(api, `A源-${ts}`);
    const relFieldId = await addRelationField(api, a.tableId, b.tableId);
    const aRow = await createTitledRow(api, a.tableId, a.titleFieldId, '来源行A');
    await linkRelation(api, aRow, relFieldId, b1);

    await page.goto(`${BASE_URL}/workbench/tables/${a.tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    // 单元格已显示目标标题 → 点关联项 chip 跳转
    const chip = page.getByTestId(`rel-chip-${aRow}-${relFieldId}-${b1}`);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText('被跳转目标乙');
    await chip.click();

    // 跳转到目标表该记录详情面板（关键元素可见）
    const panel = page.getByTestId('row-detail-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/workbench/tables/${b.tableId}`));
    await page.screenshot({ path: shot('02-relation-jump.png'), fullPage: true });
  });

  test('打开被引用记录详情 → 反向面板列出引用来源（表名 + 行标题）@relation-backref', async ({
    page,
  }) => {
    const api = page.request;
    const ts = Date.now();
    const aTableName = `A源-${ts}`;
    const b = await createSimpleTable(api, `B目标-${ts}`);
    const b1 = await createTitledRow(api, b.tableId, b.titleFieldId, '被引用目标');
    const a = await createSimpleTable(api, aTableName);
    const relFieldId = await addRelationField(api, a.tableId, b.tableId);
    const aRow = await createTitledRow(api, a.tableId, a.titleFieldId, '引用它的来源行');
    await linkRelation(api, aRow, relFieldId, b1);

    // 直接进目标表 B，用 ?open= 打开被引用记录 b1 的详情
    await page.goto(`${BASE_URL}/workbench/tables/${b.tableId}?open=${b1}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    const panel = page.getByTestId('row-detail-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });

    // 反向面板列出引用来源：来源表名 + 来源行标题
    const backrefPanel = page.getByTestId('backref-panel');
    await expect(backrefPanel).toBeVisible({ timeout: 15_000 });
    const entry = page.getByTestId(`backref-${aRow}`);
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(entry).toContainText(aTableName);
    await expect(entry).toContainText('引用它的来源行');
    await page.screenshot({ path: shot('03-relation-backref.png'), fullPage: true });
  });
});
