/**
 * structured-workbench-rollup.spec.ts —— 路③ Sprint E（S4 加厚 rollup/lookup 聚合）真浏览器全链
 *
 * 变体C 死规则：**禁请求拦截/改写**（零 page.route）—— 全部请求打真实 apps/api + 真 Postgres。
 * 认证走真会话 cookie（由 e2e-rollup-run.ps1 先调 /api/staff/feishu-login 拿到再注入），
 * 一个身份头都不拼——路③ 的服务端闸压根不读请求头。
 *
 * 三个 test 对应 workflow 里三个 step，用 **ASCII 标签**分派（`--grep @rollup-*`）：
 *   @rollup-build   建 relation 字段 → 配 rollup 字段(sum/count over 目标字段) → 单元格显示聚合值 → 截图 01
 *   @rollup-lookup  配 lookup 字段 → 单元格显示关联行目标字段多值逗号拼接（含「, 」）        → 截图 02
 *   @rollup-degrade 删 rollup 依赖字段 → 单元格显示可见降级占位（不显示旧值、不白屏）        → 截图 03
 * 标签必须是 ASCII：windows runner 上传中文参数一旦解码歪了 Playwright 会报 "No tests found"（最难看的假绿）。
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5179';
const SESSION_COOKIE = process.env.E2E_ROLLUP_COOKIE || '';
const SPRINT_DIR = 'sprints/08222228-workbench-rollup-sprintE';
const SHOT_DIR = resolve(process.cwd(), '..', '..', SPRINT_DIR, 'screenshots');
const DB_BASE = '/api/knowledge/db';

const shot = (name: string) => resolve(SHOT_DIR, name);

interface FieldOut {
  field_id: string;
  name: string;
  field_type: string;
  options: string[];
}

/** 建一张只含 text 标题字段的源表，返回 { tableId, titleFieldId } */
async function createSimpleTable(api: APIRequestContext, name: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
    data: { name, visibility: 'org', fields: [{ name: '标题', field_type: 'text', options: [], display_order: 0 }] },
  });
  expect(res.status(), `建源表失败：${await res.text()}`).toBe(201);
  const j = await res.json();
  const fields = j.data.fields as FieldOut[];
  return { tableId: j.data.table_id as string, titleFieldId: fields[0].field_id };
}

/** 拉某表字段清单 */
async function listFields(api: APIRequestContext, tableId: string): Promise<FieldOut[]> {
  const res = await api.get(`${BASE_URL}${DB_BASE}/tables/${tableId}/fields`);
  expect(res.status()).toBe(200);
  return (await res.json()).data.fields as FieldOut[];
}

/** 按类型/名字取 field_id */
function fieldId(fields: FieldOut[], pred: (f: FieldOut) => boolean): string {
  const f = fields.find(pred);
  if (!f) throw new Error('字段未找到');
  return f.field_id;
}

/** 建一行并给字段赋值，返回 rowId（建=v1，PATCH=v2） */
async function createRowWith(
  api: APIRequestContext,
  tableId: string,
  data: Record<string, unknown>
): Promise<string> {
  const created = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`, { data: {} });
  expect(created.status()).toBe(201);
  const rowId = (await created.json()).data.row_id as string;
  if (Object.keys(data).length > 0) {
    const patched = await api.patch(`${BASE_URL}${DB_BASE}/rows/${rowId}`, { data: { version: 1, data } });
    expect(patched.status(), `设值失败：${await patched.text()}`).toBe(200);
  }
  return rowId;
}

/** 在 tableId 上加字段（含 rollup/lookup），返回加完后的字段清单 */
async function addFields(api: APIRequestContext, tableId: string, fields: unknown[]): Promise<FieldOut[]> {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/fields`, { data: { fields } });
  expect(res.status(), `加字段失败：${await res.text()}`).toBe(201);
  return (await res.json()).data.fields as FieldOut[];
}

