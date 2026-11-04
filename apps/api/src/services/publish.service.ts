import pool from '../db/connection';
import { PublishLog } from '../models/types';
import { ApiError } from '../middleware/error';

export class PublishService {
  private requireTenant(tenantId: string): string {
    if (!tenantId) throw new ApiError('NO_TENANT', '当前用户未关联到任何 tenant', 403);
    return tenantId;
  }

  async getPublishLogsByWorkId(workId: string, tenantId: string): Promise<PublishLog[]> {
    this.requireTenant(tenantId);
    const work = await pool.query('SELECT id FROM zenithjoy.works WHERE id = $1 AND tenant_id = $2', [workId, tenantId]);
    if (!work.rows.length) throw new ApiError('NOT_FOUND', 'Work not found', 404);
    const query = `
      SELECT pl.* FROM zenithjoy.publish_logs pl
      JOIN zenithjoy.works w ON w.id = pl.work_id
      WHERE pl.work_id = $1 AND w.tenant_id = $2
      ORDER BY pl.created_at DESC
    `;
    const result = await pool.query(query, [workId, tenantId]);
    return result.rows;
  }

  async createPublishLog(log: Omit<PublishLog, 'id' | 'created_at'>, tenantId: string): Promise<PublishLog> {
    this.requireTenant(tenantId);
    const query = `
      INSERT INTO zenithjoy.publish_logs (
        work_id, platform, platform_post_id, status, scheduled_at, response, error_message
      ) SELECT $1, $2, $3, $4, $5, $6, $7
        FROM zenithjoy.works w WHERE w.id = $1 AND w.tenant_id = $8
      RETURNING *
    `;

    const values = [
      log.work_id,
      log.platform,
      log.platform_post_id || null,
      log.status || 'pending',
      log.scheduled_at || null,
      log.response ? JSON.stringify(log.response) : null,
      log.error_message || null,
      tenantId
    ];

    const result = await pool.query(query, values);
    if (!result.rows.length) throw new ApiError('NOT_FOUND', 'Work not found', 404);
    return result.rows[0];
  }

  async updatePublishLog(id: string, log: Partial<PublishLog>, tenantId: string): Promise<PublishLog> {
    this.requireTenant(tenantId);
    // First check if log exists
    const checkQuery = `SELECT pl.* FROM zenithjoy.publish_logs pl
      JOIN zenithjoy.works w ON w.id = pl.work_id WHERE pl.id = $1 AND w.tenant_id = $2`;
    const checkResult = await pool.query(checkQuery, [id, tenantId]);

    if (checkResult.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Publish log not found', 404);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(log).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'work_id' && key !== 'created_at' && value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        // Stringify response
        if (key === 'response') {
          values.push(value ? JSON.stringify(value) : null);
        } else {
          values.push(value);
        }
      }
    });

    if (fields.length === 0) {
      return checkResult.rows[0];
    }

    values.push(id);
    values.push(tenantId);

    const query = `
      UPDATE zenithjoy.publish_logs
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
        AND EXISTS (SELECT 1 FROM zenithjoy.works w
          WHERE w.id = zenithjoy.publish_logs.work_id AND w.tenant_id = $${paramIndex + 1})
      RETURNING *
    `;

    const result = await pool.query(query, values);
    if (!result.rows.length) throw new ApiError('NOT_FOUND', 'Publish log not found', 404);
    return result.rows[0];
  }
}
