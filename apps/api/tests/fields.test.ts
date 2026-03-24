import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const FIELD = {
  id: 'field-uuid-1',
  field_name: 'Test Field 1',
  field_type: 'select',
  options: ['Option 1', 'Option 2', 'Option 3'],
  display_order: 100,
  is_visible: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Fields API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/fields', () => {
    it('should create a new field definition', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [FIELD] });

      const response = await request(app)
        .post('/api/fields')
        .send({
          field_name: 'Test Field 1',
          field_type: 'select',
          options: ['Option 1', 'Option 2', 'Option 3'],
          display_order: 100,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.field_name).toBe('Test Field 1');
      expect(response.body.field_type).toBe('select');
      expect(response.body.options).toEqual(['Option 1', 'Option 2', 'Option 3']);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({ field_type: 'text' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate field_name', async () => {
      mockQuery.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' })
      );

      const response = await request(app)
        .post('/api/fields')
        .send({ field_name: 'Test Field 1', field_type: 'text' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 400 for invalid field_type', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({ field_name: 'Test Field Invalid', field_type: 'invalid_type' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/fields', () => {
    it('should list all visible fields', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [FIELD] });

      const response = await request(app).get('/api/fields');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const displayOrders = response.body.map((f: any) => f.display_order);
      const sortedOrders = [...displayOrders].sort((a: number, b: number) => a - b);
      expect(displayOrders).toEqual(sortedOrders);
    });
  });

  describe('PUT /api/fields/:id', () => {
    it('should update a field definition', async () => {
      const updatedField = {
        ...FIELD,
        field_name: 'Updated Test Field 1',
        options: ['New Option 1', 'New Option 2'],
      };
      mockQuery
        .mockResolvedValueOnce({ rows: [FIELD] })           // getFieldById
        .mockResolvedValueOnce({ rows: [updatedField] });   // UPDATE

      const response = await request(app)
        .put(`/api/fields/${FIELD.id}`)
        .send({ field_name: 'Updated Test Field 1', options: ['New Option 1', 'New Option 2'] });

      expect(response.status).toBe(200);
      expect(response.body.field_name).toBe('Updated Test Field 1');
      expect(response.body.options).toEqual(['New Option 1', 'New Option 2']);
    });

    it('should return 404 for non-existent field', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getFieldById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/fields/${fakeId}`)
        .send({ field_name: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/fields/:id', () => {
    it('should delete a field definition', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [FIELD] })  // getFieldById
        .mockResolvedValueOnce({ rows: [] });      // DELETE

      const response = await request(app).delete(`/api/fields/${FIELD.id}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent field', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getFieldById returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).delete(`/api/fields/${fakeId}`);

      expect(response.status).toBe(404);
    });
  });
});
