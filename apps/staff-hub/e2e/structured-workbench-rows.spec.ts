/**
 * structured-workbench-rows.spec.ts —— 路③ Sprint B（S2 数据进得来）真浏览器全链
 *
 * 变体C 死规则：**禁请求拦截/改写** —— 全部请求打真实 apps/api + 真 Postgres。
 * 断网那一段用的是 `context.setOffline(true)`，那是**真实网络条件**（整个 context 断网），
 * 不是把某个请求截下来伪造一个响应，两者的区别就是"测到了真路径"与"测了个假的"。
 * 认证走真会话 cookie（由 e2e-rows-setup.ps1 先调 /api/staff/feishu-login 拿到再注入），
 * 一个身份头都不拼——路③ 的服务端闸压根不读请求头。
 *
 * 三个 test 对应 workflow 里三个 step，用 **ASCII 标签**分派（`--grep @rows-*`）：
 *   @rows-offline  行内编辑 / 冲突提示 / 断网保留输入 / 粘贴 / 回收站还原 → 截图 01 02 03 05
 *   @rows-detail   面板字段全集 + 多行编辑区 + 面板开着时该行被删       → 截图 06
 *   @rows-limit    服务端以小 WORKBENCH_ROW_LIMIT 起，UI 达上限硬拦     → 截图 04
 * 标签必须是 ASCII：windows runner 上 `cmd /c` 传中文参数要跟代码页较劲，
 * 一旦解码歪了 Playwright 会报 "No tests found" 而不是报错，那是一种最难看的假绿。
 * step 名里的「断网 / 行详情 / 上限硬拦」是 DoD 的判据，与这里的标签各司其职。
 *
 * 剪贴板：GHA windows runner 没有桌面剪贴板权限模型，`navigator.clipboard.readText()`
 * 在无头 Chromium 上要用户手势且不可靠。这里用 DataTransfer 构造真 ClipboardEvent 派发到
 * 表格容器上——**被测代码路径（粘贴处理器解析 TSV → 调 paste 端点）一行没被顶替**，
 * 只有"字节怎么进浏览器"这一段换了入口（已在合同「未覆盖真实链路清单」登记）。
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

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5177';
const SESSION_COOKIE = process.env.E2E_ROWS_COOKIE || '';
/** 同组织的第二个真会话：制造"同事同时改了同一格"用的，不是伪造出来的第二身份 */
const SESSION_COOKIE2 = process.env.E2E_ROWS_COOKIE2 || SESSION_COOKIE;
const SPRINT_DIR = 'sprints/08201850-workbench-sprintB-rows';
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
  return {
    tableId: body.data.table_id as string,
    fields: body.data.fields as FieldOut[],
  };
}

function fieldIdOf(fields: FieldOut[], fieldType: string): string {
  const hit = fields.find((f) => f.field_type === fieldType);
  expect(hit, `缺 ${fieldType} 字段`).toBeTruthy();
  return hit!.field_id;
}

async function listRows(api: APIRequestContext, tableId: string) {
  const res = await api.get(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as {
    rows: Array<{ row_id: string; version: number }>;
    total: number;
    row_limit: number;
  };
}

async function createRowViaApi(api: APIRequestContext, tableId: string) {
  const res = await api.post(`${BASE_URL}${DB_BASE}/tables/${tableId}/rows`, { data: {} });
  expect(res.status(), `建行失败：${await res.text()}`).toBe(201);
  return (await res.json()).data as { row_id: string; version: number };
}

/**
 * 同组织另一位同事的**真会话**（另一份 cookie，另一个 HTTP 客户端）。
 * 冲突必须由两个真身份真提交造出来，把 version 手工改小骗出一个 409 测的是分支不是竞态。
 */
async function colleagueContext(): Promise<APIRequestContext> {
  return apiRequest.newContext({ extraHTTPHeaders: { Cookie: SESSION_COOKIE2 } });
}

async function patchAsColleague(
  colleague: APIRequestContext,
  rowId: string,
  version: number,
  data: Record<string, unknown>
) {
  const res = await colleague.patch(`${BASE_URL}${DB_BASE}/rows/${rowId}`, {
    data: { version, data },
  });
  expect(res.status(), `同事写回失败：${await res.text()}`).toBe(200);
  return (await res.json()).data as { version: number };
}

/** 把一片 TSV 当成真剪贴板内容派发给表格容器 */
async function pasteInto(page: Page, tsv: string) {
  await page.getByTestId('row-grid').evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, tsv);
}

