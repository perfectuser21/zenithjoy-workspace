import pool from '../db/connection';
import { PublishLog } from '../models/types';
import { ApiError } from '../middleware/error';

export class PublishService {
  async getPublishLogsByWorkId(workId: string): Promise<PublishLog[]> {
    const query = `
      SELECT * FROM zenithjoy.publish_logs
      WHERE work_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [workId]);
    return result.rows;
  }

  async createPublishLog(log: Omit<PublishLog, 'id' | 'created_at'>): Promise<PublishLog> {
    const query = `
      INSERT INTO zenithjoy.publish_logs (
        work_id, platform, platform_post_id, status, scheduled_at, response, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      log.work_id,
      log.platform,
      log.platform_post_id || null,
      log.status || 'pending',
      log.scheduled_at || null,
      log.response ? JSON.stringify(log.response) : null,
      log.error_message || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updatePublishLog(id: string, log: Partial<PublishLog>): Promise<PublishLog> {
    // First check if log exists
    const checkQuery = 'SELECT * FROM zenithjoy.publish_logs WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Publish log not found', 404);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(log).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
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

    const query = `
      UPDATE zenithjoy.publish_logs
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }
}
