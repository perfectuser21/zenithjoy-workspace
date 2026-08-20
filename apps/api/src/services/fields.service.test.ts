/**
 * G1 段② 的 fail-closed 那一半：租户为空时五个方法**一个都不许查库**。
 *
 * 为什么这条要单独钉：`WHERE tenant_id = $1` 在 $1 为空时的行为取决于调用链上游，
 * 而"上游忘了设 tenantId"是最容易发生也最难发现的情形 —— 一旦退化成查全表，
 * 三条反向隔离断言全绿而数据早就串了。所以租户为空必须在**碰 DB 之前**就抛。
 *
 * 真正的跨租户隔离（A 读不到 B、A 改得动自己那一行且真落库）由合同的真 Postgres 测试与
 * `--a4-only` 段③ 覆盖 —— `fields.service ↔ field_definitions` 是合同「禁 mock 边清单」
 * 里的一条边，不许 stub。本文件一次都不触发真查询。
 */
import { describe, it, expect } from 'vitest';
import { FieldsService } from './fields.service';

const svc = new FieldsService();
const EMPTY_TENANTS = ['', undefined as unknown as string, null as unknown as string];

describe('fields.service 租户 fail-closed', () => {
  it('getFields 在租户为空时抛 403，不退化成查全表', async () => {
    for (const t of EMPTY_TENANTS) {
      await expect(svc.getFields(t)).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('getFieldById 在租户为空时抛 403', async () => {
    await expect(svc.getFieldById('00000000-0000-4000-8000-000000000000', '')).rejects.toMatchObject(
      { statusCode: 403 }
    );
  });

  it('createField 在租户为空时抛 403 —— 无归属的行一旦写进去就再也说不清归谁', async () => {
    await expect(
      svc.createField({ field_name: 'x', field_type: 'text' } as never, '')
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('updateField / deleteField 在租户为空时抛 403', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await expect(svc.updateField(id, { field_name: 'y' }, '')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(svc.deleteField(id, '')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('抛的是 NO_TENANT 而不是含糊的 500', async () => {
    await expect(svc.getFields('')).rejects.toMatchObject({ code: 'NO_TENANT' });
  });
});