test.describe('路③ S4 rollup/lookup 聚合链', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    expect(SESSION_COOKIE, 'E2E_ROLLUP_COOKIE 未注入：没有真会话，这条 E2E 只会拿到一片 401').not.toBe('');
    const url = new URL(BASE_URL);
    for (const pair of SESSION_COOKIE.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      await context.addCookies([{ name, value: rest.join('='), domain: url.hostname, path: '/' }]);
    }
  });

  test('建 relation 字段 → 配 rollup 字段(sum/count) → 单元格显示聚合值 @rollup-build', async ({ page }) => {
    const api = page.request;
    const ts = Date.now();
    // 目标表 + 两行金额（甲10 / 乙30）
    const tgt = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
      data: {
        name: `目标-${ts}`,
        visibility: 'org',
        fields: [
          { name: '标题', field_type: 'text', options: [], display_order: 0 },
          { name: '金额', field_type: 'number', options: [], display_order: 1 },
        ],
      },
    });
    expect(tgt.status()).toBe(201);
    const tgtId = (await tgt.json()).data.table_id as string;
    const tgtFields = await listFields(api, tgtId);
    const titleF = fieldId(tgtFields, (f) => f.field_type === 'text');
    const amountF = fieldId(tgtFields, (f) => f.field_type === 'number');
    const r0 = await createRowWith(api, tgtId, { [titleF]: '甲', [amountF]: 10 });
    const r1 = await createRowWith(api, tgtId, { [titleF]: '乙', [amountF]: 30 });

    // 源表 + relation 字段 + 一条关联 [甲, 乙] 的源行
    const src = await createSimpleTable(api, `源-${ts}`);
    await addFields(api, src.tableId, [
      { name: '关联', field_type: 'relation', options: [tgtId], display_order: 9 },
    ]);
    const relF = fieldId(await listFields(api, src.tableId), (f) => f.field_type === 'relation');
    const srcRow = await createRowWith(api, src.tableId, { [relF]: [r0, r1] });

    // 配 sum + count 两个 rollup 字段
    await addFields(api, src.tableId, [
      { name: 'rsum', field_type: 'rollup', options: [relF, amountF, 'sum'], display_order: 20 },
      { name: 'rcount', field_type: 'rollup', options: [relF, '', 'count'], display_order: 21 },
    ]);
    const srcFields = await listFields(api, src.tableId);
    const sumF = fieldId(srcFields, (f) => f.name === 'rsum');
    const countF = fieldId(srcFields, (f) => f.name === 'rcount');

    await page.goto(`${BASE_URL}/workbench/tables/${src.tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    // sum 单元格显示 40（10+30），count 单元格显示 2
    const sumCell = page.getByTestId(`rollup-value-${srcRow}-${sumF}`);
    await expect(sumCell).toBeVisible({ timeout: 15_000 });
    await expect(sumCell).toHaveText('40');
    const countCell = page.getByTestId(`rollup-value-${srcRow}-${countF}`);
    await expect(countCell).toHaveText('2');
    await page.screenshot({ path: shot('01-rollup-build.png'), fullPage: true });
  });

  test('配 lookup 字段 → 单元格显示关联行标题多值逗号拼接 @rollup-lookup', async ({ page }) => {
    const api = page.request;
    const ts = Date.now();
    const tgt = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
      data: {
        name: `目标-${ts}`,
        visibility: 'org',
        fields: [
          { name: '标题', field_type: 'text', options: [], display_order: 0 },
          { name: '金额', field_type: 'number', options: [], display_order: 1 },
        ],
      },
    });
    expect(tgt.status()).toBe(201);
    const tgtId = (await tgt.json()).data.table_id as string;
    const tgtFields = await listFields(api, tgtId);
    const titleF = fieldId(tgtFields, (f) => f.field_type === 'text');
    const amountF = fieldId(tgtFields, (f) => f.field_type === 'number');
    const r0 = await createRowWith(api, tgtId, { [titleF]: '甲', [amountF]: 10 });
    const r1 = await createRowWith(api, tgtId, { [titleF]: '乙', [amountF]: 30 });

    const src = await createSimpleTable(api, `源-${ts}`);
    await addFields(api, src.tableId, [
      { name: '关联', field_type: 'relation', options: [tgtId], display_order: 9 },
    ]);
    const relF = fieldId(await listFields(api, src.tableId), (f) => f.field_type === 'relation');
    const srcRow = await createRowWith(api, src.tableId, { [relF]: [r0, r1] });

    await addFields(api, src.tableId, [
      { name: 'llk', field_type: 'lookup', options: [relF, titleF], display_order: 22 },
    ]);
    const lookF = fieldId(await listFields(api, src.tableId), (f) => f.name === 'llk');

    await page.goto(`${BASE_URL}/workbench/tables/${src.tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    // lookup 单元格显示「甲, 乙」（多值 row_order 升序、`, ` 分隔，含「, 」）
    const lookCell = page.getByTestId(`rollup-value-${srcRow}-${lookF}`);
    await expect(lookCell).toBeVisible({ timeout: 15_000 });
    await expect(lookCell).toHaveText('甲, 乙');
    await page.screenshot({ path: shot('02-rollup-lookup.png'), fullPage: true });
  });

  test('删 rollup 依赖的 relation 字段 → 单元格显示可见降级占位（不显示旧值、不白屏）@rollup-degrade', async ({
    page,
  }) => {
    const api = page.request;
    const ts = Date.now();
    const tgt = await api.post(`${BASE_URL}${DB_BASE}/tables`, {
      data: {
        name: `目标-${ts}`,
        visibility: 'org',
        fields: [
          { name: '标题', field_type: 'text', options: [], display_order: 0 },
          { name: '金额', field_type: 'number', options: [], display_order: 1 },
        ],
      },
    });
    expect(tgt.status()).toBe(201);
    const tgtId = (await tgt.json()).data.table_id as string;
    const tgtFields = await listFields(api, tgtId);
    const titleF = fieldId(tgtFields, (f) => f.field_type === 'text');
    const amountF = fieldId(tgtFields, (f) => f.field_type === 'number');
    const r0 = await createRowWith(api, tgtId, { [titleF]: '甲', [amountF]: 10 });

    const src = await createSimpleTable(api, `源-${ts}`);
    await addFields(api, src.tableId, [
      { name: '关联', field_type: 'relation', options: [tgtId], display_order: 9 },
    ]);
    const relF = fieldId(await listFields(api, src.tableId), (f) => f.field_type === 'relation');
    const srcRow = await createRowWith(api, src.tableId, { [relF]: [r0] });
    await addFields(api, src.tableId, [
      { name: 'rsum', field_type: 'rollup', options: [relF, amountF, 'sum'], display_order: 20 },
    ]);
    const sumF = fieldId(await listFields(api, src.tableId), (f) => f.name === 'rsum');

    await page.goto(`${BASE_URL}/workbench/tables/${src.tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    // 基线：sum 显示 10
    await expect(page.getByTestId(`rollup-value-${srcRow}-${sumF}`)).toHaveText('10', { timeout: 15_000 });

    // 删 rollup 依赖的 relation 字段（confirm_name = '关联'）
    const del = await api.delete(`${BASE_URL}${DB_BASE}/tables/${src.tableId}/fields/${relF}`, {
      data: { confirm_name: '关联' },
    });
    expect(del.status(), `删 relation 字段失败：${await del.text()}`).toBe(200);

    // 重新载入：rollup 单元格改示可见降级占位，不显示旧值 10、不白屏
    await page.reload();
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    const degraded = page.getByTestId(`rollup-degraded-${srcRow}-${sumF}`);
    await expect(degraded).toBeVisible({ timeout: 15_000 });
    const cell = page.getByTestId(`cell-${srcRow}-${sumF}`);
    await expect(cell).not.toContainText('10');
    await page.screenshot({ path: shot('03-rollup-degrade.png'), fullPage: true });
  });
});