test.describe('路③ S2 表格视图行链', () => {
  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ context }) => {
    expect(
      SESSION_COOKIE,
      'E2E_ROWS_COOKIE 未注入：没有真会话，这条 E2E 只会拿到一片 401'
    ).not.toBe('');
    const url = new URL(BASE_URL);
    for (const pair of SESSION_COOKIE.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (!name || rest.length === 0) continue;
      await context.addCookies([{ name, value: rest.join('='), domain: url.hostname, path: '/' }]);
    }
  });

  test('行内编辑逐字落库 / 冲突提示 / 断网后原输入仍在 / 粘贴导入 / 回收站还原 @rows-offline', async ({
    page,
    context,
  }) => {
    const api = page.request;
    const { tableId, fields } = await createTable(api, `S2行表-${Date.now()}`);
    const fidText = fieldIdOf(fields, 'text');
    const fidUrl = fieldIdOf(fields, 'url');

    await page.goto(`${BASE_URL}/workbench/tables/${tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    // 01 空表：零行、「新增行」可点、已有/上限提示可见
    await expect(page.getByTestId('add-row-button')).toBeEnabled();
    await expect(page.getByTestId('row-limit-hint')).toContainText('已有 0 行');
    await page.screenshot({ path: shot('01-grid-empty.png'), fullPage: true });

    // 新增行落库
    await page.getByTestId('add-row-button').click();
    await expect.poll(async () => (await listRows(api, tableId)).total, { timeout: 15_000 }).toBe(1);
    const rowId = (await listRows(api, tableId)).rows[0].row_id;

    // 02 行内改格：编辑态可见，失焦即存，值逐字落库
    await page.getByTestId(`cell-${rowId}-${fidText}`).dblclick();
    const editor = page.getByTestId(`cell-editor-${rowId}-${fidText}`);
    await editor.fill('第一次写的');
    await page.screenshot({ path: shot('02-inline-edit.png'), fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`cell-${rowId}-${fidText}`)).toContainText('第一次写的', {
      timeout: 15_000,
    });
    const afterFirst = await listRows(api, tableId);
    expect(afterFirst.rows[0].version).toBe(2);

    // 03 同事同时改了同一格 → 冲突提示可见，且自己打的内容仍在编辑器里（不是被旧值盖回去）
    const colleague = await colleagueContext();
    await patchAsColleague(colleague, rowId, 2, { [fidText]: '同事写的' });
    await page.getByTestId(`cell-${rowId}-${fidText}`).dblclick();
    await page.getByTestId(`cell-editor-${rowId}-${fidText}`).fill('我打的内容');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`cell-conflict-${rowId}-${fidText}`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId(`cell-editor-${rowId}-${fidText}`)).toHaveValue('我打的内容');
    await page.screenshot({ path: shot('03-conflict.png'), fullPage: true });
    await page.getByTestId(`cell-reread-${rowId}`).click();
    await expect(page.getByTestId(`cell-${rowId}-${fidText}`)).toContainText('同事写的', {
      timeout: 15_000,
    });

    // 写回失败（真断网）→ 单元格可见错误态且原输入仍在；恢复网络就地重试成功
    await context.setOffline(true);
    await page.getByTestId(`cell-${rowId}-${fidUrl}`).dblclick();
    await page.getByTestId(`cell-editor-${rowId}-${fidUrl}`).fill('https://example.com/断网时打的');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId(`cell-error-${rowId}-${fidUrl}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`cell-editor-${rowId}-${fidUrl}`)).toHaveValue(
      'https://example.com/断网时打的'
    );
    await context.setOffline(false);
    await page.getByTestId(`cell-retry-${rowId}-${fidUrl}`).click();
    await expect(page.getByTestId(`cell-error-${rowId}-${fidUrl}`)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`cell-${rowId}-${fidUrl}`)).toContainText('断网时打的', {
      timeout: 15_000,
    });

    // 粘贴一片表格：未匹配列自动建成文本字段
    await pasteInto(page, ['字段-text\t全新列', 'p1\tq1', 'p2\tq2'].join('\n'));
    await expect(page.getByTestId('paste-notice')).toContainText('已导入 2 行', { timeout: 15_000 });
    await expect.poll(async () => (await listRows(api, tableId)).total, { timeout: 15_000 }).toBe(3);

    // 05 删行进行回收站 → 还原后字段值逐字回归
    await page.getByTestId(`row-delete-${rowId}`).click();
    await expect(page.getByTestId(`row-restore-${rowId}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`row-restore-${rowId}`).click();
    await expect(page.getByTestId(`cell-${rowId}-${fidText}`)).toContainText('同事写的', {
      timeout: 15_000,
    });
    await page.screenshot({ path: shot('05-row-trash-restore.png'), fullPage: true });
    await colleague.dispose();
  });

  test('行详情面板：字段全集与多行编辑区，面板开着时该行被删有可见提示 @rows-detail', async ({ page }) => {
    const api = page.request;
    const { tableId, fields } = await createTable(api, `S2详情表-${Date.now()}`);
    const fidLongText = fieldIdOf(fields, 'long_text');
    const fidText = fieldIdOf(fields, 'text');
    const row = await createRowViaApi(api, tableId);

    await page.goto(`${BASE_URL}/workbench/tables/${tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(`row-expand-${row.row_id}`).click();
    const panel = page.getByTestId('row-detail-panel');
    await expect(panel).toBeVisible();
    // 字段全集：8 个字段一个不少；长文本是真正的多行编辑区
    await expect(panel.getByTestId(/^detail-field-/)).toHaveCount(8);
    await expect(panel.locator('textarea')).toHaveCount(1);

    await panel.getByTestId(`detail-field-${fidLongText}`).fill('面板里改的字');
    await panel.getByTestId(`detail-field-${fidLongText}`).blur();
    await panel.getByTestId('detail-save-hint').waitFor({ timeout: 15_000 });
    await page.screenshot({ path: shot('06-row-detail-panel.png'), fullPage: true });

    // 面板开着时该行被他人删除 → 面板内改动提交后出现可见提示，页面主体不白屏
    const colleague = await colleagueContext();
    const del = await colleague.delete(`${BASE_URL}${DB_BASE}/rows/${row.row_id}`);
    expect(del.status()).toBe(200);
    await panel.getByTestId(`detail-field-${fidText}`).fill('删掉之后还想改');
    await panel.getByTestId(`detail-field-${fidText}`).blur();
    await expect(page.getByTestId('row-gone-notice')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('workbench-table-page')).toBeVisible();
    await colleague.dispose();
  });

  test('上限硬拦：达上限后新增行按钮禁用，提示含服务端下发的上限 @rows-limit', async ({ page }) => {
    const api = page.request;
    const { tableId } = await createTable(api, `S2上限表-${Date.now()}`);

    // 上限由服务端随行列表下发。这一段要求 apps/api 以小 WORKBENCH_ROW_LIMIT 起
    // （e2e-rows-limit.ps1 负责），否则得真插几千行才够得着闸——那会把 job 预算烧光。
    const { row_limit: rowLimitFromApi } = await listRows(api, tableId);
    expect(
      rowLimitFromApi,
      `row_limit=${rowLimitFromApi} 太大：本段要求服务端以小 WORKBENCH_ROW_LIMIT 起`
    ).toBeLessThanOrEqual(50);

    for (let i = 0; i < rowLimitFromApi; i += 1) await createRowViaApi(api, tableId);

    await page.goto(`${BASE_URL}/workbench/tables/${tableId}`);
    await expect(page.getByTestId('workbench-table-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('add-row-button')).toBeDisabled();
    await expect(page.getByTestId('row-limit-hint')).toContainText(String(rowLimitFromApi));

    // 04 粘贴超上限 → 整批拒绝，提示含当前上限与已有行数，表格行数未变
    await pasteInto(page, ['字段-text\t超限新列', 'over1\tx1', 'over2\tx2'].join('\n'));
    await expect(page.getByTestId('paste-notice')).toContainText(String(rowLimitFromApi), {
      timeout: 15_000,
    });
    await expect(page.getByTestId('paste-notice')).toContainText('已有');
    await page.screenshot({ path: shot('04-paste-limit.png'), fullPage: true });
    expect((await listRows(api, tableId)).total).toBe(rowLimitFromApi);
  });
});
