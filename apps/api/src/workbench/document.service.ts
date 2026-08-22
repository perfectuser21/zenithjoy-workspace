/**
 * 路② 协同文档 service —— zenithjoy.documents 的读写 + 三档可见性 + 六处过滤
 *
 * 三条不可让步的纪律（沿用路③ workbench.service）：
 *  1. **组织归属只来自入参 orgId**（由 documentAuthGuard 从会话解析）。本文件不认识请求头，
 *     请求体里的 org_id 一律无入口。
 *  2. **XSS 白名单单一实现**：正文入库前一律过 document-schema.sanitizeDocument（HTTP 保存路径
 *     与 collab-ws CV 共用同一份实现）。
 *  3. **软删**：删文档只打 deleted_at，物理行保留，回收站可还原。
 *
 * 三档可见性（visibility）：
 *   - 'org'      本组织成员可见
 *   - 'members'  仅 document_members 里列出的成员（+ 表主）可见
 *   - 'private'  仅表主可见
 * most-restrictive 继承：一篇文档的实际可见范围 ≤ 其所有祖先——任一祖先对你不可见，子档即不可达。
 * member live 校验：可见性判定基于会话实时解析出的 orgId + memberId（guard 每请求真查 tenant_members），
 *   成员被移出企业后其会话解析不到本 org → guard 直接 404，静态 member_ids 列表再写着他也无效。
 *
 * 反枚举：跨组织 id / 无权文档 / 不存在 id —— 三种情形一律返 null，路由统一翻同一个 404。
 * fail-closed：可见性解析（document_members 查询等）抛错时**不吞成 null**，向上抛 → 路由 503。
 */
import type { Pool, PoolClient } from 'pg';
import pool from '../db/connection';
import {
  sanitizeDocument,
  isValidProseMirrorDoc,
} from './document-schema';

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

export type Visibility = 'org' | 'members' | 'private';

export interface DocRow {
  id: string;
  org_id: string;
  parent_id: string | null;
  title: string;
  owner_member_id: string;
  visibility: Visibility;
  content: unknown;
  ai_retrieval_opt_out: boolean;
  deleted_at: string | null;
}

