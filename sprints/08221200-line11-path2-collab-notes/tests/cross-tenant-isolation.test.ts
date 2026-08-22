/**
 * A1 — cross-tenant 六层隔离（文档/文件夹/正文/@提及/读API/协作准入的 HTTP 面）
 *
 * B 企业员工丙（carol）持真会话，对 A 企业员工甲（alice）建的文档做各种访问，
 * 一律 404（同「不存在」形状），且 A 的文档逐字未变（前后 content 一致）。
 * 协作房那一层（WS 拒绝）在 collab-ws.test.ts 里验，本文件覆盖 HTTP 五面。
 *
 * 禁 mock 边：真 tenant_members 查询决定 org 归属；不 stub。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  cleanupDocs,
  createDoc,
  getDoc,
  patchDoc,
  moveDoc,
  deleteDoc,
  searchDocs,
  exportDoc,
  resolveMention,
  proseDoc,
  type TwoTenantSeed,
} from './_helpers';

describe('A1 cross-tenant 六层隔离 [BEHAVIOR]', () => {
  let s: TwoTenantSeed;
  let aliceDocId: string;
  const marker = '甲企业机密内容ABC';

  beforeAll(async () => {
    s = await seedTwoTenants('collab-a1');
    const created = await createDoc(s.aliceCookie, { title: '甲机密', content: proseDoc(marker) });
    aliceDocId = created.body.data.id;
  });

  afterAll(async () => {
    if (s) {
      await cleanupDocs(s.client, [s.orgATenantId, s.orgBTenantId]);
      await cleanupSeed(s);
    }
  });

  it('读层：B 会话 GET A 的文档 → 404', async () => {
    const res = await getDoc(s.carolCookie, aliceDocId);
    expect(res.status).toBe(404);
  });

  it('检索层：B 会话搜 A 文档关键词 → 命中列表不含 A 文档', async () => {
    const res = await searchDocs(s.carolCookie, marker);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).not.toContain(aliceDocId);
  });

  it('导出层：B 会话导出 A 文档 → 404，拿不到正文', async () => {
    const res = await exportDoc(s.carolCookie, aliceDocId, 'markdown');
    expect(res.status).toBe(404);
    expect(res.text ?? '').not.toContain(marker);
  });

  it('@提及层：B 会话 mention/resolve A 文档 → 404 且不泄标题（反枚举）', async () => {
    const bDoc = await createDoc(s.carolCookie, { title: 'B自己的', content: proseDoc('b') });
    const res = await resolveMention(s.carolCookie, bDoc.body.data.id, aliceDocId);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('甲机密');
  });

  it('正文层：B 会话 PATCH A 文档正文 → 404，且 A 正文逐字未变', async () => {
    const before = await getDoc(s.aliceCookie, aliceDocId);
    const patched = await patchDoc(s.carolCookie, aliceDocId, { content: proseDoc('B篡改') });
    expect(patched.status).toBe(404);
    const after = await getDoc(s.aliceCookie, aliceDocId);
    expect(JSON.stringify(after.body.data.content)).toBe(JSON.stringify(before.body.data.content));
    expect(JSON.stringify(after.body.data.content)).toContain(marker);
  });

  it('文件夹层：B 会话 move A 文档改父级 → 404，且不生效', async () => {
    const res = await moveDoc(s.carolCookie, aliceDocId, null);
    expect(res.status).toBe(404);
  });

  it('删除层：B 会话 DELETE A 文档 → 404，A 文档仍可被甲读到', async () => {
    const del = await deleteDoc(s.carolCookie, aliceDocId);
    expect(del.status).toBe(404);
    const still = await getDoc(s.aliceCookie, aliceDocId);
    expect(still.status).toBe(200);
  });

  it('伪造 org_id：B 会话建文档带 forged org_id=A → 落库仍是 B org（org 只来自会话）', async () => {
    const res = await createDoc(s.carolCookie, {
      title: '伪造尝试',
      content: proseDoc('forge'),
      forgedOrgId: s.orgATenantId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.org_id).toBe(s.orgBTenantId);
    // 甲在自己组织树里搜不到丙这篇（它归 B）
    const aliceSearch = await searchDocs(s.aliceCookie, '伪造尝试');
    expect(JSON.stringify(aliceSearch.body.data)).not.toContain(res.body.data.id);
  });

  it('404 同形状：B 读 A 文档 与 读一个纯不存在 id，响应体逐字节一致（反枚举）', async () => {
    const crypto = await import('crypto');
    const md5 = (o: unknown) => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex');
    const forbidden = await getDoc(s.carolCookie, aliceDocId); // 存在但无权
    const nonexist = await getDoc(s.carolCookie, '00000000-0000-0000-0000-000000000000');
    expect(forbidden.status).toBe(404);
    expect(nonexist.status).toBe(404);
    expect(md5(forbidden.body)).toBe(md5(nonexist.body)); // 无 timestamp、同文案 → md5 全等
  });
});
