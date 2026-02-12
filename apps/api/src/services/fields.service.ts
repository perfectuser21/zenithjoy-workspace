import pool from '../db/connection';
import { FieldDefinition } from '../models/types';
import { ApiError } from '../middleware/error';

export class FieldsService {
  async getFields(): Promise<FieldDefinition[]> {
    const query = `
      SELECT * FROM zenithjoy.field_definitions
      WHERE is_visible = true
      ORDER BY display_order ASC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  async getFieldById(id: string): Promise<FieldDefinition> {
    const query = 'SELECT * FROM zenithjoy.field_definitions WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Field definition not found', 404);
    }

    return result.rows[0];
  }

  async createField(field: Omit<FieldDefinition, 'id' | 'created_at' | 'updated_at'>): Promise<FieldDefinition> {
    const query = `
      INSERT INTO zenithjoy.field_definitions (
        field_name, field_type, options, display_order, is_visible
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [
      field.field_name,
      field.field_type,
      field.options ? JSON.stringify(field.options) : null,
      field.display_order || 0,
      field.is_visible !== undefined ? field.is_visible : true
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateField(id: string, field: Partial<FieldDefinition>): Promise<FieldDefinition> {
    // First check if field exists
    await this.getFieldById(id);

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(field).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        fields.push(`${key} = $${paramIndex++}`);
        // Stringify options
        if (key === 'options') {
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
      UPDATE zenithjoy.field_definitions
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async deleteField(id: string): Promise<void> {
    // Check if field exists
    await this.getFieldById(id);

    const query = 'DELETE FROM zenithjoy.field_definitions WHERE id = $1';
    await pool.query(query, [id]);
  }
}
