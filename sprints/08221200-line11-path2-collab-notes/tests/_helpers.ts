/**
 * 路② 协同笔记 第一刀 测试公共夹具（TDD Red 阶段）
 *
 * 会话/组织归属**直接复用路③ 已验证夹具**（seedTwoTenants / codeFor / cleanupSeed）——
 * 不另造一套 seed/login。路③ 的 `_workbench-fixture.ts` 是唯一经 CI 真 Postgres 跑绿的范式：
 *   - 真 better-auth 会话：走 /api/staff/feishu-login 真签发，cookie 不伪造；
 *   - 真 Postgres：tenants / tenant_members / session / user 真插真查，不 stub DB 层；
 *   - 唯一允许 mock 的边：飞书 OAuth 上游（FEISHU_API_BASE 指本地假上游，属环境端点重定向）。
 * 抄一份平行 seed = 给两套种子行为分叉开口子（路③ 夹具注释原话）。
 *
 * 连库纪律：seed 用 pg Client（E2E_DATABASE_URL / DATABASE_URL），被测 app 走 connection.ts pool
 * （DATABASE_HOST/PORT/NAME/USER）——两者必须指向**同一库**，否则 seed 一个库 app 读另一个。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：不 mock 会话解析、不 mock tenant_members / documents
 * 查询、不 mock CRDT 落库、不 mock WS 握手。
 */
import request from 'supertest';
import type { Client } from 'pg';
import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import app from '../../../apps/api/src/app';

// 复用路③ 双企业种子 + 真会话签发（同一份，不平行造）
export {
  PGURL,
  codeFor,
  seedTwoTenants,
  cleanupSeed,
  type TwoTenantSeed,
} from '../../08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/_workbench-fixture';

/** 文档端点族基址（合同 ## 假设的 API/WS 表面：/api/workbench/documents） */
export const DOC_BASE = '/api/workbench/documents';

export const AGENT = request(app);

/** 一段最小合法 ProseMirror JSON 正文（标题 + 段落） */
export function proseDoc(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `标题-${text}` }] },
      { type: 'paragraph', content: [{ type: 'text', text }] },
    ],
  };
}

/**
 * 建文档；forgedOrgId 非空时塞进请求体，服务端必须忽略（A1 判据：org 只来自会话）。
 * 期望响应 201 { id, org_id, parent_id, title, visibility, ... }。
 */
