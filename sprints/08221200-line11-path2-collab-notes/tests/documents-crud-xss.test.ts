/**
 * A2 — S1 文档写得出留得住 + XSS/SQL 白名单 + 自动保存不静默丢
 *
 * GP Step1 用户可观察输出：建档→写富文本→存→刷新仍在→本组织树可见→导出 Markdown 往返。
 * 全部真 apps/api + 真 Postgres（禁 mock 边：代码 ↔ zenithjoy.documents 真插真查）。
 * 这些用例在 documents 端点族与 document-schema 白名单实现前必然 Red（端点 404 / 模块不存在）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  cleanupDocs,
  createDoc,
  getDoc,
  patchDoc,
  getTree,
  exportDoc,
  deleteDoc,
  proseDoc,
  type TwoTenantSeed,
} from './_helpers';

describe('A2 文档写留 + XSS/SQL + 自动保存不静默 [BEHAVIOR]', () => {
  let s: TwoTenantSeed;

  beforeAll(async () => {
    s = await seedTwoTenants('collab-a2');
  });

  afterAll(async () => {
    if (s) {
      await cleanupDocs(s.client, [s.orgATenantId, s.orgBTenantId]);
      await cleanupSeed(s);
    }
  });

  it('建档返回 201 且 org_id 取自会话（伪造 org_id 被忽略）', async () => {
    const res = await createDoc(s.aliceCookie, {
      title: '第一篇',
      content: proseDoc('内容甲'),
      forgedOrgId: s.orgBTenantId, // 伪造成 B 企业，服务端必须忽略
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.org_id).toBe(s.orgATenantId); // 来自会话，不是伪造的 B
    expect(res.body.data.visibility).toBeTruthy();
  });

  it('写富文本→存→刷新 GET 仍返回正文（留得住）', async () => {
    const created = await createDoc(s.aliceCookie, { title: '留存', content: proseDoc('刷新仍在') });
    const id = created.body.data.id;
    const got = await getDoc(s.aliceCookie, id);
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body.data.content)).toContain('刷新仍在');
  });

  it('新建文档出现在本组织文档树', async () => {
    const created = await createDoc(s.aliceCookie, { title: '树可见节点', content: proseDoc('x') });
    const id = created.body.data.id;
    const tree = await getTree(s.aliceCookie);
    expect(tree.status).toBe(200);
    const flat = JSON.stringify(tree.body.data);
    expect(flat).toContain(id);
  });

  it('导出 Markdown 往返非空且含正文文字', async () => {
    const created = await createDoc(s.aliceCookie, { title: '导出篇', content: proseDoc('导出正文XYZ') });
    const id = created.body.data.id;
    const exp = await exportDoc(s.aliceCookie, id, 'markdown');
    expect(exp.status).toBe(200);
    const md = typeof exp.text === 'string' && exp.text.length ? exp.text : JSON.stringify(exp.body);
    expect(md).toContain('导出正文XYZ');
  });

  it('存储型 XSS：javascript: 链接协议入库前被白名单剥离（content jsonb 不含 javascript:）', async () => {
    const malicious = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '点我',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    const created = await createDoc(s.aliceCookie, { title: 'xss-link', content: malicious });
    expect(created.status).toBe(201);
    const got = await getDoc(s.aliceCookie, created.body.data.id);
    expect(JSON.stringify(got.body.data.content)).not.toContain('javascript:');
  });

  it('存储型 XSS：img onerror 非白名单属性入库前被剥离（content jsonb 不含 onerror）', async () => {
    const malicious = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'image', attrs: { src: 'x', onerror: "alert('xss')" } as Record<string, unknown> },
          ],
        },
      ],
    };
    const created = await createDoc(s.aliceCookie, { title: 'xss-img', content: malicious });
    expect(created.status).toBe(201);
    const got = await getDoc(s.aliceCookie, created.body.data.id);
    expect(JSON.stringify(got.body.data.content)).not.toContain('onerror');
  });

  it('SQL 注入标题被参数化：documents 表不被 DROP，文档以字面标题落库', async () => {
    const evil = '"; DROP TABLE zenithjoy.documents;--';
    const created = await createDoc(s.aliceCookie, { title: evil, content: proseDoc('sql') });
    expect(created.status).toBe(201);
    // 表仍在 → 还能再查到刚建的文档（若表被 drop，这一步会 500/连不上）
    const got = await getDoc(s.aliceCookie, created.body.data.id);
    expect(got.status).toBe(200);
    expect(got.body.data.title).toBe(evil); // 字面存，不当 SQL 执行
    const stillThere = await s.client.query("SELECT to_regclass('zenithjoy.documents') AS t");
    expect(stillThere.rows[0].t).toBe('zenithjoy.documents');
  });

  it('自动保存失败不静默 200：PATCH 已软删的文档返回 4xx 错误码', async () => {
    const created = await createDoc(s.aliceCookie, { title: '待删', content: proseDoc('v1') });
    const id = created.body.data.id;
    await deleteDoc(s.aliceCookie, id);
    const patched = await patchDoc(s.aliceCookie, id, { content: proseDoc('v2') });
    expect(patched.status).toBeGreaterThanOrEqual(400);
    expect(patched.status).not.toBe(200); // 绝不静默成功
  });

  it('自动保存失败不静默 200：PATCH 畸形正文（非法 schema）返回 4xx 而非静默入库', async () => {
    const created = await createDoc(s.aliceCookie, { title: '畸形', content: proseDoc('ok') });
    const id = created.body.data.id;
    const patched = await patchDoc(s.aliceCookie, id, { content: { not: 'a-prosemirror-doc' } });
    expect(patched.status).toBeGreaterThanOrEqual(400);
    // 落库的仍是旧正文，没被畸形数据覆盖
    const got = await getDoc(s.aliceCookie, id);
    expect(JSON.stringify(got.body.data.content)).toContain('ok');
  });
});
