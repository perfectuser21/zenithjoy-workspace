/**
 * S3 筛选/排序 + field_id 白名单（上位合同 A20 前两件 / A25）
 *
 * 禁 mock 边：代码 ↔ `zenithjoy.db_rows` / `db_fields` 真读 —— 「数字字段被按字典序排」这类 bug
 * 只有真 Postgres 才照得出（`ORDER BY data -> $n` 是数值序，`->>` 是文本序，差一个箭头就把 10 排到 9 前）。
 *
 * 白名单口径（合同 §2.3 / 判定点 JC2）：
 *   - 非 UUID 形态（含原始 SQL 片段）→ 400 VALIDATION_FAILED（格式合法性客户端自己就能判，不泄露存在性）
 *   - 合法 UUID 但不属于本表（含他企业真实 field_id）→ 404 notFoundBody，与随机不存在 id 逐字节相同
 *
 * TDD Red：`GET /tables/:id/rows` 的 filter/sort 参数在 origin/main 上不存在（现在被静默忽略），本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  listRowsWith,
  fieldIdOf,
  seedRow,
  randomUuid,
  type TwoTenantSeed,
} from './_views-fixture';

/** `field_id` 位：逐个都必须被闸在标识符位之外的原始 SQL 片段 */
const SQL_FRAGMENTS = ['id; DROP TABLE zenithjoy.db_rows; --', '1) OR 1=1 --', "data->>'x'"];

/**
 * `dir` 位：它直接落在 `ORDER BY … ASC|DESC` 的关键字位上，与 `field_id` 同属
 * 「用户输入不进标识符位」的守卫面（PRD Invariant 原文是「GROUP BY/ORDER BY 走白名单」，不只 field）。
 * 只白名单 `field_id` 而把 `dir` 直接拼进 SQL，注入面照样敞着。
 */
const BAD_DIRS = ['asc; DROP TABLE zenithjoy.db_rows; --', 'asc NULLS FIRST, 1', 'ASC--'];