export const createDoc = (
  cookie: string,
  body: { title: string; parent_id?: string | null; content?: unknown; forgedOrgId?: string } = { title: '未命名' }
) =>
  request(app)
    .post(DOC_BASE)
    .set('Cookie', cookie)
    .send({
      title: body.title,
      ...(body.parent_id !== undefined ? { parent_id: body.parent_id } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
      ...(body.forgedOrgId ? { org_id: body.forgedOrgId } : {}),
    });

export const getDoc = (cookie: string, id: string) =>
  request(app).get(`${DOC_BASE}/${id}`).set('Cookie', cookie);

export const patchDoc = (cookie: string, id: string, patch: { content?: unknown; title?: string }) =>
  request(app).patch(`${DOC_BASE}/${id}`).set('Cookie', cookie).send(patch);

export const moveDoc = (cookie: string, id: string, parent_id: string | null, forgedOrgId?: string) =>
  request(app)
    .post(`${DOC_BASE}/${id}/move`)
    .set('Cookie', cookie)
    .send({ parent_id, ...(forgedOrgId ? { org_id: forgedOrgId } : {}) });

export const deleteDoc = (cookie: string, id: string) =>
  request(app).delete(`${DOC_BASE}/${id}`).set('Cookie', cookie);

export const restoreDoc = (cookie: string, id: string) =>
  request(app).post(`${DOC_BASE}/${id}/restore`).set('Cookie', cookie).send({});

export const getTree = (cookie: string) =>
  request(app).get(`${DOC_BASE}/tree`).set('Cookie', cookie);

export const searchDocs = (cookie: string, q: string) =>
  request(app).get(`${DOC_BASE}/search`).query({ q }).set('Cookie', cookie);

export const exportDoc = (cookie: string, id: string, format = 'markdown') =>
  request(app).get(`${DOC_BASE}/${id}/export`).query({ format }).set('Cookie', cookie);

export const setVisibility = (
  cookie: string,
  id: string,
  visibility: 'org' | 'members' | 'private',
  member_ids?: string[]
) =>
  request(app)
    .put(`${DOC_BASE}/${id}/visibility`)
    .set('Cookie', cookie)
    .send({ visibility, ...(member_ids ? { member_ids } : {}) });

export const resolveMention = (cookie: string, id: string, target_id: string) =>
  request(app).post(`${DOC_BASE}/${id}/mention/resolve`).set('Cookie', cookie).send({ target_id });

/** 直接给某 feishu_user_id 再塞一条 tenant_members 行 → 使其变多 org 成员（A1/A3-c 用）。 */
export async function makeMultiOrg(client: Client, openId: string, otherTenantId: string): Promise<void> {
  await client.query(
    "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    [otherTenantId, openId]
  );
}

/** 删该会话行使其失效（A3-e 用）——不静默续命的前提是服务端能感知 session 消失。 */
export async function killSession(client: Client, openId: string): Promise<void> {
  await client.query('DELETE FROM zenithjoy.session WHERE "userId" = $1', [openId]);
}

/** 清理本刀写入的 documents（叠加在路③ cleanupSeed 之上，先删文档再删企业）。 */
export async function cleanupDocs(client: Client, orgIds: string[]): Promise<void> {
  const swallow = () => undefined;
  await client
    .query('DELETE FROM zenithjoy.document_members WHERE doc_id IN (SELECT id FROM zenithjoy.documents WHERE org_id = ANY($1::uuid[]))', [orgIds])
    .catch(swallow);
  await client.query('DELETE FROM zenithjoy.documents WHERE org_id = ANY($1::uuid[])', [orgIds]).catch(swallow);
}

// ---------------------------------------------------------------------------
// 真 WS 协作房夹具（禁 mock：真 http server + 真 attachCollabWS + 真 ws 客户端）
// ---------------------------------------------------------------------------

export interface CollabServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

/**
 * 起一个**真** http server，把 attachCollabWS 挂上去（与生产 index.ts 同一条挂载路径）。
 * attachCollabWS 未实现前，import 即失败 → 整个 suite Red（正确的 TDD 红）。
 */
export async function startCollabServer(): Promise<CollabServer> {
  // 动态 import：net-new 模块，未实现时抛错，让 suite 红在"没实现"而非语法
  const { attachCollabWS } = await import('../../../apps/api/src/services/collab-ws');
  const server = http.createServer(app);
  attachCollabWS(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface WsAttempt {
  /** 'open' = 握手成功建房；'rejected' = 服务端 close/未建房 */
  outcome: 'open' | 'rejected';
  closeCode?: number;
  /** 建房成功后从服务端收到的首帧（若有），用于断言"拿不到任何在线/正文信号" */
  firstFrame?: Buffer | null;
  ws?: WebSocket;
}

/**
 * 尝试连 /collab-ws?doc_id=...，可选携带 cookie。返回握手结局。
 * 判据："建房" = 收到 open 且未被立即 close；"拒绝" = open 前 close 或 open 后即刻 close 且无任何帧。
 */
export function connectCollab(
  port: number,
  docId: string,
  opts: { cookie?: string; waitFrameMs?: number } = {}
): Promise<WsAttempt> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/collab-ws?doc_id=${encodeURIComponent(docId)}`, { headers });
    let opened = false;
    let firstFrame: Buffer | null = null;
    let settled = false;
    const settle = (a: WsAttempt) => {
      if (settled) return;
      settled = true;
      resolve(a);
    };
    ws.on('open', () => {
      opened = true;
      // 建房后给一小段时间看是否被立即 close，以及是否收到任何在线/正文帧
      setTimeout(() => settle({ outcome: 'open', firstFrame, ws }), opts.waitFrameMs ?? 300);
    });
    ws.on('message', (data) => {
      if (!firstFrame) firstFrame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    });
    ws.on('close', (code) => {
      settle({ outcome: opened && firstFrame ? 'open' : 'rejected', closeCode: code, firstFrame });
    });
    ws.on('error', () => {
      settle({ outcome: 'rejected' });
    });
  });
}
