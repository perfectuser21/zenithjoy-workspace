import pool from '../db/connection';
import { FieldDefinition } from '../models/types';
import { ApiError } from '../middleware/error';

/**
 * G1 / J7 段②：五处 SQL 全部带上 tenant_id 条件。
 *
 * 隔离列用 tenant_id（不是路③ 的 org_id）——这张表归 works 家族，过滤它的是
 * tenantContext 设的 req.tenantId；列名与家族分叉的话，闸挂上去也过滤不到，隔离形同虚设。
 *
 * 越权一律按"不存在"处理（404），不用 403 —— 403 等于承认"这行存在但不归你"，
 * 可被逐个 id 枚举出他家企业的字段清单。
 */
export class FieldsService {
  private assertTenant(tenantId: string): string {
    // 空租户 = 说不清归属，一律拒绝，绝不降级成"查全表"。
    // 少了这一句，任何绕过租户解析的调用方都会拿到跨租户全量数据。
    if (!tenantId) {
      throw new ApiError('NO_TENANT', '当前用户未关联到任何 tenant', 403);
    }
    return tenantId;
  }

  async getFields(tenantId: string): Promise<FieldDefinition[]> {
    const query = `
      SELECT * FROM zenithjoy.field_definitions
      WHERE is_visible = true AND tenant_id = $1
      ORDER BY display_order ASC
    `;
    const result = await pool.query(query, [this.assertTenant(tenantId)]);
    return result.rows;
  }

  async getFieldById(id: string, tenantId: string): Promise<FieldDefinition> {
    const query = 'SELECT * FROM zenithjoy.field_definitions WHERE id = $1 AND tenant_id = $2';
    const result = await pool.query(query, [id, this.assertTenant(tenantId)]);

    if (result.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Field definition not found', 404);
    }

    return result.rows[0];
  }

  async createField(
    field: Omit<FieldDefinition, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string
  ): Promise<FieldDefinition> {
    const query = `
      INSERT INTO zenithjoy.field_definitions (
        field_name, field_type, options, display_order, is_visible, tenant_id
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      field.field_name,
      field.field_type,
      field.options ? JSON.stringify(field.options) : null,
      field.display_order || 0,
      field.is_visible !== undefined ? field.is_visible : true,
      this.assertTenant(tenantId)
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateField(id: string, field: Partial<FieldDefinition>, tenantId: string): Promise<FieldDefinition> {
    // First check if field exists **in this tenant** —— 跨租户的 id 在这里就变成 404
    await this.getFieldById(id, tenantId);

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(field).forEach(([key, value]) => {
      // tenant_id 不接受来自请求体的修改：改归属等于把行送给别家企业
      if (key !== 'id' && key !== 'created_at' && key !== 'tenant_id' && value !== undefined) {
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
    const idParam = paramIndex++;
    values.push(this.assertTenant(tenantId));

    const query = `
      UPDATE zenithjoy.field_definitions
      SET ${fields.join(', ')}
      WHERE id = $${idParam} AND tenant_id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async deleteField(id: string, tenantId: string): Promise<void> {
    // Check if field exists in this tenant
    await this.getFieldById(id, tenantId);

    const query = 'DELETE FROM zenithjoy.field_definitions WHERE id = $1 AND tenant_id = $2';
    await pool.query(query, [id, this.assertTenant(tenantId)]);
  }
}
