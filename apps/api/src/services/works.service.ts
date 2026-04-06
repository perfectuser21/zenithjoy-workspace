import pool from '../db/connection';
import { Work, ListResponse } from '../models/types';
import { ApiError } from '../middleware/error';

export class WorksService {
  async getWorks(params: {
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
    sort?: string;
    order?: 'asc' | 'desc';
  }): Promise<ListResponse<Work>> {
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
      offset
    };
  }

  async getWorkById(id: string): Promise<Work> {
    const query = 'SELECT * FROM zenithjoy.works WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Work not found', 404);
    }

    return result.rows[0];
  }

  async createWork(work: Omit<Work, 'id' | 'created_at' | 'updated_at'>): Promise<Work> {
    const query = `
      INSERT INTO zenithjoy.works (
        title, body, body_en, content_type, cover_image, media_files,
        platform_links, status, account, is_featured, is_viral, custom_fields, scheduled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

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
      work.scheduled_at || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateWork(id: string, work: Partial<Work>): Promise<Work> {
    // First check if work exists
    await this.getWorkById(id);

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(work).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        // Stringify JSON fields
        if (['media_files', 'platform_links', 'custom_fields'].includes(key)) {
          values.push(value ? JSON.stringify(value) : null);
        } else {
          values.push(value);
        }
      }
    });

    // Always update updated_at
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

  async deleteWork(id: string): Promise<void> {
    // Check if work exists
    await this.getWorkById(id);

    const query = 'DELETE FROM zenithjoy.works WHERE id = $1';
    await pool.query(query, [id]);
  }
}
