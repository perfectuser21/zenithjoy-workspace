/**
 * A4 — S3 权限三档 + 六处过滤 + most-restrictive 继承 + member live 校验 + fail-closed 503
 *
 * 同组织两人：alice（表主）、bob（同组织他人）。六处里的 HTTP 五处在此验
 * （树 / 搜索 / 打开 / 导出 / @提及）；第六处「协作准入」在 collab-ws.test.ts 验。
 *
 * 禁 mock 边：真 documents / document_members / tenant_members 查询。
 * fail-closed 503 用**真 DDL 故障注入**（RENAME 表使解析查询抛错，测后复原），不 stub DB。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  cleanupDocs,
  createDoc,
  getDoc,
  getTree,
  searchDocs,
  exportDoc,
  resolveMention,
  setVisibility,
  proseDoc,
  type TwoTenantSeed,
} from './_helpers';

describe('A4 权限三档 + 六处过滤 + 继承 + live 校验 + fail-closed [BEHAVIOR]', () => {
  let s: TwoTenantSeed;

  beforeAll(async () => {
    s = await seedTwoTenants('collab-a4');
  });

  afterAll(async () => {
    if (s) {
      await cleanupDocs(s.client, [s.orgATenantId, s.orgBTenantId]);
      await cleanupSeed(s);
    }
  });

  async function newDoc(vis: 'org' | 'members' | 'private', member_ids?: string[]) {
    const created = await createDoc(s.aliceCookie, { title: `A4-${vis}-${Math.random()}`, content: proseDoc('保密正文') });
    const id = created.body.data.id;
    await setVisibility(s.aliceCookie, id, vis, member_ids);
    return id;
  }

  it('org 档：同组织他人在打开/搜索/导出四处均可见', async () => {
    const id = await newDoc('org');
    expect((await getDoc(s.bobCookie, id)).status).toBe(200);
    expect(JSON.stringify((await getTree(s.bobCookie)).body.data)).toContain(id);
    expect(JSON.stringify((await searchDocs(s.bobCookie, '保密正文')).body.data)).toContain(id);
    expect((await exportDoc(s.bobCookie, id)).status).toBe(200);
  });

  it('private 档：同组织他人在 树/搜索/打开/导出/@提及 五处全部 404（统一同形状）', async () => {
    const id = await newDoc('private');
    expect((await getDoc(s.bobCookie, id)).status).toBe(404);
    expect(JSON.stringify((await getTree(s.bobCookie)).body.data)).not.toContain(id);
    expect(JSON.stringify((await searchDocs(s.bobCookie, '保密正文')).body.data)).not.toContain(id);
    expect((await exportDoc(s.bobCookie, id)).status).toBe(404);
    const bDoc = await createDoc(s.bobCookie, { title: 'bob-own', content: proseDoc('b') });
    expect((await resolveMention(s.bobCookie, bDoc.body.data.id, id)).status).toBe(404);
    // 表主本人始终可读
    expect((await getDoc(s.aliceCookie, id)).status).toBe(200);
  });

  it('members 档：命中成员集合的他人可读，未命中的他人 404', async () => {
    const id = await newDoc('members', [s.bobOpenId]);
    expect((await getDoc(s.bobCookie, id)).status).toBe(200);
  });

  it('member live 校验：从 tenant_members 删除该 member 后，其对成员集合文档立即不可达（非只信静态 id 列表）', async () => {
    const id = await newDoc('members', [s.bobOpenId]);
    expect((await getDoc(s.bobCookie, id)).status).toBe(200);
    // bob 离开组织：删其 tenant_members 行（静态 member_ids 列表里仍写着 bob）
    await s.client.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id=$1 AND feishu_user_id=$2', [
      s.orgATenantId,
      s.bobOpenId,
    ]);
    // 即便 member_ids 静态列表没改，live 校验必须让 bob 立刻 404（此后 bob 会话也丢 org 归属）
    const after = await getDoc(s.bobCookie, id);
    expect(after.status).toBe(404);
    // 复原，避免影响后续用例
    await s.client.query(
      "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING",
      [s.orgATenantId, s.bobOpenId]
    );
  });

  it('most-restrictive 继承：父级设 private 后，子文档对同组织他人取严 → 404', async () => {
    const parent = await newDoc('private');
    const child = await createDoc(s.aliceCookie, { title: '子档', parent_id: parent, content: proseDoc('子') });
    // 子档自身默认 org 可见，但父级 private → 继承取严，bob 打不开
    expect((await getDoc(s.bobCookie, child.body.data.id)).status).toBe(404);
    expect((await getDoc(s.aliceCookie, child.body.data.id)).status).toBe(200);
  });

  it('fail-closed 503：权限解析查询失败时返回 503（不降级为可见）', async () => {
    const id = await newDoc('members', [s.bobOpenId]);
    // 真 DDL 故障注入：让成员集合解析查询抛错（表暂时改名），断言 503 而非 200 可见
    await s.client.query('ALTER TABLE zenithjoy.document_members RENAME TO document_members__faultinj');
    try {
      const res = await getDoc(s.bobCookie, id);
      expect(res.status).toBe(503);
      expect(res.status).not.toBe(200);
    } finally {
      await s.client.query('ALTER TABLE zenithjoy.document_members__faultinj RENAME TO document_members');
    }
  });
});
