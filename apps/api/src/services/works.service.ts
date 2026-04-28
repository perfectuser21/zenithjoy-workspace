import pool from '../db/connection';
import { Work, ListResponse } from '../models/types';
import { ApiError } from '../middleware/error';

/**
 * 多租户隔离上下文（v2 — tenant 级，主理人 2026-04-28 决策）
 *  - tenantId: 当前请求者所属的 tenant UUID（来源：tenant_members 表反查飞书 ID）
 *  - feishuUserId: 飞书 open_id（用于 owner_id 审计字段，不参与隔离过滤）
 *  - bypassTenant: super-admin 跨租户访问（true 时跳过 tenant_id 过滤）
 */
export interface TenantContext {
  tenantId: string;
  feishuUserId?: string;
  bypassTenant?: boolean;
}

export class WorksService {
  async getWorks(
    params: {
      type?: string;
      status?: string;
      limit?: number;
      offset?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    },
    ctx: TenantContext
  ): Promise<ListResponse<Work>> {
    const { type, status, limit = 20, offset = 0, sort = 'created_at', order = 'desc' } = params;

    let whereClause = 'WHERE archived_at IS NULL';
    const values: any[] = [];
    let paramIndex = 1;

    if (type) {
      whereClause += ` AND content_type = $${paramIndex++}`;
      values.push(type);
    }
    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      values.push(status);
    }

    // 多租户过滤：bypassTenant 时不加（admin 跨租户）
    if (!ctx.bypassTenant) {
      whereClause += ` AND tenant_id = $${paramIndex++}`;
      values.push(ctx.tenantId);
    }

    const countQuery = `SELECT COUNT(*) as total FROM zenithjoy.works ${whereClause}`;
    const countResult = await pool.query(countQuery, values);
    const total = parseInt(countResult.rows[0].total);

    const dataQuery = `
      SELECT * FROM zenithjoy.works
      ${whereClause}
      ORDER BY ${sort} ${order}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    values.push(limit, offset);

    const dataResult = await pool.query(dataQuery, values);

    return {
      data: dataResult.rows,
      total,
      limit,
      offset,
    };
  }

  async getWorkById(id: string, ctx: TenantContext): Promise<Work> {
    const query = 'SELECT * FROM zenithjoy.works WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Work not found', 404);
    }
    const row = result.rows[0];
    // 多租户：非 bypass 模式下，tenant 不匹配视为不存在（不暴露存在性）
    if (!ctx.bypassTenant && row.tenant_id !== ctx.tenantId) {
      throw new ApiError('NOT_FOUND', 'Work not found', 404);
    }
    return row;
  }

  async createWork(
    work: Omit<Work, 'id' | 'created_at' | 'updated_at'>,
    ctx: TenantContext
  ): Promise<Work> {
    const query = `
      INSERT INTO zenithjoy.works (
        title, body, body_en, content_type, cover_image, media_files,
        platform_links, status, account, is_featured, is_viral, custom_fields, scheduled_at,
        tenant_id, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

    // 强制使用 ctx.tenantId（防伪造）；owner_id 用 feishuUserId 作审计（"谁创建的"）
    const values = [
      work.title,
      work.body || null,
      work.body_en || null,
      work.content_type,
      work.cover_image || null,
      work.media_files ? JSON.stringify(work.media_files) : null,
      work.platform_links ? JSON.stringify(work.platform_links) : null,
      work.status || 'draft',
      work.account || null,
      work.is_featured || false,
      work.is_viral || false,
      work.custom_fields ? JSON.stringify(work.custom_fields) : null,
      work.scheduled_at || null,
      ctx.tenantId,
      ctx.feishuUserId ?? null,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateWork(id: string, work: Partial<Work>, ctx: TenantContext): Promise<Work> {
    // ownership 校验：跨租户视为 NOT_FOUND
    await this.getWorkById(id, ctx);

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(work).forEach(([key, value]) => {
      // 禁止客户端覆盖 tenant_id / owner_id（防越权）
      if (
        key !== 'id' &&
        key !== 'created_at' &&
        key !== 'tenant_id' &&
        key !== 'owner_id' &&
        value !== undefined
      ) {
        fields.push(`${key} = $${paramIndex++}`);
        if (['media_files', 'platform_links', 'custom_fields'].includes(key)) {
          values.push(value ? JSON.stringify(value) : null);
        } else {
          values.push(value);
        }
      }
    });

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE zenithjoy.works
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async deleteWork(id: string, ctx: TenantContext): Promise<void> {
    await this.getWorkById(id, ctx);

    const query = 'DELETE FROM zenithjoy.works WHERE id = $1';
    await pool.query(query, [id]);
  }
}
