/**
 * A3-b/c/d/e + A10 — /collab-ws 握手安全 + 单 org 可用 + 会话失效 + 服务端 CRDT-CV
 *
 * 禁 mock 边：真 http server + 真 attachCollabWS + 真 ws 客户端 + 真 Yjs update + 真 Postgres 回查。
 * attachCollabWS / collab-ws 服务未实现前，startCollabServer 的动态 import 抛错 → 整 suite Red。
 *
 * 判定点（合同判定登记表）：
 *   - 「建房 vs 拒绝」= 收到 open 且未被立即 close 且无 close 帧 → 建房；否则拒绝。
 *   - 「拿不到在线/正文信号」= firstFrame 为空。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  cleanupDocs,
  createDoc,
  makeMultiOrg,
  killSession,
  proseDoc,
  startCollabServer,
  connectCollab,
  type TwoTenantSeed,
  type CollabServer,
} from './_helpers';

describe('A3-b/c/d/e + A10 collab-ws 握手安全与 CV [BEHAVIOR]', () => {
  let s: TwoTenantSeed;
  let srv: CollabServer;
  let aliceDocId: string;

  beforeAll(async () => {
    s = await seedTwoTenants('collab-ws');
    const created = await createDoc(s.aliceCookie, { title: 'ws-doc', content: proseDoc('ws初始') });
    aliceDocId = created.body.data.id;
    srv = await startCollabServer();
  }, 30000);

  afterAll(async () => {
    if (srv) await srv.close();
    if (s) {
      await cleanupDocs(s.client, [s.orgATenantId, s.orgBTenantId]);
      await cleanupSeed(s);
    }
  });

  it('A3-b 无会话握手：无 cookie 连 /collab-ws → 拒绝不建房，收不到任何在线/正文帧', async () => {
    const r = await connectCollab(srv.port, aliceDocId, {});
    expect(r.outcome).toBe('rejected');
    expect(r.firstFrame ?? null).toBeNull();
  });

  it('A3-b doc 权校验：B 企业会话连 A 文档协作房 → 拒绝不建房（跨企业协作房隔离）', async () => {
    const r = await connectCollab(srv.port, aliceDocId, { cookie: s.carolCookie });
    expect(r.outcome).toBe('rejected');
    expect(r.firstFrame ?? null).toBeNull();
  });

  it('A3-c 多 org fail-closed：多 org 成员连 /collab-ws → 拒绝不建房（绝不取 rows[0]）', async () => {
    // 让 alice 变多 org 成员（再塞一条到 B 企业），tenant_members 命中 rows.length>1
    await makeMultiOrg(s.client, s.aliceOpenId, s.orgBTenantId);
    const r = await connectCollab(srv.port, aliceDocId, { cookie: s.aliceCookie });
    expect(r.outcome).toBe('rejected');
    expect(r.firstFrame ?? null).toBeNull();
    // 复原：删掉多加的那条，恢复 alice 单 org
    await s.client.query('DELETE FROM zenithjoy.tenant_members WHERE tenant_id=$1 AND feishu_user_id=$2', [
      s.orgBTenantId,
      s.aliceOpenId,
    ]);
  });

  it('A3-d 单 org 端到端可用：单 org 成员建房→发一条 Yjs update→服务端落库 crdt_state 非空', async () => {
    const Y = await import('yjs');
    const r = await connectCollab(srv.port, aliceDocId, { cookie: s.aliceCookie });
    expect(r.outcome).toBe('open');
    // 发一条真 Yjs update（在 TipTap Collaboration 默认 fragment 'default' 上写一段文本）
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('单org写入OK')]);
    frag.insert(0, [p]);
    const update = Y.encodeStateAsUpdate(ydoc);
    r.ws!.send(update);
    await new Promise((res) => setTimeout(res, 800));
    r.ws!.close();
    const row = await s.client.query('SELECT crdt_state FROM zenithjoy.documents WHERE id=$1', [aliceDocId]);
    expect(row.rows[0].crdt_state).toBeTruthy();
    // 硬断言：把落库的 crdt_state 还原成 Y.Doc，派生 fragment 必须逐字含刚写的文本
    // （size>0 证明不了内容真落库；原样写空 doc / 丢内容 re-encode 都能 size>0 假绿）
    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(row.rows[0].crdt_state as Buffer));
    expect(restored.getXmlFragment('default').toString()).toContain('单org写入OK');
  }, 15000);

  it('A3-e 会话失效不静默续命：建 WS 连在线后删 session → 下一写操作时被断开', async () => {
    const Y = await import('yjs');
    const r = await connectCollab(srv.port, aliceDocId, { cookie: s.aliceCookie });
    expect(r.outcome).toBe('open');
    let closed = false;
    r.ws!.on('close', () => {
      closed = true;
    });
    // 服务端使该会话失效
    await killSession(s.client, s.aliceOpenId);
    // 下一写操作应触发服务端复核 session 存活并断开
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    frag.insert(0, [new Y.XmlElement('paragraph')]);
    r.ws!.send(Y.encodeStateAsUpdate(ydoc));
    await new Promise((res) => setTimeout(res, 2500));
    expect(closed).toBe(true);
    // 复原会话，避免污染后续用例（重新登录）
  }, 15000);

  it('A10 服务端 CRDT-CV：注入非白名单属性(onerror)的 Yjs update → 落库 crdt_state 不含该属性', async () => {
    const Y = await import('yjs');
    // 重新登录（上一用例杀了 session）
    const s2 = await seedTwoTenants('collab-ws-a10');
    const doc = await createDoc(s2.aliceCookie, { title: 'cv-doc', content: proseDoc('cv初始') });
    const docId = doc.body.data.id;
    const r = await connectCollab(srv.port, docId, { cookie: s2.aliceCookie });
    expect(r.outcome).toBe('open');
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    const img = new Y.XmlElement('image');
    img.setAttribute('onerror', "alert('xss')"); // 非白名单属性
    img.setAttribute('src', 'javascript:alert(2)'); // 非法协议
    frag.insert(0, [img]);
    r.ws!.send(Y.encodeStateAsUpdate(ydoc));
    await new Promise((res) => setTimeout(res, 800));
    r.ws!.close();
    const row = await s2.client.query('SELECT crdt_state, content FROM zenithjoy.documents WHERE id=$1', [docId]);
    const blob = (row.rows[0].crdt_state as Buffer | null) ?? Buffer.alloc(0);
    const contentStr = JSON.stringify(row.rows[0].content ?? {});
    // 交叉断言：两处产物都不含两种 payload（非白名单属性 + 非法协议）
    expect(blob.toString('latin1')).not.toContain('onerror');
    expect(blob.toString('latin1')).not.toContain('javascript:');
    expect(contentStr).not.toContain('onerror');
    expect(contentStr).not.toContain('javascript:');
    await cleanupDocs(s2.client, [s2.orgATenantId, s2.orgBTenantId]);
    await cleanupSeed(s2);
  }, 20000);
});
