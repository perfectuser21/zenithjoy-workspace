import request from 'supertest';
import app from '../src/app';
import pool from '../src/db/connection';

// Skip integration tests - require real database connection or advanced mocking
describe.skip('Fields API (Integration tests - TODO: configure database mock)', () => {
  let testFieldId: string;

  afterAll(async () => {
    // Cleanup: delete test fields
    await pool.query(`DELETE FROM zenithjoy.field_definitions WHERE field_name LIKE 'Test Field%'`);
    await pool.end();
  });

  describe('POST /api/fields', () => {
    it('should create a new field definition', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({
          field_name: 'Test Field 1',
          field_type: 'select',
          options: ['Option 1', 'Option 2', 'Option 3'],
          display_order: 100
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.field_name).toBe('Test Field 1');
      expect(response.body.field_type).toBe('select');
      expect(response.body.options).toEqual(['Option 1', 'Option 2', 'Option 3']);

      testFieldId = response.body.id;
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({
          field_type: 'text'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate field_name', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({
          field_name: 'Test Field 1',
          field_type: 'text'
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('should return 400 for invalid field_type', async () => {
      const response = await request(app)
        .post('/api/fields')
        .send({
          field_name: 'Test Field Invalid',
          field_type: 'invalid_type'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/fields', () => {
    it('should list all visible fields', async () => {
      const response = await request(app).get('/api/fields');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Should be sorted by display_order
      const displayOrders = response.body.map((f: any) => f.display_order);
      const sortedOrders = [...displayOrders].sort((a, b) => a - b);
      expect(displayOrders).toEqual(sortedOrders);
    });
  });

  describe('PUT /api/fields/:id', () => {
    it('should update a field definition', async () => {
      const response = await request(app)
        .put(`/api/fields/${testFieldId}`)
        .send({
          field_name: 'Updated Test Field 1',
          options: ['New Option 1', 'New Option 2']
        });

      expect(response.status).toBe(200);
      expect(response.body.field_name).toBe('Updated Test Field 1');
      expect(response.body.options).toEqual(['New Option 1', 'New Option 2']);
    });

    it('should return 404 for non-existent field', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/fields/${fakeId}`)
        .send({ field_name: 'Updated' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/fields/:id', () => {
    it('should delete a field definition', async () => {
      const response = await request(app).delete(`/api/fields/${testFieldId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for already deleted field', async () => {
      const response = await request(app).delete(`/api/fields/${testFieldId}`);

      expect(response.status).toBe(404);
    });
  });
});
