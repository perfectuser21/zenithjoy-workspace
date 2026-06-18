/**
 * Path 2 Step4 — 飞书企业信息文档(docx) 建/读
 *
 * 现有飞书集成只有 Bitable（feishu-bitable-multitenant.ts），无 docx 能力 —— 本 sprint 净增。
 *
 *  - createEnterpriseDoc(tenantId, token?) — 建一篇「企业信息」docx，回填 binding.enterprise_doc_token + updated_at
 *  - readEnterpriseDocText(tenantId)       — 读企业信息 docx 纯文本（expand 据此扩词；空判定见 EMPTY_DOC_MIN_CHARS）
 *
 * 全走 process.env.FEISHU_API_BASE（CI/evaluator 指 fake-feishu 替身），token 复用 getValidToken 自动续。
 */
import axios from 'axios';
import pool from '../db/connection';
import { getValidToken } from './feishu-token';

const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * 建「企业信息」docx，回填 enterprise_doc_token + updated_at=NOW()。
 * 返回 doc_token；建失败抛错（调用方 provision/rebuild 决定是否吞）。
 */
export async function createEnterpriseDoc(
  tenantId: string,
  token?: string
): Promise<string> {
  const tok = token ?? (await getValidToken(tenantId));
  const url = `${FEISHU_BASE}/open-apis/docx/v1/documents`;
  const resp = await axios.post(
    url,
    { title: `ZenithJoy 企业信息 ${tenantId.slice(0, 8)}` },
    { headers: authHeader(tok), timeout: 10000 }
  );
  const data = resp.data || {};
  const docToken: string | undefined =
    data?.data?.document?.document_id || data?.data?.document_id;
  if (data.code !== 0 || !docToken) {
    throw new Error(`createEnterpriseDoc failed: code=${data.code} msg=${data.msg || ''}`);
  }
  await pool.query(
    `UPDATE zenithjoy.tenant_feishu_bindings
        SET enterprise_doc_token = $2, updated_at = NOW()
      WHERE tenant_id = $1`,
    [tenantId, docToken]
  );
  return docToken;
}

/**
 * 读企业信息 docx 纯文本。无文档 token → 返 null；读到 → 返纯文本（可能为空字符串）。
 */
export async function readEnterpriseDocText(tenantId: string): Promise<string | null> {
  const r = await pool.query<{ enterprise_doc_token: string | null }>(
    `SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id = $1`,
    [tenantId]
  );
  const docToken = r.rows?.[0]?.enterprise_doc_token;
  if (!docToken) return null;

  const token = await getValidToken(tenantId);
  const url = `${FEISHU_BASE}/open-apis/docx/v1/documents/${docToken}/raw_content`;
  const resp = await axios.get(url, { headers: authHeader(token), timeout: 10000 });
  const data = resp.data || {};
  if (data.code !== 0) {
    throw new Error(`readEnterpriseDocText failed: code=${data.code} msg=${data.msg || ''}`);
  }
  // 飞书 raw_content 返 data.content（纯文本）
  return String(data?.data?.content ?? '');
}