export interface DocDetail {
  id: string;
  org_id: string;
  parent_id: string | null;
  title: string;
  visibility: Visibility;
  content: unknown;
  ai_retrieval_opt_out: boolean;
  created_at?: string;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isUuid(v: string): boolean {
  return typeof v === 'string' && UUID_RE.test(v);
}

const EMPTY_DOC = { type: 'doc', content: [] };

function toDetail(row: DocRow, created_at?: string): DocDetail {
  return {
    id: row.id,
    org_id: row.org_id,
    parent_id: row.parent_id,
    title: row.title,
    visibility: row.visibility,
    content: row.content,
    ai_retrieval_opt_out: row.ai_retrieval_opt_out,
    ...(created_at ? { created_at } : {}),
  };
}

/** 拉一行 documents（仅按 id + org_id 过滤，不含可见性）。跨 org / 不存在 → null。 */
async function fetchRow(
  db: Pool | PoolClient,
  id: string,
  orgId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<DocRow | null> {
  if (!isUuid(id)) return null;
  const delClause = opts.includeDeleted ? '' : 'AND deleted_at IS NULL';
  const r = await db.query(
    `SELECT id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
            content, ai_retrieval_opt_out, deleted_at
       FROM zenithjoy.documents
      WHERE id = $1 AND org_id = $2 ${delClause}`,
    [id, orgId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0] as Record<string, unknown>;
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    title: String(row.title),
    owner_member_id: String(row.owner_member_id),
    visibility: row.visibility as Visibility,
    content: row.content,
    ai_retrieval_opt_out: Boolean(row.ai_retrieval_opt_out),
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
  };
}

/**
 * 单节点自身可见性（不含继承）。members 档查 document_members（可抛 → fail-closed）。
 * 表主本人恒可见。
 */
async function nodeVisible(
  db: Pool | PoolClient,
  memberId: string,
  row: DocRow
): Promise<boolean> {
  if (row.owner_member_id === memberId) return true;
  if (row.visibility === 'org') return true;
  if (row.visibility === 'private') return false;
  // members：查成员集合（查询抛错时不吞 → 由调用链翻 503）
  const r = await db.query(
    'SELECT 1 FROM zenithjoy.document_members WHERE doc_id = $1 AND member_id = $2 LIMIT 1',
    [row.id, memberId]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * most-restrictive 继承：文档本身 + 全部祖先逐级都要对 (orgId, memberId) 可见。
 * 任一层不可见 → false。祖先查询/成员查询抛错 → 向上抛（fail-closed 503）。
 */
async function visibleWithInheritance(
  db: Pool | PoolClient,
  orgId: string,
  memberId: string,
  row: DocRow
): Promise<boolean> {
  let cur: DocRow | null = row;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) break; // 环保护
    seen.add(cur.id);
    if (!(await nodeVisible(db, memberId, cur))) return false;
    if (!cur.parent_id) break;
    cur = await fetchRow(db, cur.parent_id, orgId, { includeDeleted: true });
  }
  return true;
}

/** 读一篇文档（含继承可见性）。不可见/跨org/不存在 → null；可见性查询失败 → 抛（503）。 */
export async function getDocument(
  orgId: string,
  memberId: string,
  id: string
): Promise<DocDetail | null> {
  const row = await fetchRow(pool, id, orgId);
  if (!row) return null;
  if (!(await visibleWithInheritance(pool, orgId, memberId, row))) return null;
  return toDetail(row);
}

/** 建文档。org 只来自入参；正文过白名单剥洗后落库。 */
export async function createDocument(
  orgId: string,
  memberId: string,
  params: { title?: unknown; parent_id?: unknown; content?: unknown }
): Promise<DocDetail> {
  const title = typeof params.title === 'string' && params.title.length ? params.title : '未命名';
  let parentId: string | null = null;
  if (typeof params.parent_id === 'string' && isUuid(params.parent_id)) {
    // 父级必须本组织存在，否则忽略（不跨 org 挂父）
    const parent = await fetchRow(pool, params.parent_id, orgId, { includeDeleted: true });
    parentId = parent ? parent.id : null;
  }
  let content: unknown = EMPTY_DOC;
  if (params.content !== undefined) {
    if (!isValidProseMirrorDoc(params.content)) {
      throw new DocumentValidationError('正文不是合法的 ProseMirror 文档');
    }
    content = sanitizeDocument(params.content);
  }
  const r = await pool.query(
    `INSERT INTO zenithjoy.documents (org_id, parent_id, title, owner_member_id, content)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
               content, ai_retrieval_opt_out, deleted_at, created_at`,
    [orgId, parentId, title, memberId, JSON.stringify(content)]
  );
  const row = r.rows[0] as Record<string, unknown>;
  const detail: DocRow = {
    id: String(row.id),
    org_id: String(row.org_id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    title: String(row.title),
    owner_member_id: String(row.owner_member_id),
    visibility: row.visibility as Visibility,
    content: row.content,
    ai_retrieval_opt_out: Boolean(row.ai_retrieval_opt_out),
    deleted_at: null,
  };
  return toDetail(detail, new Date(String(row.created_at)).toISOString());
}

/**
 * PATCH 自动保存。不可见/不存在/已软删 → null（404）。畸形正文 → 抛 ValidationError（400）。
 * content 过白名单剥洗后落库；title 直接参数化更新。
 */
export async function patchDocument(
  orgId: string,
  memberId: string,
  id: string,
  patch: { content?: unknown; title?: unknown }
): Promise<DocDetail | null> {
  const row = await fetchRow(pool, id, orgId);
  if (!row) return null;
  if (!(await visibleWithInheritance(pool, orgId, memberId, row))) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.content !== undefined) {
    if (!isValidProseMirrorDoc(patch.content)) {
      throw new DocumentValidationError('正文不是合法的 ProseMirror 文档');
    }
    sets.push(`content = $${i++}::jsonb`);
    vals.push(JSON.stringify(sanitizeDocument(patch.content)));
  }
  if (typeof patch.title === 'string') {
    sets.push(`title = $${i++}`);
    vals.push(patch.title);
  }
  if (sets.length === 0) return toDetail(row);
  sets.push('updated_at = NOW()');
  vals.push(id, orgId);
  const r = await pool.query(
    `UPDATE zenithjoy.documents SET ${sets.join(', ')}
      WHERE id = $${i++} AND org_id = $${i} AND deleted_at IS NULL
      RETURNING id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
                content, ai_retrieval_opt_out, deleted_at`,
    vals
  );
  if (r.rowCount === 0) return null;
  const u = r.rows[0] as Record<string, unknown>;
  return toDetail({
    id: String(u.id),
    org_id: String(u.org_id),
    parent_id: u.parent_id ? String(u.parent_id) : null,
    title: String(u.title),
    owner_member_id: String(u.owner_member_id),
    visibility: u.visibility as Visibility,
    content: u.content,
    ai_retrieval_opt_out: Boolean(u.ai_retrieval_opt_out),
    deleted_at: null,
  });
}

/** 移动（改父级）。不可见/不存在 → null。父级必须本组织。 */
export async function moveDocument(
  orgId: string,
  memberId: string,
  id: string,
  parentId: string | null
): Promise<DocDetail | null> {
  const row = await fetchRow(pool, id, orgId);
  if (!row) return null;
  if (!(await visibleWithInheritance(pool, orgId, memberId, row))) return null;
  let newParent: string | null = null;
  if (typeof parentId === 'string' && isUuid(parentId)) {
    const parent = await fetchRow(pool, parentId, orgId, { includeDeleted: true });
    if (!parent) return null;
    if (parent.id === id) return null; // 不能挂自己
    newParent = parent.id;
  }
  const r = await pool.query(
    `UPDATE zenithjoy.documents SET parent_id = $1, updated_at = NOW()
      WHERE id = $2 AND org_id = $3 AND deleted_at IS NULL
      RETURNING id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
                content, ai_retrieval_opt_out, deleted_at`,
    [newParent, id, orgId]
  );
  if (r.rowCount === 0) return null;
  const u = r.rows[0] as Record<string, unknown>;
  return toDetail({
    id: String(u.id),
    org_id: String(u.org_id),
    parent_id: u.parent_id ? String(u.parent_id) : null,
    title: String(u.title),
    owner_member_id: String(u.owner_member_id),
    visibility: u.visibility as Visibility,
    content: u.content,
    ai_retrieval_opt_out: Boolean(u.ai_retrieval_opt_out),
    deleted_at: null,
  });
}

/** 软删。不可见/不存在 → null。 */
export async function deleteDocument(
  orgId: string,
  memberId: string,
  id: string
): Promise<{ id: string; deleted_at: string } | null> {
  const row = await fetchRow(pool, id, orgId);
  if (!row) return null;
  if (!(await visibleWithInheritance(pool, orgId, memberId, row))) return null;
  const r = await pool.query(
    `UPDATE zenithjoy.documents SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING deleted_at`,
    [id, orgId]
  );
  if (r.rowCount === 0) return null;
  return { id, deleted_at: new Date(String(r.rows[0].deleted_at)).toISOString() };
}

/** 从回收站还原。 */
export async function restoreDocument(
  orgId: string,
  memberId: string,
  id: string
): Promise<{ id: string; restored_at: string } | null> {
  const row = await fetchRow(pool, id, orgId, { includeDeleted: true });
  if (!row || !row.deleted_at) return null;
  if (!(await visibleWithInheritance(pool, orgId, memberId, row))) return null;
  const r = await pool.query(
    `UPDATE zenithjoy.documents SET deleted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND org_id = $2 AND deleted_at IS NOT NULL RETURNING updated_at`,
    [id, orgId]
  );
  if (r.rowCount === 0) return null;
  return { id, restored_at: new Date(String(r.rows[0].updated_at)).toISOString() };
}

/** 本组织可见文档树（扁平列表，前端自行拼树）。可见性/继承过滤 + 可见性查询失败向上抛。 */
export async function listTree(
  orgId: string,
  memberId: string
): Promise<Array<{ id: string; parent_id: string | null; title: string; visibility: Visibility }>> {
  const r = await pool.query(
    `SELECT id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
            content, ai_retrieval_opt_out, deleted_at
       FROM zenithjoy.documents
      WHERE org_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [orgId]
  );
  const out: Array<{ id: string; parent_id: string | null; title: string; visibility: Visibility }> = [];
  for (const raw of r.rows as Record<string, unknown>[]) {
    const row: DocRow = {
      id: String(raw.id),
      org_id: String(raw.org_id),
      parent_id: raw.parent_id ? String(raw.parent_id) : null,
      title: String(raw.title),
      owner_member_id: String(raw.owner_member_id),
      visibility: raw.visibility as Visibility,
      content: raw.content,
      ai_retrieval_opt_out: Boolean(raw.ai_retrieval_opt_out),
      deleted_at: null,
    };
    if (await visibleWithInheritance(pool, orgId, memberId, row)) {
      out.push({ id: row.id, parent_id: row.parent_id, title: row.title, visibility: row.visibility });
    }
  }
  return out;
}

/** 全文检索（标题 + 正文文本），本组织可见范围内。 */
export async function searchDocuments(
  orgId: string,
  memberId: string,
  q: string
): Promise<Array<{ id: string; title: string }>> {
  const term = typeof q === 'string' ? q.trim() : '';
  if (!term) return [];
  const r = await pool.query(
    `SELECT id::text, org_id::text, parent_id::text, title, owner_member_id, visibility,
            content, ai_retrieval_opt_out, deleted_at
       FROM zenithjoy.documents
      WHERE org_id = $1 AND deleted_at IS NULL
        AND (title ILIKE '%' || $2 || '%' OR content::text ILIKE '%' || $2 || '%')
      ORDER BY updated_at DESC`,
    [orgId, term]
  );
  const out: Array<{ id: string; title: string }> = [];
  for (const raw of r.rows as Record<string, unknown>[]) {
    const row: DocRow = {
      id: String(raw.id),
      org_id: String(raw.org_id),
      parent_id: raw.parent_id ? String(raw.parent_id) : null,
      title: String(raw.title),
      owner_member_id: String(raw.owner_member_id),
      visibility: raw.visibility as Visibility,
      content: raw.content,
      ai_retrieval_opt_out: Boolean(raw.ai_retrieval_opt_out),
      deleted_at: null,
    };
    if (await visibleWithInheritance(pool, orgId, memberId, row)) {
      out.push({ id: row.id, title: row.title });
    }
  }
  return out;
}

/** ProseMirror JSON → Markdown（最小实现：标题/段落/列表/代码块的纯文本导出）。 */
function pmToMarkdown(content: unknown): string {
  const lines: string[] = [];
  const textOf = (node: Record<string, unknown>): string => {
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
    const kids = Array.isArray(node.content) ? (node.content as Record<string, unknown>[]) : [];
    return kids.map(textOf).join('');
  };
  const doc = content as { content?: Record<string, unknown>[] };
  const nodes = Array.isArray(doc?.content) ? doc.content : [];
  for (const node of nodes) {
    const t = node.type;
    if (t === 'heading') {
      const level = Number((node.attrs as Record<string, unknown>)?.level ?? 1);
      lines.push(`${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${textOf(node)}`);
    } else if (t === 'paragraph') {
      lines.push(textOf(node));
    } else if (t === 'bulletList' || t === 'bullet_list' || t === 'orderedList' || t === 'ordered_list') {
      const items = Array.isArray(node.content) ? (node.content as Record<string, unknown>[]) : [];
      for (const it of items) lines.push(`- ${textOf(it)}`);
    } else if (t === 'codeBlock' || t === 'code_block') {
      lines.push('```');
      lines.push(textOf(node));
      lines.push('```');
    } else {
      lines.push(textOf(node));
    }
  }
  return lines.join('\n\n');
}

/** 导出 Markdown。不可见/不存在 → null。 */
export async function exportMarkdown(
  orgId: string,
  memberId: string,
  id: string
): Promise<string | null> {
  const detail = await getDocument(orgId, memberId, id);
  if (!detail) return null;
  return pmToMarkdown(detail.content);
}

/** 设置可见性（owner-only）。members 时替换 document_members 成员集合。 */
export async function setVisibility(
  orgId: string,
  memberId: string,
  id: string,
  visibility: unknown,
  memberIds: unknown
): Promise<DocDetail | null> {
  const row = await fetchRow(pool, id, orgId);
  if (!row) return null;
  if (row.owner_member_id !== memberId) return null; // 仅表主可改可见性（同 404 口径不泄存在性）
  const vis = visibility === 'members' || visibility === 'private' || visibility === 'org' ? visibility : 'org';
  const ids = Array.isArray(memberIds) ? memberIds.filter((m) => typeof m === 'string') : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE zenithjoy.documents SET visibility = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
      [vis, id, orgId]
    );
    await client.query('DELETE FROM zenithjoy.document_members WHERE doc_id = $1', [id]);
    if (vis === 'members') {
      for (const m of ids) {
        await client.query(
          `INSERT INTO zenithjoy.document_members (doc_id, member_id) VALUES ($1, $2)
           ON CONFLICT (doc_id, member_id) DO NOTHING`,
          [id, m]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const updated = await fetchRow(pool, id, orgId);
  return updated ? toDetail(updated) : null;
}

/** @提及解析：目标文档在本组织可见 → 返回标题；否则 null（不泄标题，反枚举）。 */
export async function resolveMentionTarget(
  orgId: string,
  memberId: string,
  targetId: string
): Promise<{ id: string; title: string } | null> {
  const detail = await getDocument(orgId, memberId, targetId);
  if (!detail) return null;
  return { id: detail.id, title: detail.title };
}