let seed: TwoTenantSeed;
let tableId: string;
let textFieldId: string;
let numberFieldId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-VFLT');
  const t = await createTable(seed.aliceCookie, `筛排表-${seed.sfx}`, 'org');
  tableId = t.body?.data?.table_id;
  textFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'text');
  numberFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'number');
  // 数值 9 / 10 / 2：字典序会排成 10, 2, 9，数值序才是 2, 9, 10
  await seedRow(seed.aliceCookie, tableId, { [textFieldId]: '甲一', [numberFieldId]: 9 });
  await seedRow(seed.aliceCookie, tableId, { [textFieldId]: '乙二', [numberFieldId]: 10 });
  await seedRow(seed.aliceCookie, tableId, { [textFieldId]: '甲三', [numberFieldId]: 2 });
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S3 筛排与 field_id 白名单 [BEHAVIOR]', () => {
  it('按文本字段筛返回集合完全一致', async () => {
    const res = await listRowsWith(seed.aliceCookie, tableId, {
      filter: [{ field_id: textFieldId, op: 'contains', value: '甲' }],
    });
    expect(res.status, `带筛的 rows 非 2xx：${JSON.stringify(res.body)}`).toBe(200);
    const values = (res.body.data.rows as Array<{ data: Record<string, unknown> }>)
      .map((r) => String(r.data[textFieldId]))
      .sort();
    expect(values).toEqual(['甲一', '甲三']);
    expect(res.body.data.total).toBe(2);

    // 反向：不匹配任何行的筛条件返回空集而不是全集（漏接参数会静默返全集）
    const none = await listRowsWith(seed.aliceCookie, tableId, {
      filter: [{ field_id: textFieldId, op: 'equals', value: '压根没有这个值' }],
    });
    expect(none.status).toBe(200);
    expect(none.body.data.rows).toEqual([]);
    expect(none.body.data.total).toBe(0);
  });

  it('按数字字段排是数值序不是字典序', async () => {
    const asc = await listRowsWith(seed.aliceCookie, tableId, {
      sort: [{ field_id: numberFieldId, dir: 'asc' }],
    });
    expect(asc.status).toBe(200);
    const ascValues = (asc.body.data.rows as Array<{ data: Record<string, unknown> }>).map(
      (r) => r.data[numberFieldId]
    );
    expect(ascValues, '字典序会排成 [10, 2, 9]').toEqual([2, 9, 10]);

    const desc = await listRowsWith(seed.aliceCookie, tableId, {
      sort: [{ field_id: numberFieldId, dir: 'desc' }],
    });
    const descValues = (desc.body.data.rows as Array<{ data: Record<string, unknown> }>).map(
      (r) => r.data[numberFieldId]
    );
    expect(descValues).toEqual([10, 9, 2]);
  });

  it('不传参数时响应与 Sprint B 逐字相同', async () => {
    const res = await listRowsWith(seed.aliceCookie, tableId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['row_limit', 'rows', 'total']);
    expect(res.body.data.total).toBe(3);
    expect(typeof res.body.data.row_limit).toBe('number');
    expect(Object.keys(res.body.data.rows[0]).sort()).toEqual([
      'created_at',
      'data',
      'row_id',
      'row_order',
      'updated_at',
      'version',
    ]);
  });

  it('原始 SQL 片段返 400 且表清单未变', async () => {
    const tablesOf = async () => {
      const r = await seed.client.query(
        `SELECT string_agg(table_name, ',' ORDER BY table_name) AS t
           FROM information_schema.tables WHERE table_schema = 'zenithjoy'`
      );
      return r.rows[0].t as string;
    };
    const before = await tablesOf();

    for (const bad of SQL_FRAGMENTS) {
      const bySort = await listRowsWith(seed.aliceCookie, tableId, {
        sort: [{ field_id: bad, dir: 'asc' }],
      });
      expect(bySort.status, `sort 传 ${bad} 返 ${bySort.status}`).toBe(400);
      expect(bySort.body?.error?.code).toBe('VALIDATION_FAILED');

      const byFilter = await listRowsWith(seed.aliceCookie, tableId, {
        filter: [{ field_id: bad, op: 'contains', value: 'x' }],
      });
      expect(byFilter.status, `filter 传 ${bad} 返 ${byFilter.status}`).toBe(400);
    }

    // dir 位：合法 field_id + 坏 dir，同样必须 400（只白名单 field_id 挡不住这一路）
    for (const badDir of BAD_DIRS) {
      const res = await listRowsWith(seed.aliceCookie, tableId, {
        sort: [{ field_id: numberFieldId, dir: badDir }],
      });
      expect(res.status, `dir 传 ${badDir} 返 ${res.status} —— dir 直接落 ORDER BY 关键字位`).toBe(
        400
      );
      expect(res.body?.error?.code).toBe('VALIDATION_FAILED');
    }

    // 参数不是数组 / 元素形状不符 → 同样 400，且绝不 5xx
    const malformed: unknown[] = ['not-an-array', { a: 1 }, [{ field_id: 123 }], [{ dir: 'asc' }]];
    for (const raw of malformed) {
      const res = await listRowsWith(seed.aliceCookie, tableId, { sort: raw });
      expect(res.status, `畸形 sort 参数 ${JSON.stringify(raw)} 返 ${res.status}`).toBe(400);
    }

    // 非法 op 同样 4xx（op 是白名单枚举，不是自由文本）
    const badOp = await listRowsWith(seed.aliceCookie, tableId, {
      filter: [{ field_id: textFieldId, op: 'nosuchop', value: 'x' }],
    });
    expect(badOp.status).toBe(400);

    expect(await tablesOf(), '表清单变了 —— 用户输入进了标识符位').toBe(before);
    const rows = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows WHERE table_id = $1',
      [tableId]
    );
    expect(rows.rows[0].n).toBe(3);
  });

  it('跨表 field_id 返 404 同形', async () => {
    // B 企业建自己的表，拿一个真实存在的 field_id —— 它对 A 企业而言必须与随机 uuid 不可区分
    const bTable = await createTable(seed.carolCookie, `他企业表-${seed.sfx}`, 'org');
    const bFieldId = await fieldIdOf(seed.carolCookie, bTable.body.data.table_id, 'text');
    expect(bFieldId).toBeTruthy();
    const rnd = randomUuid();

    const byForeign = await listRowsWith(seed.aliceCookie, tableId, {
      sort: [{ field_id: bFieldId, dir: 'asc' }],
    });
    const byRandom = await listRowsWith(seed.aliceCookie, tableId, {
      sort: [{ field_id: rnd, dir: 'asc' }],
    });

    expect(byForeign.status, '他企业 field_id 应 404').toBe(404);
    expect(byRandom.status, '随机 uuid 应 404').toBe(404);
    expect(
      JSON.stringify(byForeign.body),
      '两个 404 体不同 —— 可比对字节分辨他企业字段是否真实存在'
    ).toBe(JSON.stringify(byRandom.body));
    // 反枚举体不带 timestamp（Sprint A 的 notFoundBody 常量）
    expect(Object.prototype.hasOwnProperty.call(byForeign.body, 'timestamp')).toBe(false);
  });
});
